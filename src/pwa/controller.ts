import {
  createWorkspace,
  PwaError,
  validatePayload,
  type WorkspacePayload,
} from "./model";
import {
  IndexedDbPwaPersistence,
  validateEntityId,
  validateStoredLocalWorkspace,
  type LocalWorkspacePersistence,
  type StoredLocalWorkspace,
} from "./storage";

const storageFailure = () =>
  new PwaError(
    "storage",
    "The browser could not store this change. Keep the app open and retry.",
  );
function workspacePayload(value: unknown): WorkspacePayload {
  const payload = validatePayload(value);
  if (payload.kind !== "workspace")
    throw new PwaError(
      "invalid",
      "A local workspace must contain files and folders.",
    );
  return payload;
}

function initialWorkspace(
  label: string | undefined,
  value: WorkspacePayload | undefined,
): WorkspacePayload {
  if (value === undefined) return createWorkspace(label);
  const payload = workspacePayload(value);
  return label === undefined
    ? payload
    : workspacePayload({ ...payload, label });
}

/** One owner serializes cache mutations; direct file commits remain authoritative. */
export class PwaRepository {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly localWorkspaces = new Map<string, StoredLocalWorkspace>();
  private readonly epochs = new Map<string, number>();
  private closeGeneration = 0;
  constructor(
    private readonly persistence: LocalWorkspacePersistence = new IndexedDbPwaPersistence(),
  ) {}
  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => {});
    return next;
  }
  private localPersistence(): LocalWorkspacePersistence {
    const persistence = this.persistence;
    if (
      !persistence.listLocal ||
      !persistence.readLocal ||
      !persistence.writeLocal ||
      !persistence.removeLocal
    )
      throw new PwaError(
        "storage",
        "This host does not support device-local workspaces.",
      );
    return persistence as LocalWorkspacePersistence;
  }

  private async storedLocal(id: string): Promise<StoredLocalWorkspace> {
    validateEntityId(id);
    let value: unknown;
    try {
      value = await this.localPersistence().readLocal(id);
    } catch (error) {
      throw error instanceof PwaError ? error : storageFailure();
    }
    if (value === null || value === undefined)
      throw new PwaError(
        "missing",
        "This local workspace is no longer on this device.",
      );
    const workspace = validateStoredLocalWorkspace(value);
    if (workspace.id !== id)
      throw new PwaError(
        "invalid",
        "Device storage contains an invalid local workspace identity.",
      );
    return workspace;
  }

  listLocal(): Promise<StoredLocalWorkspace[]> {
    return this.queued(async () => {
      let values: unknown[];
      try {
        values = await this.localPersistence().listLocal();
      } catch (error) {
        throw error instanceof PwaError ? error : storageFailure();
      }
      if (!Array.isArray(values))
        throw new PwaError(
          "invalid",
          "Device storage contains unsupported local workspace data.",
        );
      const records = values.map(validateStoredLocalWorkspace);
      if (new Set(records.map((record) => record.id)).size !== records.length)
        throw new PwaError(
          "invalid",
          "Device storage contains duplicate local workspace identities.",
        );
      return records;
    });
  }

  /** Store the file workspace cache separately from its original files. */
  createLocal(
    label?: string,
    value?: WorkspacePayload,
    disk = false,
  ): Promise<StoredLocalWorkspace> {
    const payload = initialWorkspace(label, value);
    const generation = this.closeGeneration;
    return this.queued(async () => {
      const workspace: StoredLocalWorkspace = {
        format: "aic-local-workspace",
        version: 1,
        id: crypto.randomUUID(),
        revision: 1,
        payload,
        ...(disk ? { storage: "disk" as const } : {}),
      };
      try {
        await this.localPersistence().writeLocal(workspace, null);
      } catch (error) {
        throw error instanceof PwaError ? error : storageFailure();
      }
      if (generation === this.closeGeneration)
        this.localWorkspaces.set(workspace.id, workspace);
      return validateStoredLocalWorkspace(workspace);
    });
  }

  readLocal(id: string): Promise<WorkspacePayload> {
    validateEntityId(id);
    const generation = this.closeGeneration;
    const epoch = this.epochs.get(id) ?? 0;
    return this.queued(async () => {
      const workspace = await this.storedLocal(id);
      if (
        generation !== this.closeGeneration ||
        epoch !== (this.epochs.get(id) ?? 0)
      )
        throw new PwaError(
          "missing",
          "This local workspace was closed. Open it again.",
        );
      this.localWorkspaces.set(id, workspace);
      return workspacePayload(workspace.payload);
    });
  }

  localSnapshot(id: string): WorkspacePayload | null {
    validateEntityId(id);
    const workspace = this.localWorkspaces.get(id);
    return workspace ? workspacePayload(workspace.payload) : null;
  }

  isDiskWorkspace(id: string): boolean {
    return this.localWorkspaces.get(id)?.storage === "disk";
  }

  /** Disk acknowledgement remains authoritative even when its recoverable cache fails. */
  saveLocalToDisk(
    id: string,
    value: WorkspacePayload,
    writeFiles: () => Promise<void>,
  ): Promise<{ cacheWarning?: string }> {
    validateEntityId(id);
    const payload = workspacePayload(value);
    const observed = this.localWorkspaces.get(id);
    if (!observed)
      return Promise.reject(
        new PwaError("missing", "Open this workspace before saving."),
      );
    return this.queued(async () => {
      if (this.localWorkspaces.get(id) !== observed)
        throw new PwaError("missing", "This workspace was closed.");
      await writeFiles();
      const workspace: StoredLocalWorkspace = {
        ...observed,
        payload,
        storage: "disk",
        revision: observed.revision + 1,
      };
      let cacheWarning: string | undefined;
      try {
        await this.localPersistence().writeLocal(workspace, observed.revision);
      } catch (error) {
        cacheWarning = pwaErrorMessage(error);
      }
      if (this.localWorkspaces.get(id) === observed) {
        if (!cacheWarning) observed.revision = workspace.revision;
        observed.payload = payload;
        observed.storage = "disk";
      }
      return cacheWarning ? { cacheWarning } : {};
    });
  }

  updateLocal(
    id: string,
    value: WorkspacePayload,
  ): Promise<StoredLocalWorkspace> {
    validateEntityId(id);
    const payload = workspacePayload(value);
    const observed = this.localWorkspaces.get(id);
    if (!observed)
      return Promise.reject(
        new PwaError("missing", "Open this local workspace before editing it."),
      );
    return this.queued(async () => {
      if (this.localWorkspaces.get(id) !== observed)
        throw new PwaError(
          "missing",
          "This local workspace was closed. Open it again.",
        );
      const workspace: StoredLocalWorkspace = {
        format: "aic-local-workspace",
        version: 1,
        id,
        revision: observed.revision + 1,
        payload,
        ...(observed.storage ? { storage: observed.storage } : {}),
      };
      try {
        await this.localPersistence().writeLocal(workspace, observed.revision);
      } catch (error) {
        throw error instanceof PwaError ? error : storageFailure();
      }
      if (this.localWorkspaces.get(id) === observed) {
        observed.revision = workspace.revision;
        observed.payload = payload;
      }
      return validateStoredLocalWorkspace(workspace);
    });
  }

  /** Disconnect this app cache only; original files are untouched. */
  removeLocal(id: string): Promise<void> {
    validateEntityId(id);
    const observed = this.localWorkspaces.get(id);
    return this.queued(async () => {
      const workspace = observed ?? (await this.storedLocal(id));
      try {
        await this.localPersistence().removeLocal(id, workspace.revision);
      } catch (error) {
        throw error instanceof PwaError ? error : storageFailure();
      }
      this.localWorkspaces.delete(id);
    });
  }

  close(id: string): void {
    validateEntityId(id);
    this.localWorkspaces.delete(id);
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
  }
  closeAll(): void {
    this.localWorkspaces.clear();
    this.closeGeneration++;
  }
}
export function pwaErrorMessage(error: unknown): string {
  return error instanceof PwaError
    ? error.message
    : "Unable to complete this change. Keep the app open and retry.";
}
