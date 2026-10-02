import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PwaRepository } from "../src/pwa/controller";
import {
  createPwaFile,
  createWorkspace,
  fileText,
  type WorkspacePayload,
} from "../src/pwa/model";
import {
  MemoryPwaPersistence,
  IndexedDbPwaPersistence,
  type LocalWorkspacePersistence,
  type StoredLocalWorkspace,
} from "../src/pwa/storage";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
let fixture: WorkspacePayload;
const protectedFixture = {
  id: "untouched-old-data",
  revision: 7,
  envelope: { opaque: "old bytes" },
};

beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  fixture = {
    ...createWorkspace("Synthetic local project"),
    files: [
      createPwaFile(
        "project/notes.md",
        new TextEncoder().encode("# Synthetic local note\r\n"),
        "text/markdown",
        2,
      ),
    ],
    directories: ["project", "project/empty"],
  };
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

function adapter(
  memory: MemoryPwaPersistence,
  shouldFail: (operation: "local-write" | "local-remove") => boolean,
): LocalWorkspacePersistence {
  return {
    listLocal: () => memory.listLocal(),
    readLocal: (id) => memory.readLocal(id),
    writeLocal: (value, expected) =>
      shouldFail("local-write")
        ? Promise.reject(new Error("Synthetic local write failure"))
        : memory.writeLocal(value, expected),
    removeLocal: (id, expected) =>
      shouldFail("local-remove")
        ? Promise.reject(new Error("Synthetic local remove failure"))
        : memory.removeLocal(id, expected),
  };
}

/** A controllable native API double exercises request lifecycle and transaction rollback. */
function indexedDbFactory() {
  const stores = new Map<string, Map<string, unknown>>([
    [
      "entities",
      new Map([[protectedFixture.id, structuredClone(protectedFixture)]]),
    ],
  ]);
  const openings: {
    request: {
      result: IDBDatabase;
      onupgradeneeded: (() => void) | null;
      onsuccess: (() => void) | null;
      onblocked: (() => void) | null;
      onerror: (() => void) | null;
    };
    close: ReturnType<typeof vi.fn>;
    versionchange(): void;
  }[] = [];
  const createStores = vi.fn((name: string) => {
    if (stores.has(name)) throw new Error("Duplicate object store");
    stores.set(name, new Map());
  });
  const open = vi.fn(() => {
    const close = vi.fn();
    const database = {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: createStores,
      onversionchange: null as (() => void) | null,
      close,
      transaction(name: string, mode: "readonly" | "readwrite") {
        const stored = stores.get(name);
        if (!stored) throw new Error("Missing object store");
        const working = new Map(
          [...stored].map(([key, value]) => [key, structuredClone(value)]),
        );
        let pending = 0;
        let aborted = false;
        let completed = false;
        const transaction = {
          oncomplete: null as (() => void) | null,
          onabort: null as (() => void) | null,
          onerror: null as (() => void) | null,
          abort() {
            if (completed || aborted) return;
            aborted = true;
            queueMicrotask(() => transaction.onabort?.());
          },
          objectStore() {
            const request = (result: () => unknown) => {
              pending++;
              const operation = {
                result: undefined as unknown,
                onsuccess: null as (() => void) | null,
              };
              queueMicrotask(() => {
                if (aborted) return;
                operation.result = result();
                operation.onsuccess?.();
                pending--;
                if (pending === 0)
                  queueMicrotask(() => {
                    if (aborted || completed || pending !== 0) return;
                    completed = true;
                    if (mode === "readwrite") stores.set(name, working);
                    transaction.oncomplete?.();
                  });
              });
              return operation;
            };
            return {
              getAll: () =>
                request(() =>
                  [...working.values()].map((value) => structuredClone(value)),
                ),
              get: (id: string) =>
                request(() => structuredClone(working.get(id))),
              put: (value: { id: string }) =>
                request(() => {
                  working.set(value.id, structuredClone(value));
                  return value.id;
                }),
              delete: (id: string) =>
                request(() => {
                  working.delete(id);
                }),
            };
          },
        };
        return transaction;
      },
    };
    const request = {
      result: database as unknown as IDBDatabase,
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onblocked: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    openings.push({
      request,
      close,
      versionchange: () => database.onversionchange?.(),
    });
    return request;
  });
  return {
    factory: { open } as unknown as IDBFactory,
    open,
    openings,
    stores,
    createStores,
  };
}

describe("plain file workspace cache", () => {
  it("persists an explicit local record without a password or cryptographic derivation and reloads all files", async () => {
    const derive = vi.spyOn(webcrypto.subtle, "deriveBits");
    const persistence = new MemoryPwaPersistence();
    const repository = new PwaRepository(persistence);
    const record = await repository.createLocal(undefined, fixture);
    expect(record).toMatchObject({
      format: "aic-local-workspace",
      version: 1,
      revision: 1,
      payload: fixture,
    });
    const stored = (await persistence.listLocal())[0] as StoredLocalWorkspace;
    expect(JSON.stringify(stored)).toContain("project/notes.md");
    expect(stored).not.toHaveProperty("envelope");
    const reloaded = new PwaRepository(persistence);
    expect(reloaded.localSnapshot(record.id)).toBeNull();
    expect(await reloaded.readLocal(record.id)).toEqual(fixture);
    expect(fileText(reloaded.localSnapshot(record.id)!.files[0]!)).toBe(
      "# Synthetic local note\r\n",
    );
    expect(derive).not.toHaveBeenCalled();
  });

  it("returns independent snapshots and retires memory without deleting no-password documents", async () => {
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const record = await repository.createLocal(undefined, fixture);
    record.payload.label = "Mutated return value";
    const snapshot = repository.localSnapshot(record.id)!;
    snapshot.files[0]!.path = "changed.md";
    expect(repository.localSnapshot(record.id)).toEqual(fixture);
    repository.closeAll();
    expect(repository.localSnapshot(record.id)).toBeNull();
    expect((await repository.listLocal())[0]!.payload).toEqual(fixture);
    expect(await repository.readLocal(record.id)).toEqual(fixture);
  });

  it("rejects stale cross-tab saves and deletes while preserving prior memory", async () => {
    const persistence = new MemoryPwaPersistence();
    const first = new PwaRepository(persistence);
    const second = new PwaRepository(persistence);
    const record = await first.createLocal(undefined, fixture);
    await second.readLocal(record.id);
    await first.updateLocal(record.id, {
      ...fixture,
      label: "Latest local label",
    });
    await expect(
      second.updateLocal(record.id, { ...fixture, label: "Stale draft" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(second.removeLocal(record.id)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(second.localSnapshot(record.id)).toEqual(fixture);
    expect((await second.readLocal(record.id)).label).toBe(
      "Latest local label",
    );
    await second.removeLocal(record.id);
    expect(second.localSnapshot(record.id)).toBeNull();
    expect(await first.listLocal()).toEqual([]);
    await expect(first.readLocal(record.id)).rejects.toMatchObject({
      code: "missing",
    });
  });

  it("serializes local saves/removal under the existing single mutation owner", async () => {
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const record = await repository.createLocal(undefined, fixture);
    const writes = await Promise.all([
      repository.updateLocal(record.id, { ...fixture, label: "First change" }),
      repository.updateLocal(record.id, { ...fixture, label: "Second change" }),
    ]);
    expect(writes.map((entry) => entry.revision)).toEqual([2, 3]);
    expect(repository.localSnapshot(record.id)?.label).toBe("Second change");
    await repository.removeLocal(record.id);
    expect(await repository.listLocal()).toEqual([]);
  });

  it("preserves saved data and drafts when local writes or removals fail, then retries", async () => {
    const memory = new MemoryPwaPersistence();
    let fail: "local-write" | "local-remove" | null = null;
    const repository = new PwaRepository(
      adapter(memory, (operation) => operation === fail),
    );
    const record = await repository.createLocal(undefined, fixture);
    const draft = { ...fixture, label: "Unsaved local draft" };
    fail = "local-write";
    await expect(
      repository.updateLocal(record.id, draft),
    ).rejects.toMatchObject({ code: "storage" });
    expect(repository.localSnapshot(record.id)).toEqual(fixture);
    expect((await repository.listLocal())[0]!.payload).toEqual(fixture);
    expect(draft.label).toBe("Unsaved local draft");
    fail = "local-remove";
    await expect(repository.removeLocal(record.id)).rejects.toMatchObject({
      code: "storage",
    });
    expect(repository.localSnapshot(record.id)).toEqual(fixture);
    fail = null;
    expect((await repository.updateLocal(record.id, draft)).revision).toBe(2);
    await repository.removeLocal(record.id);
  });

  it("shares workspace validation and fails closed on corrupt plaintext records without rewriting unrelated stored data", async () => {
    const persistence = new MemoryPwaPersistence();
    const write = vi.spyOn(persistence, "writeLocal");
    const repository = new PwaRepository(persistence);
    const invalid = {
      ...fixture,
      files: [...fixture.files, { ...fixture.files[0]!, id: "duplicate-path" }],
    };
    expect(() => repository.createLocal(undefined, invalid)).toThrow();
    expect(write).not.toHaveBeenCalled();
    const damaged: LocalWorkspacePersistence = {
      listLocal: async () => [
        {
          format: "aic-local-workspace",
          version: 2,
          id: "damaged",
          revision: 1,
          payload: fixture,
        },
      ],
      readLocal: async () => ({
        format: "aic-local-workspace",
        version: 1,
        id: "damaged",
        revision: 1,
        payload: { ...fixture, files: "unsupported" },
      }),
      writeLocal: vi.fn(),
      removeLocal: vi.fn(),
    };
    const corruptRepository = new PwaRepository(damaged);
    await expect(corruptRepository.listLocal()).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(corruptRepository.readLocal("damaged")).rejects.toMatchObject({
      code: "invalid",
    });
    expect(damaged.writeLocal).not.toHaveBeenCalled();
    expect(damaged.removeLocal).not.toHaveBeenCalled();
  });
});

describe("default IndexedDB local workspace upgrade", () => {
  it("adds the local store without rewriting protected records and compares deletion revisions inside the transaction", async () => {
    const fixtureDb = indexedDbFactory();
    const persistence = new IndexedDbPwaPersistence(
      "synthetic-upgrade",
      fixtureDb.factory,
    );
    const listing = persistence.listLocal();
    expect(fixtureDb.open).toHaveBeenCalledWith("synthetic-upgrade", 2);
    const opening = fixtureDb.openings[0]!;
    opening.request.onupgradeneeded!();
    expect(fixtureDb.createStores).toHaveBeenCalledWith("local-workspaces", {
      keyPath: "id",
    });
    expect(fixtureDb.createStores).toHaveBeenCalledTimes(1);
    opening.request.onsuccess!();
    expect(await listing).toEqual([]);
    const local: StoredLocalWorkspace = {
      format: "aic-local-workspace",
      version: 1,
      id: "local-fixture",
      revision: 1,
      payload: fixture,
    };
    await persistence.writeLocal(local, null);
    await persistence.writeLocal(
      {
        ...local,
        revision: 2,
        payload: { ...fixture, label: "Updated local" },
      },
      1,
    );
    await expect(persistence.removeLocal(local.id, 1)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      ((await persistence.readLocal(local.id)) as StoredLocalWorkspace)
        .revision,
    ).toBe(2);
    await persistence.removeLocal(local.id, 2);
    expect(await persistence.listLocal()).toEqual([]);
    expect(fixtureDb.stores.get("entities")?.get(protectedFixture.id)).toEqual(
      protectedFixture,
    );
  });

  it.each(["onblocked", "onerror"] as const)(
    "closes a late successful connection after %s and opens a fresh connection after retry/versionchange",
    async (failure) => {
      const fixtureDb = indexedDbFactory();
      const persistence = new IndexedDbPwaPersistence(
        "synthetic-upgrade",
        fixtureDb.factory,
      );
      const blocked = persistence.listLocal();
      const abandoned = fixtureDb.openings[0]!;
      abandoned.request[failure]!();
      await expect(blocked).rejects.toMatchObject({ code: "storage" });
      const retry = persistence.listLocal();
      const active = fixtureDb.openings[1]!;
      active.request.onupgradeneeded!();
      active.request.onsuccess!();
      expect(await retry).toEqual([]);
      abandoned.request.onsuccess!();
      expect(abandoned.close).toHaveBeenCalledOnce();
      expect(active.close).not.toHaveBeenCalled();
      expect(await persistence.listLocal()).toEqual([]);
      expect(fixtureDb.open).toHaveBeenCalledTimes(2);
      active.versionchange();
      expect(active.close).toHaveBeenCalledOnce();
      const reopened = persistence.listLocal();
      fixtureDb.openings[2]!.request.onsuccess!();
      expect(await reopened).toEqual([]);
      expect(fixtureDb.open).toHaveBeenCalledTimes(3);
    },
  );
});
