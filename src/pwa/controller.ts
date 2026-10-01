import {
  createVault,
  sealVault,
  unlockVault,
  validateEnvelope,
  VaultError,
  type VaultSession,
} from "../browser/vault-crypto";
import {
  createWorkspace,
  parsePayload,
  PwaError,
  serializePayload,
  validatePayload,
  type PwaPayload,
  type WorkspacePayload,
} from "./model";
import {
  IndexedDbPwaPersistence,
  validateEntityId,
  validateStoredEntity,
  validateStoredLocalWorkspace,
  type LocalWorkspacePersistence,
  type PwaDevicePersistence,
  type StoredPwaEntity,
  type StoredLocalWorkspace,
} from "./storage";

interface UnlockedEntity {
  revision: number;
  session: VaultSession;
  payload: PwaPayload;
}

export interface SourceSaveResult {
  entity: StoredPwaEntity;
  ciphertext: string;
  /** The authoritative file saved successfully; this warning concerns only its device cache. */
  cacheWarning?: string;
}

export interface SourceImportResult extends StoredPwaEntity {
  cacheWarning?: string;
}

const storageFailure = () =>
  new PwaError(
    "storage",
    "The browser could not store this change. Keep the app open and retry.",
  );
const locked = () =>
  new PwaError("locked", "Unlock this entity before editing it.");
const MAX_ENCRYPTED_IMPORT_LENGTH = 9 * 1024 * 1024;

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

/** One owner serializes mutations and keeps explicitly local plaintext separate from protected entities. */
export class PwaRepository {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly sessions = new Map<string, UnlockedEntity>();
  private readonly localWorkspaces = new Map<string, StoredLocalWorkspace>();
  private readonly epochs = new Map<string, number>();
  private lockGeneration = 0;

  constructor(
    private readonly persistence: PwaDevicePersistence = new IndexedDbPwaPersistence(),
  ) {}

  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => {});
    return next;
  }

  private async persist(
    entity: StoredPwaEntity,
    expectedRevision: number | null,
  ): Promise<void> {
    try {
      await this.persistence.write(entity, expectedRevision);
    } catch (error) {
      throw error instanceof PwaError ? error : storageFailure();
    }
  }

  private async stored(id: string): Promise<StoredPwaEntity> {
    validateEntityId(id);
    let value: unknown;
    try {
      value = await this.persistence.read(id);
    } catch (error) {
      throw error instanceof PwaError ? error : storageFailure();
    }
    if (value === null || value === undefined)
      throw new PwaError("missing", "This entity is no longer on this device.");
    const entity = validateStoredEntity(value);
    if (entity.id !== id)
      throw new PwaError(
        "invalid",
        "Device storage contains an invalid entity identity.",
      );
    return entity;
  }

  list(): Promise<StoredPwaEntity[]> {
    return this.queued(async () => {
      let values: unknown[];
      try {
        values = await this.persistence.list();
      } catch (error) {
        throw error instanceof PwaError ? error : storageFailure();
      }
      if (!Array.isArray(values))
        throw new PwaError(
          "invalid",
          "Device storage contains unsupported entity data.",
        );
      const entities = values.map(validateStoredEntity);
      if (new Set(entities.map((entity) => entity.id)).size !== entities.length)
        throw new PwaError(
          "invalid",
          "Device storage contains duplicate entity identities.",
        );
      return entities;
    });
  }

  create(
    password: string,
    label?: string,
    value?: WorkspacePayload,
  ): Promise<StoredPwaEntity> {
    const generation = this.lockGeneration;
    let payload: WorkspacePayload;
    try {
      payload = initialWorkspace(label, value);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.queued(async () => {
      const id = crypto.randomUUID();
      const { envelope, session } = await createVault(
        password,
        serializePayload(payload),
      );
      const entity = { id, revision: 1, envelope };
      await this.persist(entity, null);
      if (generation === this.lockGeneration)
        this.sessions.set(id, { revision: 1, session, payload });
      return validateStoredEntity(entity);
    });
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
    return persistence as PwaDevicePersistence & LocalWorkspacePersistence;
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

  /** Explicit no-password creation stores the validated workspace in its plaintext store only. */
  createLocal(
    label?: string,
    value?: WorkspacePayload,
  ): Promise<StoredLocalWorkspace> {
    const payload = initialWorkspace(label, value);
    const generation = this.lockGeneration;
    return this.queued(async () => {
      const workspace: StoredLocalWorkspace = {
        format: "aic-local-workspace",
        version: 1,
        id: crypto.randomUUID(),
        revision: 1,
        payload,
      };
      try {
        await this.localPersistence().writeLocal(workspace, null);
      } catch (error) {
        throw error instanceof PwaError ? error : storageFailure();
      }
      if (generation === this.lockGeneration)
        this.localWorkspaces.set(workspace.id, workspace);
      return validateStoredLocalWorkspace(workspace);
    });
  }

  readLocal(id: string): Promise<WorkspacePayload> {
    validateEntityId(id);
    const generation = this.lockGeneration;
    const epoch = this.epochs.get(id) ?? 0;
    return this.queued(async () => {
      const workspace = await this.storedLocal(id);
      if (
        generation !== this.lockGeneration ||
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

  /** Removal is an explicit plaintext-only action; protected copies and source files remain separate. */
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

  unlock(id: string, password: string): Promise<PwaPayload> {
    validateEntityId(id);
    const epoch = this.epochs.get(id) ?? 0;
    const generation = this.lockGeneration;
    return this.queued(async () => {
      const entity = await this.stored(id);
      const opened = await unlockVault(entity.envelope, password);
      const payload = parsePayload(opened.plaintext);
      if (
        epoch !== (this.epochs.get(id) ?? 0) ||
        generation !== this.lockGeneration
      )
        throw locked();
      this.sessions.set(id, {
        revision: entity.revision,
        session: opened.session,
        payload,
      });
      return validatePayload(payload);
    });
  }

  /** Lock is immediate, even while an expensive derivation/save is pending. */
  lock(id: string): void {
    validateEntityId(id);
    this.sessions.delete(id);
    this.localWorkspaces.delete(id);
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
  }

  lockAll(): void {
    this.sessions.clear();
    this.localWorkspaces.clear();
    this.lockGeneration++;
  }

  snapshot(id: string): PwaPayload | null {
    validateEntityId(id);
    const state = this.sessions.get(id);
    return state ? validatePayload(state.payload) : null;
  }

  update(id: string, value: PwaPayload): Promise<StoredPwaEntity> {
    validateEntityId(id);
    // Capture and validate intent before queuing so callers cannot mutate a pending save.
    const payload = validatePayload(value);
    const observed = this.sessions.get(id);
    if (!observed) return Promise.reject(locked());
    return this.queued(async () => {
      if (this.sessions.get(id) !== observed) throw locked();
      const envelope = await sealVault(
        serializePayload(payload),
        observed.session,
      );
      if (this.sessions.get(id) !== observed) throw locked();
      const entity = { id, revision: observed.revision + 1, envelope };
      await this.persist(entity, observed.revision);
      // A failed write leaves the last saved snapshot intact. Locking never resurrects it.
      if (this.sessions.get(id) === observed) {
        observed.revision = entity.revision;
        observed.payload = payload;
      }
      return validateStoredEntity(entity);
    });
  }

  /** Save the user's shared file first, then cache its identical ciphertext. */
  saveToSource(
    id: string,
    value: PwaPayload,
    writeSource: (ciphertext: string) => Promise<void>,
  ): Promise<SourceSaveResult> {
    validateEntityId(id);
    const payload = validatePayload(value);
    const observed = this.sessions.get(id);
    if (!observed) return Promise.reject(locked());
    return this.queued(async () => {
      if (this.sessions.get(id) !== observed) throw locked();
      // Browser libraries retain the extension's existing portable plaintext schema.
      const plaintext =
        payload.kind === "browser-library"
          ? JSON.stringify(payload.library)
          : serializePayload(payload);
      const envelope = await sealVault(plaintext, observed.session);
      if (this.sessions.get(id) !== observed) throw locked();
      const ciphertext = JSON.stringify(envelope);
      await writeSource(ciphertext);
      const entity = { id, revision: observed.revision + 1, envelope };
      let cacheWarning: string | undefined;
      try {
        await this.persist(entity, observed.revision);
      } catch (error) {
        cacheWarning = pwaErrorMessage(error);
      }
      // A file acknowledgment is a save even when a secondary cache is unavailable.
      if (this.sessions.get(id) === observed) {
        if (cacheWarning === undefined) observed.revision = entity.revision;
        observed.payload = payload;
      }
      return {
        entity: validateStoredEntity(entity),
        ciphertext,
        ...(cacheWarning === undefined ? {} : { cacheWarning }),
      };
    });
  }

  importEncrypted(
    serialized: string,
    password: string,
    existingId?: string,
  ): Promise<SourceImportResult> {
    if (existingId !== undefined)
      return this.refreshFromSource(existingId, serialized, password);
    const generation = this.lockGeneration;
    return this.queued(async () => {
      if (
        typeof serialized !== "string" ||
        serialized.length > MAX_ENCRYPTED_IMPORT_LENGTH
      )
        throw new PwaError("limit", "This encrypted file is too large.");
      let raw: unknown;
      try {
        raw = JSON.parse(serialized);
      } catch {
        throw new PwaError("invalid", "Choose an encrypted AIC file.");
      }
      const envelope = validateEnvelope(raw);
      const opened = await unlockVault(envelope, password);
      const payload = parsePayload(opened.plaintext);
      const entity = { id: crypto.randomUUID(), revision: 1, envelope };
      await this.persist(entity, null);
      if (generation === this.lockGeneration)
        this.sessions.set(entity.id, {
          revision: 1,
          session: opened.session,
          payload,
        });
      return validateStoredEntity(entity);
    });
  }

  /** Reopen the same synced source without creating a second local identity. */
  refreshFromSource(
    id: string,
    serialized: string,
    password: string,
  ): Promise<SourceImportResult> {
    validateEntityId(id);
    const epoch = this.epochs.get(id) ?? 0;
    const generation = this.lockGeneration;
    return this.queued(async () => {
      if (
        typeof serialized !== "string" ||
        serialized.length > MAX_ENCRYPTED_IMPORT_LENGTH
      )
        throw new PwaError("limit", "This encrypted file is too large.");
      let incoming: unknown;
      try {
        incoming = JSON.parse(serialized);
      } catch {
        throw new PwaError("invalid", "Choose an encrypted AIC file.");
      }
      const envelope = validateEnvelope(incoming);
      const previous = await this.stored(id);
      if (previous.envelope.kdf.salt !== envelope.kdf.salt)
        throw new PwaError(
          "conflict",
          "This file belongs to another password scope. Open it as a separate entity.",
        );
      const opened = await unlockVault(envelope, password);
      const payload = parsePayload(opened.plaintext);
      if (
        epoch !== (this.epochs.get(id) ?? 0) ||
        generation !== this.lockGeneration
      )
        throw locked();
      const entity = { id, revision: previous.revision + 1, envelope };
      let cacheWarning: string | undefined;
      try {
        await this.persist(entity, previous.revision);
      } catch (error) {
        cacheWarning = pwaErrorMessage(error);
      }
      if (
        epoch !== (this.epochs.get(id) ?? 0) ||
        generation !== this.lockGeneration
      )
        throw locked();
      this.sessions.set(id, {
        revision:
          cacheWarning === undefined ? entity.revision : previous.revision,
        session: opened.session,
        payload,
      });
      return {
        ...validateStoredEntity(entity),
        ...(cacheWarning === undefined ? {} : { cacheWarning }),
      };
    });
  }

  /** Recovery export encrypts an unsaved draft without touching its stale source or cache. */
  exportDraftEncrypted(id: string, value: PwaPayload): Promise<string> {
    validateEntityId(id);
    const payload = validatePayload(value);
    const observed = this.sessions.get(id);
    if (!observed) return Promise.reject(locked());
    return this.queued(async () => {
      if (this.sessions.get(id) !== observed) throw locked();
      const plaintext =
        payload.kind === "browser-library"
          ? JSON.stringify(payload.library)
          : serializePayload(payload);
      const envelope = await sealVault(plaintext, observed.session);
      if (this.sessions.get(id) !== observed) throw locked();
      return JSON.stringify(envelope);
    });
  }

  /** Locked export is safe: exports the exact saved ciphertext and never a draft. */
  exportEncrypted(id: string): Promise<string> {
    return this.queued(async () =>
      JSON.stringify((await this.stored(id)).envelope),
    );
  }

  /** Extension adapter retains the full validated library including history and shared scopes. */
  exportExtensionEncrypted(id: string): Promise<string> {
    validateEntityId(id);
    return this.queued(async () => {
      const state = this.sessions.get(id);
      if (!state) throw locked();
      if (state.payload.kind !== "browser-library")
        throw new PwaError(
          "invalid",
          "This entity is a file workspace, not an extension library.",
        );
      const envelope = await sealVault(
        JSON.stringify(state.payload.library),
        state.session,
      );
      if (this.sessions.get(id) !== state) throw locked();
      return JSON.stringify(envelope);
    });
  }
}

/** Shared crypto errors intentionally keep their existing safe password messages. */
export function pwaErrorMessage(error: unknown): string {
  return error instanceof PwaError || error instanceof VaultError
    ? error.message
    : "Unable to complete this change. Keep the app open and retry.";
}
