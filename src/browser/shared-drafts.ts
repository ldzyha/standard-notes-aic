import {
  DraftCoordinator,
  type DraftState,
  type VersionedDocument,
  type DraftContextAdapter,
  type SaveDocument,
  type CreateDocument,
} from "./draft-coordinator";

/** Shared scopes reuse the same autosave, ACK and remote-conflict owner. */
export class SharedDrafts<R extends VersionedDocument, C extends object> {
  private readonly coordinator: DraftCoordinator<R, C>;
  private readonly keyByScope = new Map<string, string>();

  constructor(
    saveFn: SaveDocument<R>,
    private readonly adapter: DraftContextAdapter<R, C>,
    onChangeFn: (draft: DraftState<R, C>) => void = () => undefined,
    createFn?: CreateDocument<R, C>,
  ) {
    this.coordinator = new DraftCoordinator(
      saveFn,
      adapter,
      onChangeFn,
      createFn,
    );
  }

  private remember(scope: string, draft: DraftState<R, C>): DraftState<R, C> {
    this.keyByScope.set(scope, draft.key);
    for (const [knownScope, key] of this.keyByScope) {
      if (!this.coordinator.get(key)) this.keyByScope.delete(knownScope);
    }
    return draft;
  }

  activate(record: R): DraftState<R, C> {
    const scope = this.adapter.contextKey(
      this.adapter.contextForRecord(record),
    );
    const pending = this.coordinator.get(`pending:${scope}`);
    const known = this.keyByScope.get(scope);
    const existing =
      this.coordinator.get(record.id) ??
      pending ??
      (known ? this.coordinator.get(known) : undefined);
    if (existing?.dirty) {
      const current = existing.record;
      const currentPath = current
        ? this.adapter.opaqueRevisionKey?.(current)
        : undefined;
      const incomingPath = this.adapter.opaqueRevisionKey?.(record);
      const changed =
        !current ||
        record.id !== current.id ||
        (currentPath !== undefined || incomingPath !== undefined
          ? currentPath !== incomingPath ||
            record.revision !== current.revision ||
            record.markdown !== current.markdown
          : record.revision > current.revision ||
            (record.revision === current.revision &&
              record.markdown !== current.markdown));
      if (changed) {
        this.coordinator.markConflict(existing.key);
        if (current && record.id !== current.id)
          return this.remember(scope, this.coordinator.activate(current));
      }
    }
    return this.remember(scope, this.coordinator.activate(record));
  }

  activatePlaceholder(context: C, seed = ""): DraftState<R, C> {
    const scope = this.adapter.contextKey(context);
    const known = this.keyByScope.get(scope);
    const existing = known ? this.coordinator.get(known) : undefined;
    if (existing?.dirty && existing.record) {
      this.coordinator.markConflict(existing.key);
      return this.remember(scope, this.coordinator.activate(existing.record));
    }
    return this.remember(
      scope,
      this.coordinator.activatePlaceholder(context, seed),
    );
  }

  edit(key: string, text: string) {
    return this.coordinator.edit(key, text);
  }
  flush(key: string) {
    return this.coordinator.flush(key);
  }
  flushAll() {
    return this.coordinator.flushAll();
  }
  get(key: string) {
    return this.coordinator.get(key);
  }
  dirtyDrafts() {
    return this.coordinator.dirtyDrafts();
  }
  pendingDrafts() {
    return this.coordinator.pendingDrafts();
  }
  hasPendingChanges() {
    return this.coordinator.hasPendingChanges();
  }
  dispose() {
    this.coordinator.dispose();
    this.keyByScope.clear();
  }
}
