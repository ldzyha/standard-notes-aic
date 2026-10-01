/** Ciphertext-only transport to the owning VS Code TextDocument. */
export const MAX_VSCODE_CIPHERTEXT_BYTES = 9 * 1024 * 1024;

interface VsCodeApi {
  postMessage(message: unknown): void;
}

export interface VsCodeSource {
  readonly kind: "vscode";
  read(): Promise<string>;
  write(ciphertext: string, expected: string | null): Promise<void>;
  onDidChange(listener: () => void): () => void;
  dispose(): void;
}

interface PendingRequest {
  resolve(text: string): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function boundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_VSCODE_CIPHERTEXT_BYTES &&
    new TextEncoder().encode(value).length <= MAX_VSCODE_CIPHERTEXT_BYTES
  );
}

let source: VsCodeSource | null | undefined;

export function getVsCodeSource(): VsCodeSource | null {
  if (source !== undefined) return source;
  const acquire = (window as unknown as { acquireVsCodeApi?: () => VsCodeApi })
    .acquireVsCodeApi;
  if (typeof acquire !== "function") return (source = null);
  const api = acquire();
  const pending = new Map<string, PendingRequest>();
  const changes = new Set<() => void>();
  const token = crypto.randomUUID();
  let sequence = 0;
  let disposed = false;
  const request = (
    type: "portable.read" | "portable.write",
    data: Record<string, unknown> = {},
  ): Promise<string> => {
    if (disposed)
      return Promise.reject(new Error("The encrypted file editor was closed."));
    const requestId = `${token}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(
          new Error(
            "The encrypted file request timed out. Reload the file before retrying.",
          ),
        );
      }, 30000);
      pending.set(requestId, { resolve, reject, timer });
      try {
        api.postMessage({ type, requestId, ...data });
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(
          new Error("Unable to contact the encrypted file editor.", {
            cause: error,
          }),
        );
      }
    });
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (disposed || !event.data || typeof event.data !== "object") return;
    const reply = event.data as Record<string, unknown>;
    if (reply.type === "portable.changed") {
      for (const listener of changes) listener();
      return;
    }
    if (typeof reply.requestId !== "string") return;
    const waiter = pending.get(reply.requestId);
    if (!waiter || typeof reply.ok !== "boolean") return;
    if (reply.ok && !boundedText(reply.text)) return;
    if (
      !reply.ok &&
      (typeof reply.error !== "string" || reply.error.length > 4096)
    )
      return;
    pending.delete(reply.requestId);
    clearTimeout(waiter.timer);
    if (reply.ok) waiter.resolve(reply.text as string);
    else waiter.reject(new Error(reply.error as string));
  };
  window.addEventListener("message", receive);
  source = {
    kind: "vscode",
    read: () => request("portable.read"),
    async write(ciphertext, expected) {
      if (
        !boundedText(ciphertext) ||
        (expected !== null && !boundedText(expected))
      ) {
        throw new Error(
          "The encrypted file exceeds the supported 9 MiB transport size.",
        );
      }
      const text = await request("portable.write", {
        text: ciphertext,
        expected,
      });
      if (text !== ciphertext)
        throw new Error(
          "The encrypted file changed while saving. Reload it before retrying.",
        );
    },
    onDidChange(listener) {
      changes.add(listener);
      return () => changes.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("message", receive);
      changes.clear();
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("The encrypted file editor was closed."));
      }
      pending.clear();
    },
  };
  return source;
}
