import type { BrowserDomain } from "./library";
import { DraftCoordinator, type DraftState } from "./draft-coordinator";

export interface DomainContext {
  origin: string;
  title: string;
}

export type DomainDraft = DraftState<BrowserDomain, DomainContext>;

export type DomainSaveFn = (
  id: string,
  markdown: string,
  expectedRevision: number,
) => Promise<BrowserDomain>;
export type DomainCreateFn = (
  context: DomainContext,
  markdown: string,
) => Promise<BrowserDomain>;

/** Domain Properties drafts use the same ACK and retry protocol as page notes. */
export class DomainDrafts {
  private readonly coordinator: DraftCoordinator<BrowserDomain, DomainContext>;
  private readonly keyByOrigin = new Map<string, string>();

  constructor(
    saveFn: DomainSaveFn,
    onChangeFn: (draft: DomainDraft) => void = () => undefined,
    createFn?: DomainCreateFn,
  ) {
    this.coordinator = new DraftCoordinator(
      saveFn,
      {
        contextKey: (context) => context.origin,
        contextForRecord: (record) => ({
          origin: record.origin,
          title: new URL(record.origin).host,
        }),
        pageChangedMessage:
          "Return to this domain to save your new Properties, or export the draft.",
      },
      onChangeFn,
      createFn,
    );
  }

  private remember(origin: string, draft: DomainDraft): DomainDraft {
    this.keyByOrigin.set(origin, draft.key);
    // The coordinator prunes clean inactive entries on activation. Retain
    // mappings only for drafts that still exist (including dirty or in-flight).
    for (const [knownOrigin, key] of this.keyByOrigin) {
      if (!this.coordinator.get(key)) this.keyByOrigin.delete(knownOrigin);
    }
    return draft;
  }

  activate(record: BrowserDomain): DomainDraft {
    const pending = this.coordinator.get(`pending:${record.origin}`);
    const known = this.keyByOrigin.get(record.origin);
    const existing =
      this.coordinator.get(record.id) ??
      pending ??
      (known ? this.coordinator.get(known) : undefined);
    if (
      existing?.dirty &&
      (!existing.record ||
        record.id !== existing.record.id ||
        record.revision > existing.record.revision ||
        (record.revision === existing.record.revision &&
          record.markdown !== existing.record.markdown))
    ) {
      this.coordinator.markConflict(existing.key);
      // A replacement ID must not strand the old dirty draft behind a newly
      // activated record. Keep it visible until the user resolves the conflict.
      if (existing.record && record.id !== existing.record.id)
        return this.remember(
          record.origin,
          this.coordinator.activate(existing.record),
        );
    }
    return this.remember(record.origin, this.coordinator.activate(record));
  }

  activatePlaceholder(context: DomainContext, seed: string): DomainDraft {
    const known = this.keyByOrigin.get(context.origin);
    const existing = known ? this.coordinator.get(known) : undefined;
    if (existing?.dirty && existing.record) {
      this.coordinator.markConflict(existing.key);
      return this.remember(
        context.origin,
        this.coordinator.activate(existing.record),
      );
    }
    return this.remember(
      context.origin,
      this.coordinator.activatePlaceholder(context, seed),
    );
  }

  edit(key: string, text: string): DomainDraft | undefined {
    return this.coordinator.edit(key, text);
  }

  flush(key: string): Promise<boolean> {
    return this.coordinator.flush(key);
  }

  flushAll(): Promise<boolean> {
    return this.coordinator.flushAll();
  }

  get(key: string): DomainDraft | undefined {
    return this.coordinator.get(key);
  }

  dirtyDrafts(): DomainDraft[] {
    return this.coordinator.dirtyDrafts();
  }

  hasPendingChanges(): boolean {
    return this.coordinator.hasPendingChanges();
  }

  dispose(): void {
    this.coordinator.dispose();
    this.keyByOrigin.clear();
  }
}
