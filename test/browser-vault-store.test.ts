import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserVault,
  type VaultPersistence,
} from "../src/browser/vault-store";
import {
  createVault,
  type VaultEnvelope,
  type VaultSession,
} from "../src/browser/vault-crypto";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };

const PASSWORD = "synthetic-master-passphrase-7319";
const OTHER_PASSWORD = "another-synthetic-passphrase-2846";
const SECRET = "synthetic-hidden-password-6419";
const PAGE = {
  url: "https://private.example.test/confidential-index-9137?token=4826",
  title: "Confidential synthetic title 5193",
};
const MARKDOWN = `---\nPassword*: ${SECRET}\n---\nPrivate synthetic body 4182`;

function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memory(initial?: unknown) {
  const state = {
    disk: copy(initial) as unknown,
    session: undefined as unknown,
    failWrites: false,
    failReads: false,
    writes: 0,
    beforeWrite: undefined as (() => Promise<void>) | undefined,
  };
  const persistence: VaultPersistence = {
    async readLocal() {
      if (state.failReads) throw new Error(`disk-read-${SECRET}`);
      return copy(state.disk);
    },
    async writeLocal(envelope: VaultEnvelope) {
      await state.beforeWrite?.();
      if (state.failWrites) throw new Error(`disk-write-${SECRET}`);
      state.disk = copy(envelope);
      state.writes++;
    },
    async readSession() {
      return copy(state.session);
    },
    async writeSession(session: VaultSession) {
      state.session = copy(session);
    },
    async clearSession() {
      state.session = undefined;
    },
  };
  return { state, persistence, vault: new BrowserVault(persistence) };
}

async function seed(vault: BrowserVault) {
  await vault.setup(PASSWORD);
  await vault.run((store) => store.visit(PAGE));
  return vault.run((store) => store.create(PAGE, MARKDOWN));
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encrypted browser vault integration", () => {
  it("encrypts profile-global properties across worker restart, Lock, restore and merge", async () => {
    const source = memory();
    await source.vault.setup(PASSWORD);
    const markdown = `\`\`\`aic\nPassword *| ${SECRET}\n\`\`\`\n`;
    const global = await source.vault.run((store) =>
      store.createGlobal(markdown),
    );
    expect(JSON.stringify(source.state.disk)).not.toContain(SECRET);
    const resumed = new BrowserVault(source.persistence);
    expect((await resumed.run((store) => store.load())).global).toEqual(global);
    await resumed.lock();
    await expect(
      resumed.run((store) => store.saveGlobal(global.id, markdown, 1)),
    ).rejects.toMatchObject({ code: "locked" });
    const backup = await resumed.exportBackup();
    expect(backup).not.toContain(SECRET);
    const restored = memory();
    expect(await restored.vault.importBackup(backup, PASSWORD)).toMatchObject({
      globalCreated: 1,
      globalSkipped: 0,
      restored: true,
    });
    expect((await restored.vault.run((store) => store.load())).global).toEqual(
      global,
    );
    await restored.vault.run((store) =>
      store.saveGlobal(global.id, markdown.replace(SECRET, "local-global"), 1),
    );
    expect(await restored.vault.importBackup(backup, PASSWORD)).toMatchObject({
      globalCreated: 0,
      globalSkipped: 1,
      restored: false,
    });
    await restored.vault.lock();
    const restarted = new BrowserVault(restored.persistence);
    await restarted.unlock(PASSWORD);
    expect(
      (await restarted.run((store) => store.load())).global?.markdown,
    ).toContain("local-global");
  });

  it("round-trips shared Properties once and preserves existing origins during merge", async () => {
    const source = memory();
    await source.vault.setup(PASSWORD);
    const markdown = "```aic\n# Properties\nPassword *| " + SECRET + "\n```\n";
    const shared = await source.vault.run((store) =>
      store.createDomain("https://shared.example.test", markdown),
    );
    const backup = await source.vault.exportBackup();
    expect(backup).not.toContain(SECRET);
    expect(backup).not.toContain(shared.origin);
    const destination = memory();
    expect(
      await destination.vault.importBackup(backup, PASSWORD),
    ).toMatchObject({
      created: 0,
      domainsCreated: 1,
      domainsSkipped: 0,
      globalCreated: 0,
      globalSkipped: 0,
      restored: true,
    });
    expect(
      (await destination.vault.run((store) => store.load())).domains,
    ).toEqual([shared]);
    const updated = await destination.vault.run((store) =>
      store.saveDomain(
        shared.id,
        markdown.replace(SECRET, "changed-synthetic"),
        1,
      ),
    );
    expect(
      await destination.vault.importBackup(backup, PASSWORD),
    ).toMatchObject({ domainsCreated: 0, domainsSkipped: 1, restored: false });
    await destination.vault.lock();
    await destination.vault.unlock(PASSWORD);
    expect(
      (await destination.vault.run((store) => store.load())).domains,
    ).toEqual([updated]);
  });

  it("opens and restores legacy encrypted libraries without rewriting page data", async () => {
    const legacy = {
      version: 1,
      notes: [
        {
          id: "legacy-root",
          url: "https://example.test/",
          title: "Root",
          markdown: MARKDOWN,
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        },
      ],
      history: [],
    };
    const { envelope } = await createVault(PASSWORD, JSON.stringify(legacy));
    const current = memory(envelope);
    await current.vault.unlock(PASSWORD);
    expect(await current.vault.run((store) => store.load())).toEqual({
      ...legacy,
      version: 3,
      global: null,
      domains: [],
    });
    expect(current.state.disk).toEqual(envelope);
    const destination = memory();
    await destination.vault.importBackup(JSON.stringify(envelope), PASSWORD);
    expect(await destination.vault.run((store) => store.load())).toEqual({
      ...legacy,
      version: 3,
      global: null,
      domains: [],
    });
  });

  it("requires setup and a master passphrase before exposing a library", async () => {
    const { vault, state } = memory();
    expect(await vault.status()).toEqual({ state: "setup" });
    await expect(vault.run((store) => store.load())).rejects.toMatchObject({
      code: "locked",
    });
    await expect(vault.unlock(PASSWORD)).rejects.toMatchObject({
      code: "missing",
    });
    await expect(vault.setup("short")).rejects.toMatchObject({
      code: "password",
    });
    expect(state.disk).toBeUndefined();
    expect(state.session).toBeUndefined();
    expect(await vault.setup(PASSWORD)).toEqual({ state: "unlocked" });
    expect(await vault.run((store) => store.load())).toEqual({
      version: 3,
      global: null,
      notes: [],
      history: [],
      domains: [],
    });
  });

  it("encrypts Markdown, URLs, titles and history on disk while unlocked", async () => {
    const { vault, state } = memory();
    await seed(vault);
    const disk = JSON.stringify(state.disk);
    for (const secret of [
      PASSWORD,
      SECRET,
      MARKDOWN,
      PAGE.url,
      PAGE.title,
      "confidential-index-9137",
    ])
      expect(disk).not.toContain(secret);
    expect(state.disk).toMatchObject({
      format: "aic-browser-vault",
      version: 1,
    });
    expect(JSON.stringify(state.session)).not.toContain(PASSWORD);
    const loaded = await vault.run((store) => store.load());
    expect(loaded.notes).toMatchObject([{ ...PAGE, markdown: MARKDOWN }]);
    expect(loaded.history).toMatchObject([PAGE]);
  });

  it("preserves a session across worker recreation but requires unlock after browser restart", async () => {
    const { vault, state, persistence } = memory();
    await seed(vault);
    const resumedWorker = new BrowserVault(persistence);
    expect(await resumedWorker.status()).toEqual({ state: "unlocked" });
    expect(
      (await resumedWorker.run((store) => store.load())).notes[0]?.markdown,
    ).toBe(MARKDOWN);
    state.session = undefined;
    const restarted = new BrowserVault(persistence);
    expect(await restarted.status()).toEqual({ state: "locked" });
    await expect(restarted.run((store) => store.load())).rejects.toMatchObject({
      code: "locked",
    });
    await restarted.unlock(PASSWORD);
    expect(
      (await restarted.run((store) => store.load())).notes[0]?.markdown,
    ).toBe(MARKDOWN);
    await restarted.lock();
    expect(state.session).toBeUndefined();
    expect(await resumedWorker.status()).toEqual({ state: "locked" });
    await expect(
      resumedWorker.run((store) => store.load()),
    ).rejects.toMatchObject({ code: "locked" });
  });

  it("restores an encrypted backup into an empty profile using its original passphrase", async () => {
    const source = memory();
    await seed(source.vault);
    const expected = await source.vault.run((store) => store.load());
    await source.vault.lock();
    const backup = await source.vault.exportBackup();
    for (const secret of [PASSWORD, SECRET, PAGE.url, PAGE.title])
      expect(backup).not.toContain(secret);
    const destination = memory();
    expect(await destination.vault.importBackup(backup, PASSWORD)).toEqual({
      created: 1,
      skipped: 0,
      domainsCreated: 0,
      domainsSkipped: 0,
      globalCreated: 0,
      globalSkipped: 0,
      restored: true,
    });
    expect(await destination.vault.run((store) => store.load())).toEqual(
      expected,
    );
    await destination.vault.lock();
    await destination.vault.unlock(PASSWORD);
    expect(await destination.vault.run((store) => store.load())).toEqual(
      expected,
    );
  });

  it("merges a separately salted backup without replacing current URL conflicts or its key", async () => {
    const current = memory();
    await seed(current.vault);
    const currentSession = copy(current.state.session);
    const incoming = memory();
    await incoming.vault.setup(OTHER_PASSWORD);
    await incoming.vault.run((store) =>
      store.create(PAGE, "Incoming conflicting text"),
    );
    const otherPage = {
      url: "https://another.example.test/page",
      title: "Other note",
    };
    await incoming.vault.run((store) =>
      store.create(otherPage, "Independent imported note"),
    );
    expect((incoming.state.disk as VaultEnvelope).kdf.salt).not.toBe(
      (current.state.disk as VaultEnvelope).kdf.salt,
    );
    const backup = await incoming.vault.exportBackup();
    expect(await current.vault.importBackup(backup, OTHER_PASSWORD)).toEqual({
      created: 1,
      skipped: 1,
      domainsCreated: 0,
      domainsSkipped: 0,
      globalCreated: 0,
      globalSkipped: 0,
      restored: false,
    });
    const library = await current.vault.run((store) => store.load());
    expect(library.notes).toHaveLength(2);
    expect(library.notes.find((note) => note.url === PAGE.url)?.markdown).toBe(
      MARKDOWN,
    );
    expect(
      library.notes.find((note) => note.url === otherPage.url)?.markdown,
    ).toBe("Independent imported note");
    expect(current.state.session).toEqual(currentSession);
    await current.vault.lock();
    await expect(
      current.vault.importBackup(backup, OTHER_PASSWORD),
    ).rejects.toMatchObject({ code: "locked" });
    await current.vault.unlock(PASSWORD);
    expect(
      (await current.vault.run((store) => store.load())).notes,
    ).toHaveLength(2);
  });

  it("rejects wrong passphrases and tampered backups without changing disk or exposing secrets", async () => {
    const { vault, state } = memory();
    await seed(vault);
    const backup = await vault.exportBackup();
    const original = copy(state.disk);
    const badPassword = `${OTHER_PASSWORD}-${SECRET}`;
    await vault.lock();
    const unlockError = await vault
      .unlock(badPassword)
      .catch((error: unknown) => error);
    expect(unlockError).toMatchObject({ code: "password" });
    expect(String(unlockError)).not.toContain(SECRET);
    expect(state.disk).toEqual(original);
    expect(state.session).toBeUndefined();
    await vault.unlock(PASSWORD);
    await expect(vault.importBackup(backup, badPassword)).rejects.toMatchObject(
      { code: "password" },
    );
    const tampered = JSON.parse(backup) as VaultEnvelope;
    tampered.cipher.data = `${tampered.cipher.data.startsWith("A") ? "B" : "A"}${tampered.cipher.data.slice(1)}`;
    await expect(
      vault.importBackup(JSON.stringify(tampered), PASSWORD),
    ).rejects.toMatchObject({ code: "password" });
    expect(state.disk).toEqual(original);
    expect((await vault.run((store) => store.load())).notes[0]?.markdown).toBe(
      MARKDOWN,
    );
  });

  it("never overwrites existing, malformed or legacy plaintext storage during setup", async () => {
    const existing = memory();
    await seed(existing.vault);
    const original = copy(existing.state.disk);
    await expect(existing.vault.setup(OTHER_PASSWORD)).rejects.toMatchObject({
      code: "exists",
    });
    expect(existing.state.disk).toEqual(original);
    for (const raw of [
      { version: 1, notes: [], history: [] },
      { format: "broken", markdown: SECRET },
      "broken ciphertext",
    ]) {
      const corrupt = memory(raw);
      await expect(corrupt.vault.setup(PASSWORD)).rejects.toMatchObject({
        code: "invalid",
      });
      await expect(corrupt.vault.status()).rejects.toMatchObject({
        code: "invalid",
      });
      expect(corrupt.state.disk).toEqual(raw);
      expect(corrupt.state.writes).toBe(0);
      expect(corrupt.state.session).toBeUndefined();
    }
  });

  it("keeps the previous encrypted value and revision when persistence fails, then permits retry", async () => {
    const { vault, state } = memory();
    const note = await seed(vault);
    const original = copy(state.disk);
    state.failWrites = true;
    const failure = await vault
      .run((store) => store.save(note.id, "Updated note", note.revision))
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "storage" });
    expect(String(failure)).not.toContain(SECRET);
    expect(state.disk).toEqual(original);
    expect((await vault.run((store) => store.load())).notes[0]).toEqual(note);
    state.failWrites = false;
    const saved = await vault.run((store) =>
      store.save(note.id, "Updated note", note.revision),
    );
    expect(saved.revision).toBe(note.revision + 1);
    expect(state.disk).not.toEqual(original);
    expect(JSON.stringify(state.disk)).not.toContain("Updated note");
  });

  it("serializes concurrent panel saves and refuses stale revisions", async () => {
    const { vault } = memory();
    const note = await seed(vault);
    const first = vault.run((store) =>
      store.save(note.id, "First panel", note.revision),
    );
    const second = vault.run((store) =>
      store.save(note.id, "Second panel", note.revision),
    );
    const results = await Promise.allSettled([first, second]);
    expect(results[0]).toMatchObject({
      status: "fulfilled",
      value: { markdown: "First panel" },
    });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { code: "conflict" },
    });
    expect((await vault.run((store) => store.load())).notes[0]?.markdown).toBe(
      "First panel",
    );
  });

  it("orders Lock after an in-flight write and denies all following data operations", async () => {
    const { vault, state } = memory();
    const note = await seed(vault);
    const entered = deferred();
    const release = deferred();
    state.beforeWrite = async () => {
      entered.resolve();
      await release.promise;
    };
    const save = vault.run((store) =>
      store.save(note.id, "Saved before Lock", note.revision),
    );
    await entered.promise;
    const lock = vault.lock();
    const denied = expect(
      vault.run((store) => store.load()),
    ).rejects.toMatchObject({ code: "locked" });
    release.resolve();
    expect((await save).markdown).toBe("Saved before Lock");
    expect(await lock).toEqual({ state: "locked" });
    await denied;
    expect(state.session).toBeUndefined();
    state.beforeWrite = undefined;
    await vault.unlock(PASSWORD);
    expect((await vault.run((store) => store.load())).notes[0]?.markdown).toBe(
      "Saved before Lock",
    );
  });

  it("returns a safe error for storage read failures without mutating data", async () => {
    const { vault, state } = memory();
    await seed(vault);
    const original = copy(state.disk);
    state.failReads = true;
    const failure = await vault
      .run((store) => store.load())
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "storage" });
    expect(String(failure)).not.toContain(SECRET);
    expect(state.disk).toEqual(original);
  });
});
