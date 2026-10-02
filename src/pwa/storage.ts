import { PwaError, validatePayload, type WorkspacePayload } from "./model";

/** Plain file workspace cache. Original files remain authoritative. */
export interface StoredLocalWorkspace {
  format: "aic-local-workspace";
  version: 1;
  id: string;
  revision: number;
  payload: WorkspacePayload;
  /** Original files are authoritative; missing capabilities must never downgrade to cache saves. */
  storage?: "disk";
}

export interface LocalWorkspacePersistence {
  listLocal(): Promise<unknown[]>;
  readLocal(id: string): Promise<unknown | null>;
  writeLocal(
    workspace: StoredLocalWorkspace,
    expectedRevision: number | null,
  ): Promise<void>;
  removeLocal(id: string, expectedRevision: number): Promise<void>;
}

export function validateEntityId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new PwaError("invalid", "Invalid local entity identity.");
  }
  return value;
}

export function validateStoredLocalWorkspace(
  value: unknown,
): StoredLocalWorkspace {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      ![5, 6].includes(Reflect.ownKeys(value).length)
    )
      throw new Error();
    const fields: Record<string, unknown> = {};
    for (const key of ["format", "version", "id", "revision", "payload"]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new Error();
      fields[key] = descriptor.value;
    }
    if (
      fields.format !== "aic-local-workspace" ||
      fields.version !== 1 ||
      typeof fields.revision !== "number" ||
      !Number.isSafeInteger(fields.revision) ||
      fields.revision < 1
    )
      throw new Error();
    const storage = Object.getOwnPropertyDescriptor(value, "storage");
    if (storage && (!("value" in storage) || storage.value !== "disk"))
      throw new Error();
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          ![
            "format",
            "version",
            "id",
            "revision",
            "payload",
            "storage",
          ].includes(String(key)),
      )
    )
      throw new Error();
    const payload = validatePayload(fields.payload);
    if (payload.kind !== "workspace") throw new Error();
    return {
      format: "aic-local-workspace",
      version: 1,
      id: validateEntityId(fields.id),
      revision: fields.revision,
      payload,
      ...(storage ? { storage: "disk" as const } : {}),
    };
  } catch {
    throw new PwaError(
      "invalid",
      "Device storage contains unsupported or damaged local workspace data.",
    );
  }
}

function expectedRevisionIsValid(value: number | null): void {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) ||
      value < 1 ||
      value >= Number.MAX_SAFE_INTEGER)
  )
    throw new PwaError("invalid", "Invalid save revision.");
}

function assertLocalRevision(
  id: string,
  expectedRevision: number | null,
  current: unknown | null,
): void {
  expectedRevisionIsValid(expectedRevision);
  const existing =
    current === null ? null : validateStoredLocalWorkspace(current);
  if (
    expectedRevision === null
      ? existing !== null
      : existing?.revision !== expectedRevision || existing.id !== id
  )
    throw new PwaError(
      "conflict",
      "This local workspace changed in another tab. Reopen it before saving or removing it.",
    );
}

function assertLocalWrite(
  workspace: StoredLocalWorkspace,
  expectedRevision: number | null,
  current: unknown | null,
): void {
  if (
    workspace.revision !==
    (expectedRevision === null ? 1 : expectedRevision + 1)
  )
    throw new PwaError("invalid", "Invalid local workspace revision.");
  assertLocalRevision(workspace.id, expectedRevision, current);
}

const storageFailure = () =>
  new PwaError(
    "storage",
    "The browser could not store this change. Keep the app open and retry.",
  );

/** IndexedDB's readwrite transaction owns the revision comparison and ciphertext write. */
export class IndexedDbPwaPersistence implements LocalWorkspacePersistence {
  private connection: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly name = "aic-notes-pwa",
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
  ) {}

  private database(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    if (!this.factory) return Promise.reject(storageFailure());
    this.connection = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const request = this.factory!.open(this.name, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("local-workspaces"))
          request.result.createObjectStore("local-workspaces", {
            keyPath: "id",
          });
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(storageFailure());
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        const database = request.result;
        // IndexedDB cannot cancel an open request. A blocked/error request may
        // succeed after callers have retried; that abandoned connection must close.
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => {
          database.close();
          this.connection = null;
        };
        resolve(database);
      };
    }).catch((error: unknown) => {
      this.connection = null;
      throw error instanceof PwaError ? error : storageFailure();
    });
    return this.connection;
  }

  private async readTransaction<T>(
    operation: (store: IDBObjectStore) => IDBRequest<T>,
    storeName = "local-workspaces",
  ): Promise<T> {
    const database = await this.database();
    return new Promise<T>((resolve, reject) => {
      let result: T;
      try {
        const transaction = database.transaction(storeName, "readonly");
        const request = operation(transaction.objectStore(storeName));
        request.onsuccess = () => {
          result = request.result;
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () =>
          reject(storageFailure());
      } catch {
        reject(storageFailure());
      }
    });
  }

  listLocal(): Promise<unknown[]> {
    return this.readTransaction((store) => store.getAll(), "local-workspaces");
  }

  async readLocal(id: string): Promise<unknown | null> {
    validateEntityId(id);
    return (
      (await this.readTransaction(
        (store) => store.get(id),
        "local-workspaces",
      )) ?? null
    );
  }

  async writeLocal(
    value: StoredLocalWorkspace,
    expectedRevision: number | null,
  ): Promise<void> {
    const workspace = validateStoredLocalWorkspace(value);
    expectedRevisionIsValid(expectedRevision);
    await this.mutateLocal(workspace.id, (store, current) => {
      assertLocalWrite(workspace, expectedRevision, current);
      store.put(workspace);
    });
  }

  async removeLocal(id: string, expectedRevision: number): Promise<void> {
    validateEntityId(id);
    expectedRevisionIsValid(expectedRevision);
    await this.mutateLocal(id, (store, current) => {
      assertLocalRevision(id, expectedRevision, current);
      store.delete(id);
    });
  }

  private async mutateLocal(
    id: string,
    mutate: (store: IDBObjectStore, current: unknown | null) => void,
  ): Promise<void> {
    const database = await this.database();
    return new Promise<void>((resolve, reject) => {
      let failure: unknown;
      try {
        const transaction = database.transaction(
          "local-workspaces",
          "readwrite",
        );
        const store = transaction.objectStore("local-workspaces");
        const request = store.get(id);
        request.onsuccess = () => {
          try {
            mutate(store, request.result ?? null);
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(failure instanceof PwaError ? failure : storageFailure());
      } catch {
        reject(storageFailure());
      }
    });
  }
}

/** Deterministic adapter for model tests; uses the same compare-and-swap contract. */
export class MemoryPwaPersistence implements LocalWorkspacePersistence {
  private readonly localWorkspaces = new Map<string, StoredLocalWorkspace>();

  async listLocal(): Promise<unknown[]> {
    return [...this.localWorkspaces.values()].map(validateStoredLocalWorkspace);
  }

  async readLocal(id: string): Promise<unknown | null> {
    const workspace = this.localWorkspaces.get(validateEntityId(id));
    return workspace ? validateStoredLocalWorkspace(workspace) : null;
  }

  async writeLocal(
    value: StoredLocalWorkspace,
    expectedRevision: number | null,
  ): Promise<void> {
    const workspace = validateStoredLocalWorkspace(value);
    assertLocalWrite(
      workspace,
      expectedRevision,
      this.localWorkspaces.get(workspace.id) ?? null,
    );
    this.localWorkspaces.set(workspace.id, workspace);
  }

  async removeLocal(id: string, expectedRevision: number): Promise<void> {
    validateEntityId(id);
    assertLocalRevision(
      id,
      expectedRevision,
      this.localWorkspaces.get(id) ?? null,
    );
    this.localWorkspaces.delete(id);
  }
}
