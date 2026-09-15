import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LibraryStore,
  validateBrowserLibrary,
  type BrowserLibrary,
  type BrowserGlobal,
} from "../src/browser/library";
import { GlobalDrafts, GLOBAL_CONTEXT } from "../src/browser/global-drafts";
import { AIC_EMPTY_DOCUMENT } from "../src/core/security-model.js";

const markdown = (value = "synthetic-global-secret") =>
  `\`\`\`aic\n# Properties\nPassword *| ${value}\n\`\`\`\n`;
const record = (id = "global-fixture", revision = 1): BrowserGlobal => ({
  id,
  scope: "global",
  markdown: markdown(),
  createdAt: 1,
  updatedAt: 1,
  revision,
});
function memory(initial?: unknown) {
  let value = initial;
  const write = vi.fn(async (next: BrowserLibrary) => {
    value = structuredClone(next);
  });
  return { read: async () => value, write };
}
afterEach(() => vi.restoreAllMocks());

describe("explicit profile-global storage", () => {
  it("migrates v1/v2 losslessly without a write or invented global record", async () => {
    const source = new LibraryStore(memory());
    const page = {
      url: "https://migration.example/a",
      title: "Synthetic page",
    };
    const note = await source.create(page, "unchanged page source");
    await source.visit(page);
    const domain = await source.createDomain(
      "https://migration.example",
      markdown(),
    );
    const { history } = await source.load();
    for (const version of [1, 2]) {
      const legacy =
        version === 1
          ? { version, notes: [note], history }
          : { version, notes: [note], history, domains: [domain] };
      const persistence = memory(legacy);
      const store = new LibraryStore(persistence);
      expect(await store.load()).toEqual({
        version: 3,
        notes: [note],
        history,
        domains: version === 1 ? [] : [domain],
        global: null,
      });
      expect(persistence.write).not.toHaveBeenCalled();
      const global = await store.createGlobal(markdown("global"));
      expect(await store.load()).toMatchObject({
        version: 3,
        notes: [note],
        history,
        global,
      });
      expect((await store.load()).domains).toEqual(
        version === 1 ? [] : [domain],
      );
    }
  });

  it("serializes singleton creation and rejects stale identities/revisions without losing other scopes", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const results = await Promise.allSettled([
      store.createGlobal(markdown()),
      store.createGlobal(markdown("second")),
    ]);
    expect(results.map((item) => item.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const first = (await store.load()).global!;
    const saved = await store.saveGlobal(first.id, markdown("updated"), 1);
    for (const [id, revision] of [
      [first.id, 1],
      ["replacement", 2],
    ] as const)
      await expect(
        store.saveGlobal(id, markdown("stale"), revision),
      ).rejects.toMatchObject({ code: "conflict" });
    expect((await store.load()).global).toEqual(saved);
    expect(persistence.write).toHaveBeenCalledTimes(2);
    const snapshot = await store.load();
    snapshot.global!.markdown = "external mutation";
    expect((await store.load()).global).toEqual(saved);
    await expect(
      store.saveGlobal(first.id, "unfinished secret source", 2),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("strictly validates explicit global records and merges once with reported conflicts", async () => {
    const source = new LibraryStore(memory());
    await source.createGlobal(markdown());
    const backup = await source.exportBackup();
    const destination = new LibraryStore(memory());
    expect(await destination.importBackup(backup)).toMatchObject({
      globalCreated: 1,
      globalSkipped: 0,
    });
    const global = (await destination.load()).global!;
    await destination.saveGlobal(
      global.id,
      markdown("local-preferred"),
      global.revision,
    );
    expect(await destination.importBackup(backup)).toMatchObject({
      globalCreated: 0,
      globalSkipped: 1,
    });
    expect((await destination.load()).global?.markdown).toBe(
      markdown("local-preferred"),
    );
    const valid = JSON.parse(backup) as BrowserLibrary;
    for (const invalid of [
      { ...valid.global, scope: "domain" },
      [valid.global],
      { ...valid.global, origin: "https://fake.example" },
      { ...valid.global, revision: 0 },
    ])
      expect(() =>
        validateBrowserLibrary({ ...valid, global: invalid }),
      ).toThrow();
    const legacySource = {
      ...valid,
      global: { ...valid.global, markdown: "unfinished legacy source" },
    };
    expect(validateBrowserLibrary(legacySource).global?.markdown).toBe(
      "unfinished legacy source",
    );
  });
});

describe("profile-global draft adapter", () => {
  it("keeps one placeholder without creating until edit and drains later edits under acknowledged revisions", async () => {
    const store = new LibraryStore(memory());
    const create = vi.fn((_context, text: string) => store.createGlobal(text));
    const drafts = new GlobalDrafts(
      (id, text, revision) => store.saveGlobal(id, text, revision),
      undefined,
      create,
    );
    const key = drafts.activatePlaceholder(
      GLOBAL_CONTEXT,
      AIC_EMPTY_DOCUMENT,
    ).key;
    await drafts.flushAll();
    expect(create).not.toHaveBeenCalled();
    drafts.edit(key, markdown());
    expect(await drafts.flush(key)).toBe(true);
    drafts.edit(key, markdown("updated"));
    expect(await drafts.flush(key)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect((await store.load()).global?.revision).toBe(2);
    drafts.dispose();
  });

  it("preserves dirty source on replacement identity and accepts replacement for a clean draft", () => {
    const dirty = new GlobalDrafts(vi.fn());
    const key = dirty.activate(record("old", 4)).key;
    dirty.edit(key, markdown("local"));
    expect(dirty.activate(record("new", 1))).toMatchObject({
      key,
      dirty: true,
      text: markdown("local"),
      error: expect.stringContaining("Another window"),
    });
    dirty.dispose();
    const clean = new GlobalDrafts(vi.fn());
    clean.activate(record("old", 4));
    expect(clean.activate(record("new", 1)).record?.id).toBe("new");
    clean.dispose();
  });

  it("ignores an acknowledgment after Lock disposes the coordinator", async () => {
    let acknowledge!: (value: BrowserGlobal) => void;
    const onChange = vi.fn();
    const drafts = new GlobalDrafts(
      vi.fn(),
      onChange,
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const key = drafts.activatePlaceholder(
      GLOBAL_CONTEXT,
      AIC_EMPTY_DOCUMENT,
    ).key;
    drafts.edit(key, markdown());
    const saved = drafts.flush(key);
    drafts.dispose();
    onChange.mockClear();
    acknowledge(record());
    expect(await saved).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(drafts.get(key)).toBeUndefined();
  });
});
