import snApi from "sn-extension-api";

type StreamedItem = Readonly<{
  uuid?: unknown;
  created_at?: unknown;
  isMetadataUpdate?: unknown;
  content?: Readonly<{
    title?: unknown;
    text?: unknown;
    appData?: Record<string, { locked?: unknown }>;
  }>;
}>;

type Reply = Record<string, unknown>;
type PostMessage = (
  action: string,
  data: Reply,
  callback?: (reply: unknown) => void,
) => void;

export type StandardNotesApi = {
  initialize(options?: { debounceSave?: number }): void;
};

type TransportApi = StandardNotesApi & { postMessage: PostMessage };

export type StandardNotesSnapshot = Readonly<{
  id: string | null;
  text: string;
  locked: boolean;
  fileName: string | null;
  createdAt: string | null;
  kind: "content" | "metadata";
}>;

export type StandardNotesSaveResult = Readonly<{
  id: string;
  operationId: number;
  status: "acknowledged" | "failed";
}>;

function object(value: unknown): value is Reply {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class StandardNotesHost {
  private readonly listeners = new Set<
    (snapshot: StandardNotesSnapshot) => void
  >();
  private readonly cancellations = new Set<() => void>();
  private currentItem: StreamedItem | null = null;
  private currentSnapshot: StandardNotesSnapshot | null = null;
  private initialized = false;
  private disposed = false;

  constructor(
    private readonly api: StandardNotesApi = snApi,
    private readonly saveTimeoutMs = 15_000,
  ) {}

  initialize(): void {
    if (this.initialized || this.disposed)
      throw new Error(
        "Standard Notes adapter is already initialized or disposed",
      );
    const transport = this.api as TransportApi;
    const original = transport.postMessage;
    if (typeof original !== "function")
      throw new Error("Unsupported Standard Notes transport");

    // Compatibility boundary for pinned sn-extension-api@0.4.0. Its public
    // text subscription omits metadata-only updates, and its save callback
    // discards error payloads. Preserve its theme/session transport, but observe
    // the registered context stream before those public-API omissions.
    transport.postMessage = (action, data, callback) => {
      if (action !== "stream-context-item")
        return original.call(transport, action, data, callback);
      original.call(transport, action, data, (reply) => {
        callback?.(reply);
        if (this.disposed || !object(reply) || !object(reply.item)) return;
        const item = reply.item as StreamedItem;
        this.currentItem = item;
        const id = nonempty(item.uuid);
        const metadataOnly = item.isMetadataUpdate === true;
        const previous = this.currentSnapshot;
        const text =
          typeof item.content?.text === "string"
            ? item.content.text
            : metadataOnly && previous?.id === id
              ? previous.text
              : "";
        this.currentSnapshot = {
          id,
          text,
          locked: Boolean(
            item.content?.appData?.["org.standardnotes.sn"]?.locked,
          ),
          fileName: nonempty(item.content?.title),
          createdAt: nonempty(item.created_at),
          kind: metadataOnly ? "metadata" : "content",
        };
        this.listeners.forEach((listener) => listener(this.currentSnapshot!));
      });
    };
    try {
      this.api.initialize({ debounceSave: 0 });
      this.initialized = true;
    } finally {
      transport.postMessage = original;
    }
  }

  subscribe(callback: (snapshot: StandardNotesSnapshot) => void): () => void {
    this.listeners.add(callback);
    if (this.currentSnapshot) callback(this.currentSnapshot);
    return () => this.listeners.delete(callback);
  }

  get currentNoteId(): string | null {
    return this.currentSnapshot?.id ?? null;
  }

  get locked(): boolean {
    return this.currentSnapshot?.locked ?? true;
  }

  save(
    expectedNoteId: string,
    operationId: number,
    text: string,
    preview: string,
  ): Promise<StandardNotesSaveResult> {
    const result = (saved: boolean): StandardNotesSaveResult => ({
      id: expectedNoteId,
      operationId,
      status: saved ? "acknowledged" : "failed",
    });
    if (
      !this.initialized ||
      this.disposed ||
      this.currentNoteId !== expectedNoteId ||
      this.locked ||
      !this.currentItem?.content
    )
      return Promise.resolve(result(false));

    // Snapshot the target. Neither switching notes nor subsequent typing can
    // change this operation, and sending must not mutate the last host stream.
    const item = JSON.parse(
      JSON.stringify({
        ...this.currentItem,
        content: { ...this.currentItem.content, text, preview_plain: preview },
        children: null,
        parent: null,
      }),
    );
    return new Promise((resolve) => {
      let settled = false;
      const complete = (saved: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancellations.delete(cancel);
        resolve(result(saved));
      };
      const cancel = () => complete(false);
      const timer = setTimeout(cancel, this.saveTimeoutMs);
      this.cancellations.add(cancel);
      try {
        (this.api as TransportApi).postMessage(
          "save-items",
          { items: [item] },
          (reply) => {
            // Standard Notes ComponentViewer replies {} from onPresyncSave and
            // {error: "save-error"} on failure. This confirms local host saving,
            // NOT cloud synchronization. Unknown/declined replies fail closed.
            complete(object(reply) && Object.keys(reply).length === 0);
          },
        );
      } catch {
        complete(false);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.cancellations.forEach((cancel) => cancel());
  }
}
