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
  record: RecordType;
  text: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** The last save found other text in storage; cleared by a save or discard. */
  conflict: boolean;
}

export type SaveDocument<RecordType extends VersionedDocument> = (
  id: string,
  markdown: string,
  expectedRevision: number,
) => Promise<RecordType>;
export interface DraftContextAdapter<
  RecordType extends VersionedDocument,
  Context extends object,
> {
  contextForRecord(record: RecordType): Context;
}

/**
 * Recovery from a save conflict. `reload` reads the stored document again and
 * `rebase` returns the draft text carried onto it, or null when the two cannot
 * be combined without losing text. `adopted` reports a draft whose text the
 * coordinator replaced with the rebased text, so that the view can show it.
 */
export interface DraftConflictRecovery<
  RecordType extends VersionedDocument,
  Context extends object,
> {
  reload(id: string): Promise<RecordType>;
  rebase(
    baseText: string,
    draftText: string,
    stored: RecordType,
  ): string | null;
  adopted(draft: DraftState<RecordType, Context>): void;
}

const REBASE_ATTEMPTS = 2;

interface Entry<RecordType extends VersionedDocument, Context extends object> {
  draft: DraftState<RecordType, Context>;
  baseText: string;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<boolean> | null;
  blocked: boolean;
}

export const AUTOSAVE_DELAY_MS = 350;

function snapshot<RecordType extends VersionedDocument, Context extends object>(
  draft: DraftState<RecordType, Context>,
): DraftState<RecordType, Context> {
  return {
    ...draft,
    context: { ...draft.context },
    record: { ...draft.record },
  };
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : null;
}

function errorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === "conflict") {
    return "Could not save. Another window may have changed this note. Export your draft, or discard your changes to load the saved note.";
  }
  if (code === "permission") {
    return "File editing needs permission. Reconnect access to save; your draft is unchanged.";
  }
  if (code === "quota") {
    return "The note file is too large to save (limit 512 KiB). Nothing was truncated; your draft is still here. Shorten the note or export the draft.";
  }
  return "Could not save the note file. Your draft is still here; retry or export it.";
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
    private readonly recovery: DraftConflictRecovery<
      RecordType,
      Context
    > | null = null,
  ) {}

  // Revisions are hashes of the file bytes: equality tokens, never a counter.
  // Reusing a token for different text is not a valid observation or ACK.
  private acceptsRevision(current: RecordType, incoming: RecordType): boolean {
    return (
      Number.isSafeInteger(incoming.revision) &&
      incoming.revision >= 1 &&
      (incoming.revision !== current.revision ||
        incoming.markdown === current.markdown)
    );
  }

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
    let entry = this.entries.get(incoming.id);
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
          conflict: false,
        },
        baseText: incoming.markdown,
        timer: null,
        inFlight: null,
        blocked: false,
      };
      this.entries.set(incoming.id, entry);
    } else if (
      !entry.draft.dirty &&
      !entry.draft.saving &&
      !entry.inFlight &&
      this.acceptsRevision(entry.draft.record, incoming)
    ) {
      entry.draft.record = incoming;
      entry.draft.context = { ...context };
      entry.draft.text = incoming.markdown;
      entry.baseText = incoming.markdown;
      entry.draft.error = null;
      entry.draft.conflict = false;
      entry.blocked = false;
    }
    this.activeKey = entry.draft.key;
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
    this.clearTimer(entry);
    if (entry.draft.dirty && !entry.inFlight) this.scheduleAutoSave(entry);
    this.emit(entry);
    return snapshot(entry.draft);
  }

  /**
   * Drop the local draft and take `record` as the stored document. Nothing is
   * written. Refused while a write is in flight: it must settle first.
   */
  discard(
    key: string,
    record: RecordType,
  ): DraftState<RecordType, Context> | undefined {
    if (this.disposed) return undefined;
    const entry = this.entries.get(key);
    if (!entry || record.id !== key || entry.inFlight || entry.draft.saving)
      return undefined;
    this.clearTimer(entry);
    entry.draft.record = { ...record };
    entry.draft.context = { ...this.adapter.contextForRecord(record) };
    entry.draft.text = entry.baseText = record.markdown;
    entry.draft.dirty = false;
    entry.draft.error = null;
    entry.draft.conflict = false;
    entry.blocked = false;
    this.emit(entry);
    return snapshot(entry.draft);
  }

  /**
   * After a conflict: read the stored document and carry the draft onto it.
   * True when the draft now starts from the stored text and can be saved.
   */
  private async rebase(
    entry: Entry<RecordType, Context>,
    id: string,
  ): Promise<boolean> {
    const recovery = this.recovery;
    if (!recovery) return false;
    let stored: RecordType;
    try {
      stored = await recovery.reload(id);
    } catch {
      return false;
    }
    if (this.disposed || !stored || stored.id !== id) return false;
    // Synchronous from here: the draft text read is the text replaced.
    let text: string | null;
    try {
      text = recovery.rebase(entry.baseText, entry.draft.text, stored);
    } catch {
      text = null;
    }
    if (text === null) return false;
    entry.draft.record = { ...stored };
    entry.baseText = stored.markdown;
    entry.draft.text = text;
    entry.draft.dirty = text !== stored.markdown;
    entry.draft.error = null;
    entry.draft.conflict = false;
    try {
      recovery.adopted(snapshot(entry.draft));
    } catch {
      // A view callback must not interrupt the save that follows.
    }
    return true;
  }

  private async drain(entry: Entry<RecordType, Context>): Promise<boolean> {
    let rebases = 0;
    while (!this.disposed && entry.draft.dirty && !entry.blocked) {
      this.clearTimer(entry);
      const markdown = entry.draft.text;
      const currentRecord = entry.draft.record;
      entry.draft.saving = true;
      this.emit(entry);
      try {
        const saved = await this.saveFn(
          currentRecord.id,
          markdown,
          currentRecord.revision,
        );
        if (this.disposed) return false;
        if (
          !saved ||
          !saved.id ||
          saved.id !== currentRecord.id ||
          !this.acceptsRevision(currentRecord, saved) ||
          saved.markdown !== markdown ||
          entry.draft.record !== currentRecord
        ) {
          throw { code: "conflict" };
        }
        entry.draft.record = { ...saved };
        entry.baseText = saved.markdown;
        entry.draft.dirty = entry.draft.text !== saved.markdown;
        entry.draft.error = null;
        entry.draft.conflict = false;
        entry.draft.saving = false;
        this.emit(entry);
      } catch (error) {
        if (this.disposed) return false;
        const conflict = errorCode(error) === "conflict";
        if (conflict && rebases < REBASE_ATTEMPTS) {
          rebases += 1;
          if (await this.rebase(entry, currentRecord.id)) {
            entry.draft.saving = false;
            this.emit(entry);
            continue;
          }
          if (this.disposed) return false;
        }
        entry.draft.saving = false;
        entry.draft.dirty = true;
        entry.draft.error = errorMessage(error);
        entry.draft.conflict = conflict;
        entry.blocked = true;
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
      entry.draft.error = null;
      this.emit(entry);
    }
    if (!entry.draft.dirty || entry.blocked)
      return Promise.resolve(!entry.draft.dirty);
    const operation = this.drain(entry).finally(() => {
      if (entry.inFlight !== operation) return;
      entry.inFlight = null;
      this.pruneInactive();
      // Host save indicators also observe the outstanding write promise.
      // Publish settlement after clearing it, including when an inactive
      // acknowledged draft has just been pruned.
      this.emit(entry);
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

  /** Include compensating edits while their earlier write is still pending. */
  pendingDrafts(): DraftState<RecordType, Context>[] {
    return [...this.entries.values()]
      .filter(
        (entry) =>
          entry.draft.dirty || entry.draft.saving || Boolean(entry.inFlight),
      )
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
      entry.draft.record.markdown = "";
    }
    this.entries.clear();
    this.activeKey = null;
  }
}
