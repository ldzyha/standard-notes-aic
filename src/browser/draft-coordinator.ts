/** Shared in-memory autosave protocol. Storage writes remain in the worker. */
export interface VersionedDocument {
  id: string;
  markdown: string;
  revision: number;
}

export interface DraftState<
  RecordType extends VersionedDocument,
  Context extends object,
> {
  key: string;
  context: Context;
  record: RecordType | null;
  text: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

export type SaveDocument<RecordType extends VersionedDocument> = (
  id: string,
  markdown: string,
  expectedRevision: number,
) => Promise<RecordType>;
export type CreateDocument<
  RecordType extends VersionedDocument,
  Context extends object,
> = (context: Context, markdown: string) => Promise<RecordType>;

export interface DraftContextAdapter<
  RecordType extends VersionedDocument,
  Context extends object,
> {
  contextKey(context: Context): string;
  contextForRecord(record: RecordType): Context;
  pageChangedMessage?: string;
}

interface Entry<RecordType extends VersionedDocument, Context extends object> {
  draft: DraftState<RecordType, Context>;
  baseText: string;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<boolean> | null;
  blocked: boolean;
  retryOnActivation: boolean;
}

export const AUTOSAVE_DELAY_MS = 350;

function snapshot<RecordType extends VersionedDocument, Context extends object>(
  draft: DraftState<RecordType, Context>,
): DraftState<RecordType, Context> {
  return {
    ...draft,
    context: { ...draft.context },
    record: draft.record ? { ...draft.record } : null,
  };
}

function placeholderKey(contextKey: string): string {
  return `pending:${contextKey}`;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : null;
}

function errorMessage(error: unknown, pageChangedMessage: string): string {
  const code = errorCode(error);
  if (code === "conflict") {
    return "Could not save. Another window may have changed this note. Export your draft before reopening.";
  }
  if (code === "quota") {
    return "Browser storage is full. Your draft is still here; export a backup or free space, then retry.";
  }
  if (code === "page_changed") return pageChangedMessage;
  return "Could not save to browser storage. Your draft is still here; retry or export it.";
}

export class DraftCoordinator<
  RecordType extends VersionedDocument,
  Context extends object,
> {
  private readonly entries = new Map<string, Entry<RecordType, Context>>();
  private activeKey: string | null = null;
  private disposed = false;

  constructor(
    private readonly saveFn: SaveDocument<RecordType>,
    private readonly adapter: DraftContextAdapter<RecordType, Context>,
    private readonly onChangeFn: (
      draft: DraftState<RecordType, Context>,
    ) => void = () => undefined,
    private readonly createFn?: CreateDocument<RecordType, Context>,
  ) {}

  private emit(entry: Entry<RecordType, Context>): void {
    if (this.disposed) return;
    try {
      this.onChangeFn(snapshot(entry.draft));
    } catch {
      // A view callback must not interrupt a storage acknowledgment.
    }
  }

  private clearTimer(entry: Entry<RecordType, Context>): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  }

  private scheduleAutoSave(entry: Entry<RecordType, Context>): void {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.requestSave(entry, false);
    }, AUTOSAVE_DELAY_MS);
  }

  private pruneInactive(): void {
    for (const [key, entry] of this.entries) {
      if (
        key !== this.activeKey &&
        !entry.draft.dirty &&
        !entry.draft.saving &&
        !entry.inFlight
      ) {
        this.clearTimer(entry);
        this.entries.delete(key);
      }
    }
  }

  activate(record: RecordType): DraftState<RecordType, Context> {
    if (this.disposed) throw new Error("Draft coordinator has been disposed.");
    const incoming = { ...record };
    const context = this.adapter.contextForRecord(incoming);
    let entry =
      this.entries.get(incoming.id) ??
      this.entries.get(placeholderKey(this.adapter.contextKey(context)));
    if (!entry) {
      entry = {
        draft: {
          key: incoming.id,
          context: { ...context },
          record: incoming,
          text: incoming.markdown,
          dirty: false,
          saving: false,
          error: null,
        },
        baseText: incoming.markdown,
        timer: null,
        inFlight: null,
        blocked: false,
        retryOnActivation: false,
      };
      this.entries.set(incoming.id, entry);
    } else if (
      !entry.draft.dirty &&
      !entry.draft.saving &&
      incoming.revision >= (entry.draft.record?.revision ?? 0)
    ) {
      entry.draft.record = incoming;
      entry.draft.context = { ...context };
      entry.draft.text = incoming.markdown;
      entry.baseText = incoming.markdown;
      entry.draft.error = null;
      entry.blocked = false;
    }
    this.activeKey = entry.draft.key;
    this.pruneInactive();
    this.emit(entry);
    return snapshot(entry.draft);
  }

  activatePlaceholder(
    context: Context,
    seed: string,
  ): DraftState<RecordType, Context> {
    if (this.disposed) throw new Error("Draft coordinator has been disposed.");
    const key = placeholderKey(this.adapter.contextKey(context));
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        draft: {
          key,
          context: { ...context },
          record: null,
          text: seed,
          dirty: false,
          saving: false,
          error: null,
        },
        baseText: seed,
        timer: null,
        inFlight: null,
        blocked: false,
        retryOnActivation: false,
      };
      this.entries.set(key, entry);
    } else if (!entry.draft.dirty && !entry.draft.saving) {
      entry.draft.context = { ...context };
    }
    if (entry.retryOnActivation && entry.draft.dirty && !entry.inFlight) {
      entry.blocked = false;
      entry.retryOnActivation = false;
      entry.draft.error = null;
      this.clearTimer(entry);
      this.scheduleAutoSave(entry);
    }
    this.activeKey = key;
    this.pruneInactive();
    this.emit(entry);
    return snapshot(entry.draft);
  }

  edit(key: string, text: string): DraftState<RecordType, Context> | undefined {
    if (this.disposed) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (text === entry.draft.text) return snapshot(entry.draft);
    entry.draft.text = text;
    entry.draft.dirty = text !== entry.baseText;
    entry.draft.error = null;
    entry.blocked = false;
    entry.retryOnActivation = false;
    this.clearTimer(entry);
    if (entry.draft.dirty && !entry.inFlight) this.scheduleAutoSave(entry);
    this.emit(entry);
    return snapshot(entry.draft);
  }

  /** Surface a concurrent remote change without discarding the local draft. */
  markConflict(key: string): DraftState<RecordType, Context> | undefined {
    if (this.disposed) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // An in-flight write must finish its own revision check first.
    if (!entry.draft.dirty || entry.inFlight || entry.draft.saving)
      return snapshot(entry.draft);
    this.clearTimer(entry);
    entry.blocked = true;
    entry.retryOnActivation = false;
    entry.draft.error = errorMessage({ code: "conflict" }, "");
    this.emit(entry);
    return snapshot(entry.draft);
  }

  private async drain(entry: Entry<RecordType, Context>): Promise<boolean> {
    while (!this.disposed && entry.draft.dirty && !entry.blocked) {
      this.clearTimer(entry);
      const markdown = entry.draft.text;
      const currentRecord = entry.draft.record;
      entry.draft.saving = true;
      this.emit(entry);
      try {
        const saved = currentRecord
          ? await this.saveFn(
              currentRecord.id,
              markdown,
              currentRecord.revision,
            )
          : await this.createFn?.({ ...entry.draft.context }, markdown);
        if (this.disposed) return false;
        if (
          !saved ||
          !saved.id ||
          this.adapter.contextKey(this.adapter.contextForRecord(saved)) !==
            this.adapter.contextKey(entry.draft.context) ||
          (currentRecord
            ? saved.id !== currentRecord.id ||
              saved.revision !== currentRecord.revision + 1
            : saved.revision !== 1) ||
          saved.markdown !== markdown ||
          entry.draft.record !== currentRecord
        ) {
          throw { code: "conflict" };
        }
        entry.draft.record = { ...saved };
        entry.baseText = saved.markdown;
        entry.draft.dirty = entry.draft.text !== saved.markdown;
        entry.draft.error = null;
        entry.draft.saving = false;
        entry.retryOnActivation = false;
        this.emit(entry);
      } catch (error) {
        if (this.disposed) return false;
        entry.draft.saving = false;
        entry.draft.dirty = true;
        entry.draft.error = errorMessage(
          error,
          this.adapter.pageChangedMessage ??
            "Return to this page to save your new note, or export the draft.",
        );
        entry.blocked = true;
        entry.retryOnActivation =
          !currentRecord && errorCode(error) === "page_changed";
        this.emit(entry);
        return false;
      }
    }
    return !entry.draft.dirty;
  }

  private requestSave(
    entry: Entry<RecordType, Context>,
    explicit: boolean,
  ): Promise<boolean> {
    this.clearTimer(entry);
    if (this.disposed) return Promise.resolve(false);
    if (entry.inFlight) return entry.inFlight;
    if (explicit && entry.blocked) {
      entry.blocked = false;
      entry.retryOnActivation = false;
      entry.draft.error = null;
      this.emit(entry);
    }
    if (!entry.draft.dirty || entry.blocked)
      return Promise.resolve(!entry.draft.dirty);
    const operation = this.drain(entry).finally(() => {
      if (entry.inFlight === operation) entry.inFlight = null;
      this.pruneInactive();
    });
    entry.inFlight = operation;
    return operation;
  }

  flush(key: string): Promise<boolean> {
    const entry = this.entries.get(key);
    return entry ? this.requestSave(entry, true) : Promise.resolve(false);
  }

  async flushAll(): Promise<boolean> {
    const pending = [...this.entries.values()]
      .filter((entry) => entry.draft.dirty || entry.inFlight)
      .map((entry) => this.requestSave(entry, true));
    return (await Promise.all(pending)).every(Boolean);
  }

  get(key: string): DraftState<RecordType, Context> | undefined {
    const entry = this.entries.get(key);
    return entry ? snapshot(entry.draft) : undefined;
  }

  dirtyDrafts(): DraftState<RecordType, Context>[] {
    return [...this.entries.values()]
      .filter((entry) => entry.draft.dirty)
      .map((entry) => snapshot(entry.draft));
  }

  hasPendingChanges(): boolean {
    return (
      !this.disposed &&
      [...this.entries.values()].some(
        (entry) =>
          entry.draft.dirty || entry.draft.saving || Boolean(entry.inFlight),
      )
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      this.clearTimer(entry);
      entry.draft.text = "";
      entry.baseText = "";
      if (entry.draft.record) entry.draft.record.markdown = "";
    }
    this.entries.clear();
    this.activeKey = null;
  }
}
