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
        if (this.disposed || !object(reply)) return;
        if (!object(reply.item)) {
          if (!Object.hasOwn(reply, "item")) return;
          this.currentItem = null;
          this.currentSnapshot = {
            id: null,
            text: "",
            locked: true,
            fileName: null,
            createdAt: null,
            kind: "content",
          };
          this.listeners.forEach((listener) => listener(this.currentSnapshot!));
          return;
        }
        const streamed = reply.item as StreamedItem;
        const metadataOnly = streamed.isMetadataUpdate === true;
        const previous = this.currentSnapshot;
        // Metadata can omit unchanged fields. Preserve the full item used by
        // save-items, but never carry content across different note identities.
        const item: StreamedItem =
          metadataOnly && nonempty(streamed.uuid) === previous?.id
            ? {
                ...this.currentItem,
                ...streamed,
                content: { ...this.currentItem?.content, ...streamed.content },
              }
            : streamed;
        const id = nonempty(item.uuid);
        this.currentItem = item;
        const text =
          typeof item.content?.text === "string"
            ? item.content.text
            : metadataOnly && previous?.id === id
              ? previous.text
              : "";
        this.currentSnapshot = {
          id,
          text,
          locked:
            (metadataOnly && typeof item.content?.text !== "string") ||
            Boolean(item.content?.appData?.["org.standardnotes.sn"]?.locked),
          fileName: nonempty(item.content?.title),
          createdAt: nonempty(item.created_at),
          kind: metadataOnly ? "metadata" : "content",
        };
        this.listeners.forEach((listener) => listener(this.currentSnapshot!));
        callback?.(reply);
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
        content: {
          ...this.currentItem.content,
          text,
          preview_plain: preview,
          // A previous editor's HTML preview can contain stale sensitive text.
          // AIC publishes only its freshly derived, redacted plain preview.
          preview_html: "",
        },
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
    this.currentItem = null;
    this.currentSnapshot = null;
    this.listeners.clear();
    this.cancellations.forEach((cancel) => cancel());
  }
}
