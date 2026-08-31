import snApi from "sn-extension-api";

type StreamedItem = Readonly<{ uuid?: unknown }>;

export type StandardNotesApi = {
  initialize(options?: { debounceSave?: number }): void;
  subscribe(callback: (text: string, meta: unknown) => void): () => void;
  readonly locked: boolean;
  text: string;
  preview: string;
};

type IdentityAwareApi = StandardNotesApi & {
  readonly lastStreamedItem?: StreamedItem;
};

export type StandardNotesSnapshot = Readonly<{
  id: string | null;
  text: string;
  locked: boolean;
}>;

function noteId(api: StandardNotesApi): string | null {
  // sn-extension-api 0.4.0 receives the working-note UUID but omits it from
  // its public callback. The dependency is deliberately pinned, and this is
  // the only compatibility boundary that knows about that implementation
  // detail. Writes fail closed when the identity is unavailable.
  const candidate = (api as IdentityAwareApi).lastStreamedItem?.uuid;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

export class StandardNotesHost {
  constructor(private readonly api: StandardNotesApi = snApi) {}

  initialize(): void {
    // Ctrl/Cmd+S is the debounce boundary. Dispatch that save immediately.
    this.api.initialize({ debounceSave: 0 });
  }

  subscribe(callback: (snapshot: StandardNotesSnapshot) => void): () => void {
    return this.api.subscribe((text) => {
      callback({
        id: noteId(this.api),
        text,
        locked: Boolean(this.api.locked),
      });
    });
  }

  get currentNoteId(): string | null {
    return noteId(this.api);
  }

  get locked(): boolean {
    return Boolean(this.api.locked);
  }

  save(expectedNoteId: string, text: string, preview: string): boolean {
    if (this.currentNoteId !== expectedNoteId || this.locked) return false;
    // Preview must be assigned before text because text dispatches the save.
    this.api.preview = preview;
    this.api.text = text;
    return true;
  }
}
