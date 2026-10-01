import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createVault,
  unlockVault,
  type VaultEnvelope,
} from "../src/browser/vault-crypto";
import {
  validateBrowserLibrary,
  type BrowserLibrary,
} from "../src/browser/library";
import { PwaRepository } from "../src/pwa/controller";
import {
  createPwaFile,
  createWorkspace,
  decodeBase64,
  encodeBase64,
  fileBytes,
  fileText,
  MAX_PWA_ENTRIES,
  MAX_PWA_FILE_BYTES,
  parsePayload,
  serializePayload,
  validatePayload,
  validatePwaFile,
  validateRelativePath,
  type WorkspacePayload,
} from "../src/pwa/model";
import { MemoryPwaPersistence, type PwaPersistence } from "../src/pwa/storage";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
const password = "synthetic device passphrase";
const alternatePassword = "another synthetic passphrase";
let backup: string;
let extensionBackup: string;
let fixture: WorkspacePayload;
const library: BrowserLibrary = {
  version: 3,
  notes: [
    {
      id: "synthetic-page",
      url: "https://example.test/note",
      title: "Synthetic title",
      markdown: "# Page",
      createdAt: 1,
      updatedAt: 2,
      revision: 3,
    },
  ],
  history: [
    {
      url: "https://example.test/history",
      title: "Synthetic history",
      visitedAt: 4,
    },
  ],
  domains: [
    {
      id: "synthetic-domain",
      origin: "https://example.test",
      markdown: "```aic\n```",
      createdAt: 1,
      updatedAt: 2,
      revision: 3,
    },
  ],
  global: {
    id: "synthetic-global",
    scope: "global",
    markdown: "```aic\n```",
    createdAt: 1,
    updatedAt: 2,
    revision: 3,
  },
};

beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  fixture = {
    ...createWorkspace("Synthetic project label"),
    files: [
      createPwaFile(
        "project-a/note.md",
        new TextEncoder().encode("\ufeff# Synthetic e\u0301\r\n"),
        "text/markdown",
        2,
      ),
      createPwaFile(
        "project-b/photo.bin",
        Uint8Array.of(0, 255, 128, 42),
        "application/octet-stream",
        3,
      ),
      createPwaFile("empty.txt", new Uint8Array(), "text/plain", 4),
    ],
    directories: ["project-a", "project-b", "project-b/empty"],
  };
  backup = JSON.stringify(
    (await createVault(password, serializePayload(fixture))).envelope,
  );
  extensionBackup = JSON.stringify(
    (await createVault(password, JSON.stringify(library))).envelope,
  );
});
afterAll(() => vi.unstubAllGlobals());

function changed(payload: WorkspacePayload, label: string): WorkspacePayload {
  return { ...payload, label };
}

describe("PWA portable payload validation", () => {
  it("retains binary bytes, empty files/folders, Unicode text and separate project prefixes", () => {
    expect(parsePayload(serializePayload(fixture))).toEqual(fixture);
    expect(fileBytes(fixture.files[1]!)).toEqual(
      Uint8Array.of(0, 255, 128, 42),
    );
    expect(fileText(fixture.files[0]!)).toBe("\ufeff# Synthetic e\u0301\r\n");
    expect(fileText(fixture.files[2]!)).toBe("");
    expect(() => fileText(fixture.files[1]!)).toThrow("binary");
  });

  it("rejects traversal, unsafe restore names, duplicate ids/paths and file-directory collisions", () => {
    for (const path of [
      "",
      "/note.md",
      "../note.md",
      "a/../note.md",
      "a//note.md",
      "a/./note.md",
      "a\\note.md",
      "C:/note.md",
      "a\u0000.md",
      "a/CON.txt",
      "a/name.",
      "a/name ",
    ]) {
      expect(() => validateRelativePath(path)).toThrow();
    }
    for (const payload of [
      {
        ...fixture,
        files: [
          ...fixture.files,
          { ...fixture.files[0]!, id: "duplicate-path" },
        ],
      },
      {
        ...fixture,
        files: [...fixture.files, { ...fixture.files[0]!, path: "other.md" }],
      },
      { ...fixture, directories: [...fixture.directories, "PROJECT-A"] },
      {
        ...fixture,
        files: [
          ...fixture.files,
          { ...fixture.files[0]!, id: "parent-file", path: "project-a" },
        ],
      },
      { ...fixture, directories: [...fixture.directories, "empty.txt/nested"] },
    ])
      expect(() => validatePayload(payload)).toThrow();
  });

  it("rejects malformed canonical base64, unsupported formats and accessor input without executing it", () => {
    for (const value of ["AA", "AA==\n", "AB==", "=AAA", "////=", "A==="])
      expect(() => decodeBase64(value)).toThrow();
    expect(encodeBase64(new Uint8Array())).toBe("");
    expect(decodeBase64("")).toEqual(new Uint8Array());
    const accessor = vi.fn(() => fixture.files);
    const payload = { ...fixture };
    Object.defineProperty(payload, "files", { get: accessor });
    expect(() => validatePayload(payload)).toThrow();
    expect(accessor).not.toHaveBeenCalled();
    const sparseFiles: unknown[] = new Array(2);
    sparseFiles[1] = fixture.files[0];
    for (const value of [
      { ...fixture, version: 2 },
      { ...fixture, extra: true },
      { ...fixture, files: sparseFiles },
      { ...fixture, label: "bad\ud800" },
    ])
      expect(() => validatePayload(value)).toThrow();
  });

  it("reports cumulative stored-entry limits separately from the payload byte limit", () => {
    const file = createPwaFile("first.md", new Uint8Array());
    const workspace = {
      ...createWorkspace(),
      files: Array.from({ length: MAX_PWA_ENTRIES + 1 }, (_, index) => ({
        ...file,
        id: `file-${index}`,
        path: `note-${index}.md`,
      })),
    };
    expect(() => serializePayload(workspace)).toThrow(
      "Existing files count too",
    );
    expect(() => serializePayload(workspace)).toThrow(
      "2001 files, 0 folder records",
    );
  });

  it("rechecks changed bytes on previously validated files and their copies", () => {
    const file = createPwaFile("safe.md", Uint8Array.of(0, 1, 255));
    const returned = validatePwaFile(file);
    const independent = structuredClone(returned);
    for (const candidate of [file, returned, independent]) {
      candidate.data = "AB==";
      expect(() => validatePwaFile(candidate)).toThrow();
      expect(() => fileBytes(candidate)).toThrow();
      candidate.data = encodeBase64(Uint8Array.of(10, 20, 30));
      expect(fileBytes(validatePwaFile(candidate))).toEqual(
        Uint8Array.of(10, 20, 30),
      );
      candidate.data = "A".repeat(4 * Math.ceil(MAX_PWA_FILE_BYTES / 3) + 4);
      expect(() => validatePwaFile(candidate)).toThrow("6 MiB");
      Object.assign(candidate, { data: undefined });
      expect(() => validatePwaFile(candidate)).toThrow();
    }
    const untrusted = { ...file, data: undefined };
    expect(() => validatePwaFile(untrusted)).toThrow();
  });

  it("still rejects changed metadata, accessors and prototypes on previously validated files", () => {
    const file = createPwaFile("safe.md", Uint8Array.of(1));
    file.path = "../escape.md";
    expect(() => validatePwaFile(file)).toThrow();
    file.path = "safe.md";
    file.modifiedAt = -1;
    expect(() => validatePwaFile(file)).toThrow();
    file.modifiedAt = 0;
    const accessor = vi.fn(() => file.data);
    Object.defineProperty(file, "data", { get: accessor });
    expect(() => validatePwaFile(file)).toThrow();
    expect(accessor).not.toHaveBeenCalled();

    const prototypeChanged = createPwaFile("other.md", Uint8Array.of(2));
    Object.setPrototypeOf(prototypeChanged, { inherited: true });
    expect(() => validatePwaFile(prototypeChanged)).toThrow();
  });

  it("bounds each file, total UTF-8 payload bytes and entry count before persistence", () => {
    expect(() =>
      createPwaFile("big.bin", new Uint8Array(MAX_PWA_FILE_BYTES + 1)),
    ).toThrow();
    const large = createPwaFile("large.bin", new Uint8Array(3 * 1024 * 1024));
    expect(() =>
      validatePayload({
        ...createWorkspace(),
        files: [large, { ...large, id: "other-id", path: "other.bin" }],
      }),
    ).toThrow("6 MiB");
    expect(() =>
      validatePayload({
        ...createWorkspace(),
        directories: Array.from(
          { length: MAX_PWA_ENTRIES + 1 },
          (_, index) => `folder-${index}`,
        ),
      }),
    ).toThrow();
  });
});

describe("PWA entity ownership and encrypted persistence", () => {
  it("stores only ciphertext metadata and keeps labels independent of the password", async () => {
    const persistence = new MemoryPwaPersistence();
    const repository = new PwaRepository(persistence);
    const entity = await repository.importEncrypted(backup, password);
    expect(repository.snapshot(entity.id)).toEqual(fixture);
    const stored = JSON.stringify(await persistence.list());
    for (const value of [
      password,
      fixture.label!,
      fixture.files[0]!.path,
      fixture.files[0]!.data,
    ])
      expect(stored).not.toContain(value);
    expect(Object.keys((await repository.list())[0]!)).toEqual([
      "id",
      "revision",
      "envelope",
    ]);
    await repository.update(entity.id, changed(fixture, "Renamed entity"));
    repository.lockAll();
    expect(repository.snapshot(entity.id)).toBeNull();
    expect(await repository.unlock(entity.id, password)).toEqual(
      changed(fixture, "Renamed entity"),
    );
    repository.lock(entity.id);
    await expect(
      repository.unlock(entity.id, alternatePassword),
    ).rejects.toMatchObject({ code: "password" });
    expect(repository.snapshot(entity.id)).toBeNull();
    // Each repository instance starts locked: sessions never enter persistence.
    expect(new PwaRepository(persistence).snapshot(entity.id)).toBeNull();
  });

  it("isolates independent entity keys and transfers a single encrypted folder bundle", async () => {
    const source = new PwaRepository(new MemoryPwaPersistence());
    const first = await source.importEncrypted(backup, password);
    const second = await source.create(alternatePassword);
    await source.update(second.id, changed(fixture, "Other password scope"));
    source.lockAll();
    await expect(source.unlock(second.id, password)).rejects.toMatchObject({
      code: "password",
    });
    const transfer = await source.exportEncrypted(first.id);
    expect(transfer).toBe(backup);
    const target = new PwaRepository(new MemoryPwaPersistence());
    const imported = await target.importEncrypted(transfer, password);
    expect(imported.id).not.toBe(first.id);
    expect(target.snapshot(imported.id)).toEqual(fixture);
    expect(source.snapshot(first.id)).toBeNull();
  });

  it("serializes same-tab writes and rejects stale multi-tab writes without changing memory", async () => {
    const persistence = new MemoryPwaPersistence();
    const first = new PwaRepository(persistence);
    const entity = await first.importEncrypted(backup, password);
    const second = new PwaRepository(persistence);
    await second.unlock(entity.id, password);
    const writes = await Promise.all([
      first.update(entity.id, changed(fixture, "First save")),
      first.update(entity.id, changed(fixture, "Second save")),
    ]);
    expect(writes.map((record) => record.revision)).toEqual([2, 3]);
    await expect(
      second.update(entity.id, changed(fixture, "Stale save")),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(second.snapshot(entity.id)).toEqual(fixture);
    expect(first.snapshot(entity.id)?.label).toBe("Second save");
    expect((await second.unlock(entity.id, password)).label).toBe(
      "Second save",
    );
  });

  it("preserves the prior encrypted record and saved snapshot when storage fails", async () => {
    const memory = new MemoryPwaPersistence();
    let fail = false;
    const persistence: PwaPersistence = {
      list: () => memory.list(),
      read: (id) => memory.read(id),
      write: (record, expected) =>
        fail
          ? Promise.reject(new Error("synthetic quota"))
          : memory.write(record, expected),
    };
    const repository = new PwaRepository(persistence);
    const entity = await repository.importEncrypted(backup, password);
    const unsaved = changed(fixture, "Unsaved draft");
    fail = true;
    await expect(repository.update(entity.id, unsaved)).rejects.toMatchObject({
      code: "storage",
    });
    expect(repository.snapshot(entity.id)).toEqual(fixture);
    expect(unsaved.label).toBe("Unsaved draft");
    expect(await repository.exportEncrypted(entity.id)).toBe(backup);
    fail = false;
    expect((await repository.update(entity.id, unsaved)).revision).toBe(2);
  });

  it("fails closed on authenticated unsupported data, corruption and plain backup input", async () => {
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const unsupported = JSON.stringify(
      (await createVault(password, '{"unsupported":true}')).envelope,
    );
    await expect(
      repository.importEncrypted(unsupported, password),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      repository.importEncrypted(JSON.stringify(fixture), password),
    ).rejects.toMatchObject({ code: "invalid" });
    const corrupted = JSON.parse(backup) as VaultEnvelope;
    corrupted.cipher.data = `${corrupted.cipher.data[0] === "A" ? "B" : "A"}${corrupted.cipher.data.slice(1)}`;
    await expect(
      repository.importEncrypted(JSON.stringify(corrupted), password),
    ).rejects.toMatchObject({ code: "password" });
    expect(await repository.list()).toEqual([]);
    const damagedStore: PwaPersistence = {
      list: async () => [{ id: "broken", revision: 1, envelope: null }],
      read: async () => ({ id: "broken", revision: 1, envelope: null }),
      write: vi.fn(),
    };
    const damaged = new PwaRepository(damagedStore);
    await expect(damaged.list()).rejects.toMatchObject({ code: "invalid" });
    await expect(damaged.unlock("broken", password)).rejects.toMatchObject({
      code: "invalid",
    });
    expect(damagedStore.write).not.toHaveBeenCalled();
  });

  it("retains complete extension libraries and exports edited data in the extension schema", async () => {
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const entity = await repository.importEncrypted(extensionBackup, password);
    const payload = repository.snapshot(entity.id)!;
    expect(payload.kind).toBe("browser-library");
    if (payload.kind !== "browser-library")
      throw new Error("Expected extension fixture");
    expect(payload.library).toEqual(library);
    await repository.update(entity.id, {
      ...payload,
      label: "Extension label",
      library: {
        ...payload.library,
        notes: payload.library.notes.map((note) => ({
          ...note,
          markdown: "# Edited page",
          revision: 4,
        })),
      },
    });
    const transferred = await repository.exportExtensionEncrypted(entity.id);
    const opened = await unlockVault(JSON.parse(transferred), password);
    const restored = validateBrowserLibrary(JSON.parse(opened.plaintext));
    expect(restored.history).toEqual(library.history);
    expect(restored.domains).toEqual(library.domains);
    expect(restored.global).toEqual(library.global);
    expect(restored.notes[0]?.markdown).toBe("# Edited page");
    repository.lock(entity.id);
    expect((await repository.unlock(entity.id, password)).label).toBe(
      "Extension label",
    );
  });

  it("never republishes an in-flight unlock after lockAll", async () => {
    const memory = new MemoryPwaPersistence();
    let release: (() => void) | undefined;
    let blockReads = false;
    const persistence: PwaPersistence = {
      list: () => memory.list(),
      write: (record, expected) => memory.write(record, expected),
      read: async (id) => {
        if (blockReads)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return memory.read(id);
      },
    };
    const repository = new PwaRepository(persistence);
    const entity = await repository.importEncrypted(backup, password);
    repository.lockAll();
    blockReads = true;
    const unlocking = repository.unlock(entity.id, password);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    repository.lockAll();
    release!();
    await expect(unlocking).rejects.toMatchObject({ code: "locked" });
    expect(repository.snapshot(entity.id)).toBeNull();
  });
});
