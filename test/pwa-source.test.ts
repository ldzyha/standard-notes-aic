import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createVault,
  sealVault,
  unlockVault,
} from "../src/browser/vault-crypto";
import { PwaRepository } from "../src/pwa/controller";
import { createWorkspace, PwaError, serializePayload } from "../src/pwa/model";
import { MemoryPwaPersistence, type PwaPersistence } from "../src/pwa/storage";
import {
  createEncryptedSource,
  MAX_ENCRYPTED_SOURCE_BYTES,
  openEncryptedSource,
  rememberSource,
  reopenSource,
  requestSourcePermission,
  sourceFromHandle,
  sourceFromHost,
  type EncryptedFileHandle,
  type SourceBindingPersistence,
} from "../src/pwa/source";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
const password = "synthetic shared-file password";
let backup: string;

beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  backup = JSON.stringify(
    (
      await createVault(
        password,
        serializePayload(createWorkspace("Original label")),
      )
    ).envelope,
  );
});
afterEach(() => {
  Reflect.deleteProperty(window, "showOpenFilePicker");
  Reflect.deleteProperty(window, "showSaveFilePicker");
});
afterAll(() => vi.unstubAllGlobals());

function fakeHandle(initial = "synthetic-old-ciphertext") {
  let text = initial;
  let permission: PermissionState = "granted";
  let pending = "";
  const abort = vi.fn(async () => {});
  const close = vi.fn(async () => {
    text = pending;
  });
  const write = vi.fn(async (next: string) => {
    pending = next;
  });
  const handle: EncryptedFileHandle = {
    kind: "file",
    name: "shared.aicnotes",
    getFile: vi.fn(async () => ({
      size: new TextEncoder().encode(text).length,
      text: async () => text,
    })),
    createWritable: vi.fn(async () => ({ write, close, abort })),
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => {
      permission = "granted";
      return permission;
    }),
  };
  return {
    handle,
    write,
    close,
    abort,
    text: () => text,
    replace: (next: string) => {
      text = next;
    },
    permission: (next: PermissionState) => {
      permission = next;
    },
  };
}

function bindings(): SourceBindingPersistence & {
  handles: Map<string, EncryptedFileHandle>;
} {
  const handles = new Map<string, EncryptedFileHandle>();
  return {
    handles,
    read: async (id) => handles.get(id) ?? null,
    write: async (id, handle) => {
      handles.set(id, handle);
    },
  };
}

describe("user-selected authoritative encrypted sources", () => {
  it("compares exact ciphertext, writes through an exclusive buffered stream and preserves names as display only", async () => {
    const fixture = fakeHandle();
    const source = sourceFromHandle(fixture.handle);
    expect(source.name).toBe("shared.aicnotes");
    expect(await source.read()).toBe("synthetic-old-ciphertext");
    await source.write("synthetic-new-ciphertext", "synthetic-old-ciphertext");
    expect(fixture.handle.createWritable).toHaveBeenCalledWith({
      keepExistingData: false,
      mode: "exclusive",
    });
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.text()).toBe("synthetic-new-ciphertext");
    await expect(
      source.write("overwrite", "synthetic-old-ciphertext"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(fixture.text()).toBe("synthetic-new-ciphertext");
  });

  it("creates only an empty file when no previous ciphertext was observed", async () => {
    const empty = fakeHandle("");
    await sourceFromHandle(empty.handle).write("first-ciphertext", null);
    expect(empty.text()).toBe("first-ciphertext");
    const existing = fakeHandle("external-ciphertext");
    await expect(
      sourceFromHandle(existing.handle).write("overwrite", null),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(existing.handle.createWritable).not.toHaveBeenCalled();
  });

  it("detects externally changed content during buffered writing and aborts without overwriting it", async () => {
    const fixture = fakeHandle();
    fixture.write.mockImplementation(async () => {
      fixture.replace("external-edit");
    });
    await expect(
      sourceFromHandle(fixture.handle).write(
        "our-edit",
        "synthetic-old-ciphertext",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(fixture.abort).toHaveBeenCalledOnce();
    expect(fixture.close).not.toHaveBeenCalled();
    expect(fixture.text()).toBe("external-edit");
  });

  it("aborts cancelled and failed writes while retaining the earlier file", async () => {
    const fixture = fakeHandle();
    fixture.write.mockRejectedValue(
      new DOMException("Synthetic cancellation", "AbortError"),
    );
    await expect(
      sourceFromHandle(fixture.handle).write(
        "our-edit",
        "synthetic-old-ciphertext",
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.abort).toHaveBeenCalledOnce();
    expect(fixture.text()).toBe("synthetic-old-ciphertext");
  });

  it("bounds source size before reads/writes and rejects lossy UTF-8 sources", async () => {
    const fixture = fakeHandle();
    await expect(
      sourceFromHandle(fixture.handle).write(
        "x".repeat(MAX_ENCRYPTED_SOURCE_BYTES + 1),
        null,
      ),
    ).rejects.toMatchObject({ code: "limit" });
    expect(fixture.handle.createWritable).not.toHaveBeenCalled();
    const text = vi.fn(async () => "{}");
    fixture.handle.getFile = async () => ({
      size: MAX_ENCRYPTED_SOURCE_BYTES + 1,
      text,
    });
    await expect(sourceFromHandle(fixture.handle).read()).rejects.toMatchObject(
      { code: "limit" },
    );
    expect(text).not.toHaveBeenCalled();
    fixture.handle.getFile = async () => ({ size: 3, text });
    await expect(sourceFromHandle(fixture.handle).read()).rejects.toMatchObject(
      { code: "invalid" },
    );
  });

  it("opens and creates from native picker user actions and handles cancellation", async () => {
    const fixture = fakeHandle("");
    const open = vi.fn(async () => [fixture.handle]);
    const save = vi.fn(async () => fixture.handle);
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: open,
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: save,
    });
    expect((await openEncryptedSource())?.name).toBe("shared.aicnotes");
    expect(open).toHaveBeenCalledWith({ multiple: false, mode: "readwrite" });
    await createEncryptedSource();
    expect(save).toHaveBeenCalledWith({ suggestedName: "aic-notes.aicnotes" });
    open.mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    save.mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    expect(await openEncryptedSource()).toBeNull();
    expect(await createEncryptedSource()).toBeNull();
  });

  it("does not prompt on restoration; permission requests happen only through the explicit helper", async () => {
    const fixture = fakeHandle();
    const persistence = bindings();
    const source = sourceFromHandle(fixture.handle);
    expect(await rememberSource("synthetic-entity", source, persistence)).toBe(
      true,
    );
    fixture.permission("prompt");
    expect(await reopenSource("synthetic-entity", persistence)).toBeNull();
    expect(fixture.handle.requestPermission).not.toHaveBeenCalled();
    await expect(
      source.write("edit", "synthetic-old-ciphertext"),
    ).rejects.toMatchObject({ code: "storage" });
    expect(fixture.handle.requestPermission).not.toHaveBeenCalled();
    expect(await requestSourcePermission(source)).toBe(true);
    expect(fixture.handle.requestPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
    expect((await reopenSource("synthetic-entity", persistence))?.name).toBe(
      "shared.aicnotes",
    );
    expect(await reopenSource("missing", persistence)).toBeNull();
  });

  it("uses a host bridge expected-ciphertext contract without persisting a host capability", async () => {
    let current = "original";
    const host = {
      readSource: vi.fn(async () => current),
      writeSource: vi.fn(async (next: string, expected: string) => {
        if (current !== expected) throw new PwaError("conflict", "Changed");
        current = next;
      }),
    };
    const source = sourceFromHost(host);
    await source.write("next", "original");
    expect(host.writeSource).toHaveBeenCalledWith("next", "original");
    expect(await source.read()).toBe("next");
    await expect(source.write("overwrite", "original")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await rememberSource("entity", source, bindings())).toBe(false);
  });
});

describe("shared file save acknowledgments and device cache", () => {
  it("exports a conflicted unsaved draft without changing its source, cache or saved memory", async () => {
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const entity = await repository.importEncrypted(backup, password);
    const draft = createWorkspace("Conflict recovery draft");
    const encrypted = await repository.exportDraftEncrypted(entity.id, draft);
    expect(
      JSON.parse(
        (await unlockVault(JSON.parse(encrypted), password)).plaintext,
      ),
    ).toEqual(draft);
    expect(await repository.exportEncrypted(entity.id)).toBe(backup);
    expect(repository.snapshot(entity.id)?.label).toBe("Original label");
  });

  it("reopens the same source with a stable identity and rejects another password scope", async () => {
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const entity = await repository.importEncrypted(backup, password);
    const opened = await unlockVault(JSON.parse(backup), password);
    const external = JSON.stringify(
      await sealVault(
        serializePayload(createWorkspace("External edit")),
        opened.session,
      ),
    );
    const refreshed = await repository.importEncrypted(
      external,
      password,
      entity.id,
    );
    expect(refreshed.id).toBe(entity.id);
    expect(refreshed.revision).toBe(2);
    expect(await repository.list()).toHaveLength(1);
    expect(repository.snapshot(entity.id)?.label).toBe("External edit");
    expect(await repository.exportEncrypted(entity.id)).toBe(external);
    const anotherScope = JSON.stringify(
      (await createVault(password, serializePayload(createWorkspace())))
        .envelope,
    );
    await expect(
      repository.refreshFromSource(entity.id, anotherScope, password),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(repository.snapshot(entity.id)?.label).toBe("External edit");
  });

  it("opens an authoritative source update with a cache warning when the cache cannot be written", async () => {
    const memory = new MemoryPwaPersistence();
    let failCache = false;
    const persistence: PwaPersistence = {
      read: (id) => memory.read(id),
      list: () => memory.list(),
      write: (entity, expected) =>
        failCache
          ? Promise.reject(new Error("Synthetic cache failure"))
          : memory.write(entity, expected),
    };
    const repository = new PwaRepository(persistence);
    const entity = await repository.importEncrypted(backup, password);
    const opened = await unlockVault(JSON.parse(backup), password);
    const external = JSON.stringify(
      await sealVault(
        serializePayload(createWorkspace("Authoritative external edit")),
        opened.session,
      ),
    );
    failCache = true;
    const refreshed = await repository.refreshFromSource(
      entity.id,
      external,
      password,
    );
    expect(refreshed.cacheWarning).toBeTypeOf("string");
    expect(repository.snapshot(entity.id)?.label).toBe(
      "Authoritative external edit",
    );
    expect(await repository.exportEncrypted(entity.id)).toBe(backup);
    failCache = false;
    const retry = await repository.saveToSource(
      entity.id,
      createWorkspace("Cache recovery"),
      async () => {},
    );
    expect(retry.cacheWarning).toBeUndefined();
    expect(retry.entity.revision).toBe(2);
  });

  it("writes one envelope to the authoritative source and device cache", async () => {
    const memory = new MemoryPwaPersistence();
    const repository = new PwaRepository(memory);
    const entity = await repository.importEncrypted(backup, password);
    const fixture = fakeHandle(backup);
    const source = sourceFromHandle(fixture.handle);
    const payload = createWorkspace("Changed label");
    const saved = await repository.saveToSource(
      entity.id,
      payload,
      (ciphertext) => source.write(ciphertext, backup),
    );
    expect(saved.cacheWarning).toBeUndefined();
    expect(saved.ciphertext).toBe(fixture.text());
    expect(await repository.exportEncrypted(entity.id)).toBe(saved.ciphertext);
    expect(repository.snapshot(entity.id)).toEqual(payload);
    expect(
      JSON.parse(
        (await unlockVault(saved.entity.envelope, password)).plaintext,
      ),
    ).toEqual(payload);
  });

  it("reports a source acknowledgment as saved even if its secondary cache fails", async () => {
    const memory = new MemoryPwaPersistence();
    let failCache = false;
    const persistence: PwaPersistence = {
      read: (id) => memory.read(id),
      list: () => memory.list(),
      write: (entity, expected) =>
        failCache
          ? Promise.reject(new Error("Synthetic cache failure"))
          : memory.write(entity, expected),
    };
    const repository = new PwaRepository(persistence);
    const entity = await repository.importEncrypted(backup, password);
    const fixture = fakeHandle(backup);
    const source = sourceFromHandle(fixture.handle);
    failCache = true;
    const payload = createWorkspace("Acknowledged save");
    const saved = await repository.saveToSource(
      entity.id,
      payload,
      (ciphertext) => source.write(ciphertext, backup),
    );
    expect(saved.cacheWarning).toBeTypeOf("string");
    expect(fixture.text()).toBe(saved.ciphertext);
    expect(repository.snapshot(entity.id)).toEqual(payload);
    expect(await repository.exportEncrypted(entity.id)).toBe(backup);
    expect(
      JSON.parse(
        (await unlockVault(JSON.parse(fixture.text()), password)).plaintext,
      ),
    ).toEqual(payload);
    failCache = false;
    const retried = await repository.saveToSource(
      entity.id,
      createWorkspace("After cache recovery"),
      (ciphertext) => source.write(ciphertext, saved.ciphertext),
    );
    expect(retried.cacheWarning).toBeUndefined();
    expect(retried.entity.revision).toBe(2);
  });

  it("preserves memory/cache when the authoritative source rejects a stale save", async () => {
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const entity = await repository.importEncrypted(backup, password);
    const fixture = fakeHandle("newer-external-ciphertext");
    const source = sourceFromHandle(fixture.handle);
    await expect(
      repository.saveToSource(
        entity.id,
        createWorkspace("Unsaved edit"),
        (ciphertext) => source.write(ciphertext, backup),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(repository.snapshot(entity.id)?.label).toBe("Original label");
    expect(await repository.exportEncrypted(entity.id)).toBe(backup);
    expect(fixture.text()).toBe("newer-external-ciphertext");
  });

  it("does not restore an unlocked session if the user locks while the file save is awaiting acknowledgment", async () => {
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const entity = await repository.importEncrypted(backup, password);
    let release: (() => void) | undefined;
    const saving = repository.saveToSource(
      entity.id,
      createWorkspace("Saved while locking"),
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    repository.lockAll();
    release!();
    const result = await saving;
    expect(result.cacheWarning).toBeUndefined();
    expect(repository.snapshot(entity.id)).toBeNull();
    expect((await repository.unlock(entity.id, password)).label).toBe(
      "Saved while locking",
    );
  });
});
