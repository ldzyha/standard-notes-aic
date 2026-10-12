import { describe, expect, it, vi } from "vitest";
import { AIC_EMPTY_DOCUMENT } from "../src/core/security-model.js";
import {
  buildDomainTree,
  hasBrowserNoteContent,
  BrowserLibrary,
  LibraryError,
  LibraryStore,
  normalizePageUrl,
  normalizeDomainOrigin,
  validateBrowserLibrary,
} from "../src/browser/library";

function memory(initial?: unknown) {
  let value = initial;
  let failWrites = false;
  let writes = 0;
  return {
    read: async () => value,
    write: async (library: BrowserLibrary) => {
      if (failWrites) throw new Error("secret content must not leak");
      value = structuredClone(library);
      writes++;
    },
    setFailure(value: boolean) {
      failWrites = value;
    },
    get value() {
      return value;
    },
    get writes() {
      return writes;
    },
  };
}

const page = (url = "https://wiki.example.com/team/plan?view=1#details") => ({
  url,
  title: "Plan",
});

describe("local browser library", () => {
  const properties = (value = "synthetic-password") =>
    "```aic\n# Properties\nPassword *| " + value + "\n```\n";

  it("does not remember unopened notes, blank notes or old untouched scaffolds", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const before = persistence.writes;
    expect((await store.visit(page())).history).toEqual([]);
    expect(persistence.writes).toBe(before);
    for (const [index, markdown] of [
      "",
      "  \n\t",
      AIC_EMPTY_DOCUMENT,
      AIC_EMPTY_DOCUMENT.replaceAll("\n", "\r\n"),
    ].entries()) {
      const target = page(`https://example.test/blank-${index}`);
      await store.create(target, markdown);
      const writes = persistence.writes;
      expect((await store.visit(target)).history).toEqual([]);
      expect(persistence.writes).toBe(writes);
    }
    expect((await store.load()).notes).toHaveLength(4);
    expect(hasBrowserNoteContent({ markdown: "# Authored title" })).toBe(true);
    expect(
      hasBrowserNoteContent({ markdown: "```aic\n# My own card\n\n```" }),
    ).toBe(true);
  });

  it("hides historical pages without content and prunes them on the next save without deleting notes", async () => {
    const seed = new LibraryStore(memory());
    const kept = await seed.create(
      page("https://example.test/kept"),
      "Keep body",
    );
    const empty = await seed.create(page("https://example.test/empty"), "");
    const scaffold = await seed.create(
      page("https://example.test/scaffold"),
      AIC_EMPTY_DOCUMENT,
    );
    const original = {
      ...(await seed.load()),
      history: [
        kept,
        empty,
        scaffold,
        page("https://example.test/no-note"),
      ].map((item, index) => ({
        url: item.url,
        title: item.title,
        visitedAt: index + 1,
      })),
    };
    const persistence = memory(original);
    const store = new LibraryStore(persistence);
    const visible = await store.load();
    expect(visible.notes).toEqual(original.notes);
    expect(visible.history).toEqual([original.history[0]]);
    expect(persistence.writes).toBe(0);
    const updated = await store.save(
      kept.id,
      "Keep edited body",
      kept.revision,
    );
    expect((persistence.value as BrowserLibrary).notes).toEqual([
      updated,
      empty,
      scaffold,
    ]);
    expect((persistence.value as BrowserLibrary).history).toEqual([
      original.history[0],
    ]);
    await store.save(kept.id, "  ", updated.revision);
    expect((await store.load()).history).toEqual([]);
    expect((await store.load()).notes).toHaveLength(3);
  });

  it("deletes only the exact normalized page and all its visits in one write", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const target = page("https://example.com/a?q=1#one");
    const note = await store.create(target, "Delete this local note");
    const otherPages = [
      page("https://example.com/a?q=2#one"),
      page("https://example.com/a?q=1#two"),
      page("http://example.com/a?q=1#one"),
      page("https://other.example.com/a?q=1#one"),
    ];
    for (const other of otherPages) {
      await store.create(other, "Keep");
      await store.visit(other);
    }
    await store.visit(target);
    const before = await store.load();
    // Older backups may contain multiple visits for one page.
    await persistence.write({
      ...before,
      history: [...before.history, { ...target, visitedAt: 1 }],
    });
    const writes = persistence.writes;
    const result = await store.deletePage("HTTPS://EXAMPLE.COM:443/a?q=1#one", {
      id: note.id,
      revision: note.revision,
    });
    expect(persistence.writes).toBe(writes + 1);
    expect(result).toEqual({
      ...before,
      notes: before.notes.filter((item) => item.id !== note.id),
      history: before.history.filter((visit) => visit.url !== target.url),
    });
    expect(await new LibraryStore(persistence).load()).toEqual(result);
    result.notes[0]!.markdown = "External mutation";
    expect((await store.load()).notes[0]!.markdown).toBe("Keep");
  });

  it("omits legacy history-only pages and makes their deletion a no-op", async () => {
    const persistence = memory({
      version: 1,
      notes: [],
      history: [{ ...page(), visitedAt: 1 }],
    });
    const store = new LibraryStore(persistence);
    expect((await store.load()).history).toEqual([]);
    const before = await store.load();
    expect(await store.deletePage(page().url, null)).toEqual({
      ...before,
      history: [],
    });
    const writes = persistence.writes;
    await store.deletePage(page().url, null);
    expect(persistence.writes).toBe(writes);
  });

  it("rejects stale revisions, wrong identities and wrong URLs without deleting data", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const note = await store.create(page(), "Original");
    await store.visit(page());
    await store.save(note.id, "Newer edit", note.revision);
    const before = await store.load();
    const writes = persistence.writes;
    for (const [url, expectedNote] of [
      [note.url, { id: note.id, revision: 1 }],
      [note.url, { id: "another-identity", revision: 2 }],
      ["https://other.example.com/", { id: note.id, revision: 2 }],
      [note.url, null],
    ] as const)
      await expect(store.deletePage(url, expectedNote)).rejects.toMatchObject({
        code: "conflict",
      });
    expect(persistence.writes).toBe(writes);
    expect(await store.load()).toEqual(before);
  });

  it("rejects deleted or recreated note identities, preserving subsequent visits", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const note = await store.create(page(), "Old");
    const expected = { id: note.id, revision: note.revision };
    await store.deletePage(note.url, expected);
    await store.visit(page());
    await expect(store.deletePage(note.url, expected)).rejects.toMatchObject({
      code: "conflict",
    });
    const recreated = await store.create(page(), "Recreated");
    await store.visit(page());
    await expect(store.deletePage(note.url, expected)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await store.load()).toMatchObject({
      notes: [recreated],
      history: [{ url: note.url }],
    });
  });

  it("serializes deletion against saves and protects a concurrently created note", async () => {
    const store = new LibraryStore(memory());
    await store.visit(page());
    const created = await Promise.allSettled([
      store.create(page(), "Concurrent create"),
      store.deletePage(page().url, null),
    ]);
    expect(created.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((created[1] as PromiseRejectedResult).reason).toMatchObject({
      code: "conflict",
    });
    const note = (await store.load()).notes[0]!;
    await store.visit(page());
    const saved = await Promise.allSettled([
      store.save(note.id, "Concurrent save", note.revision),
      store.deletePage(note.url, { id: note.id, revision: note.revision }),
    ]);
    expect(saved.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((saved[1] as PromiseRejectedResult).reason).toMatchObject({
      code: "conflict",
    });
    expect(await store.load()).toMatchObject({
      notes: [
        {
          ...note,
          markdown: "Concurrent save",
          updatedAt: expect.any(Number),
          revision: 2,
        },
      ],
      history: [{ url: note.url }],
    });
  });

  it("validates deletion input before writing and keeps the whole library on storage failure", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const note = await store.create(page(), "Keep");
    await store.visit(page());
    const before = await store.load();
    const expected = { id: note.id, revision: note.revision };
    for (const url of [
      "javascript:alert(1)",
      "https://user:password@example.com/",
      " https://example.com/",
    ])
      await expect(store.deletePage(url, expected)).rejects.toMatchObject({
        code: "invalid",
      });
    for (const invalidExpected of [
      undefined,
      {},
      { id: "", revision: 1 },
      { id: "x".repeat(129), revision: 1 },
      { id: "bad\nidentity", revision: 1 },
      { id: note.id, revision: 0 },
      { id: note.id, revision: 1.5 },
      { id: note.id, revision: 1, extra: true },
    ])
      await expect(
        store.deletePage(note.url, invalidExpected as typeof expected),
      ).rejects.toMatchObject({ code: "invalid" });
    const writes = persistence.writes;
    persistence.setFailure(true);
    await expect(store.deletePage(note.url, expected)).rejects.toMatchObject({
      code: "storage",
      message: "Browser library storage failed.",
    });
    expect(persistence.writes).toBe(writes);
    expect(await store.load()).toEqual(before);
    persistence.setFailure(false);
    expect(await store.deletePage(note.url, expected)).toEqual({
      ...before,
      notes: [],
      history: [],
    });
  });

  it("loads version 1, 2 and 3 library shapes without the retired Shared and Global records", async () => {
    const source = new LibraryStore(memory());
    const root = await source.create(
      page("https://example.com/"),
      `${properties()}\nRoot body`,
    );
    const record = {
      id: "old-shared",
      markdown: "Shared text",
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    };
    for (const stored of [
      { version: 1, notes: [root], history: [] },
      {
        version: 2,
        notes: [root],
        history: [],
        domains: [{ ...record, origin: "https://example.com" }],
      },
      {
        version: 3,
        notes: [root],
        history: [],
        domains: [{ ...record, origin: "https://example.com" }],
        global: { ...record, id: "old-global", scope: "global" },
      },
      { version: 3, notes: [root], history: [], domains: [], global: null },
      { version: 3, notes: [root], history: [] },
    ]) {
      const persistence = memory(stored);
      expect(await new LibraryStore(persistence).load()).toEqual({
        version: 3,
        notes: [root],
        history: [],
      });
      // Reading never rewrites the stored value.
      expect(persistence.writes).toBe(0);
      expect(persistence.value).toEqual(stored);
    }
  });

  it("validates the origin of a retired Shared link exactly", () => {
    for (const invalidOrigin of [
      "https://example.com/",
      "https://example.com/a",
      "https://example.com:443",
      "HTTPS://EXAMPLE.COM",
      "https://user:pass@example.com",
      "file:///tmp",
    ])
      expect(() => normalizeDomainOrigin(invalidOrigin)).toThrow(LibraryError);
    expect(
      normalizeDomainOrigin(new URL("HTTPS://EXAMPLE.COM:443/a").origin),
    ).toBe("https://example.com");
  });

  it("persists notes and own visits across store restarts, with no mutable return values", async () => {
    const persistence = memory();
    const first = new LibraryStore(persistence);
    const created = await first.create(page(), "Original");
    await first.visit(page());
    created.markdown = "Changed outside the store";
    const second = new LibraryStore(persistence);
    const loaded = await second.load();
    expect(loaded.notes[0]?.markdown).toBe("Original");
    expect(loaded.history).toMatchObject([{ url: page().url, title: "Plan" }]);
    loaded.notes[0]!.markdown = "Corruption attempt";
    expect((await second.load()).notes[0]?.markdown).toBe("Original");
    expect(JSON.parse(await second.exportBackup())).toMatchObject({
      version: 3,
      notes: [{ markdown: "Original" }],
    });
  });

  it("serializes concurrent saves and rejects stale panel revisions", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const note = await store.create(page());
    const results = await Promise.allSettled([
      store.save(note.id, "Panel A", note.revision),
      store.save(note.id, "Panel B", note.revision),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
      code: "conflict",
    });
    expect((await store.load()).notes[0]?.markdown).toBe("Panel A");
    const revised = await store.save(note.id, "Now current", 2);
    expect(revised.revision).toBe(3);
  });

  it("rejects create-if-absent when a note already exists without changing it", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const existing = await store.create(page(), "First draft");
    const writes = persistence.writes;
    await expect(
      store.create(page(), "Second draft", { ifAbsent: true }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(persistence.writes).toBe(writes);
    expect((await store.load()).notes).toEqual([existing]);
  });

  it("allows only one concurrent create-if-absent for the same page", async () => {
    const store = new LibraryStore(memory());
    const results = await Promise.allSettled([
      store.create(page(), "Panel A", { ifAbsent: true }),
      store.create(page(), "Panel B", { ifAbsent: true }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
      code: "conflict",
    });
    expect((await store.load()).notes).toMatchObject([
      { markdown: "Panel A", revision: 1 },
    ]);
  });

  it("keeps committed data unchanged on failed writes and sanitizes storage errors", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const note = await store.create(page(), "Safe");
    persistence.setFailure(true);
    await expect(
      store.save(note.id, "Sensitive draft", 1),
    ).rejects.toMatchObject({ code: "storage" });
    persistence.setFailure(false);
    expect((await store.load()).notes[0]).toMatchObject({
      markdown: "Safe",
      revision: 1,
    });
    expect(await store.save(note.id, "Retried", 1)).toMatchObject({
      markdown: "Retried",
      revision: 2,
    });
  });

  it("rejects corrupt persisted data and does not replace it", async () => {
    const persistence = memory({
      version: 1,
      notes: [{ markdown: "secret" }],
      history: [],
    });
    const store = new LibraryStore(persistence);
    await expect(store.load()).rejects.toMatchObject({ code: "invalid" });
    await expect(store.visit(page())).rejects.toMatchObject({
      code: "invalid",
    });
    expect(persistence.writes).toBe(0);
  });

  it("enforces per-note and whole-library bounds without partially committing", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const note = await store.create(page(), "ok");
    await expect(
      store.save(note.id, "x".repeat(512 * 1024 + 1), 1),
    ).rejects.toMatchObject({ code: "quota" });
    const huge = {
      version: 1,
      notes: Array.from({ length: 501 }, (_, index) => ({
        id: String(index),
        url: `https://example.com/${index}`,
        title: "T",
        markdown: "",
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      })),
      history: [],
    };
    await expect(
      store.importBackup(JSON.stringify(huge)),
    ).rejects.toMatchObject({ code: "quota" });
    const oversizedText = JSON.stringify({
      version: 1,
      notes: huge.notes
        .slice(0, 13)
        .map((entry) => ({ ...entry, markdown: "x".repeat(500_000) })),
      history: [],
    });
    await expect(store.importBackup(oversizedText)).rejects.toMatchObject({
      code: "quota",
    });
    expect((await store.load()).notes).toHaveLength(1);
  });

  it("merges backup notes additively by URL, remaps ID collisions, and never overwrites", async () => {
    const store = new LibraryStore(memory());
    const existing = await store.create(page(), "Local");
    const backup = {
      version: 1,
      notes: [
        {
          ...existing,
          id: "other-import-id",
          markdown: "Imported but conflicting",
        },
        {
          ...existing,
          url: "https://wiki.example.com/team/other",
          title: "Other",
          markdown: "New",
        },
      ],
      history: [],
    };
    const result = await store.importBackup(JSON.stringify(backup));
    expect(result).toMatchObject({ created: 1, skipped: 1 });
    expect(result.library.notes).toHaveLength(2);
    expect(result.library.notes[0]?.markdown).toBe("Local");
    expect(result.library.notes[1]?.id).not.toBe(existing.id);
  });

  it("rejects a wholly malformed backup before writing and rejects prototype keys", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const valid = await store.create(page(), "Keep");
    const writes = persistence.writes;
    await expect(
      store.importBackup(
        '{"version":1,"notes":[],"history":[],"__proto__":{"admin":true}}',
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      store.importBackup(
        JSON.stringify({
          version: 1,
          notes: [{ ...valid, url: "javascript:alert(1)" }],
          history: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(persistence.writes).toBe(writes);
    expect((await store.load()).notes[0]?.markdown).toBe("Keep");
  });

  it("treats query/hash variants as distinct pages and rejects credentialed or non-web URLs", async () => {
    const store = new LibraryStore(memory());
    await store.create(page("https://wiki.example.com/a?x=1#one"));
    await store.create(page("https://wiki.example.com/a?x=1#two"));
    await store.create(page("https://wiki.example.com/a?x=2#one"));
    expect((await store.load()).notes).toHaveLength(3);
    expect(normalizePageUrl("HTTPS://Wiki.Example.com/a?x=1#one")).toBe(
      "https://wiki.example.com/a?x=1#one",
    );
    for (const url of [
      "javascript:alert(1)",
      "file:///secret",
      "https://user:pass@example.com/a",
    ]) {
      expect(() => normalizePageUrl(url)).toThrow(LibraryError);
    }
  });

  it("groups by actual host and URL path, retaining exact URL leaves and titles", async () => {
    const store = new LibraryStore(memory());
    await store.create({
      url: "https://wiki.example.com/team/plan?view=1",
      title: "First",
    });
    await store.create({
      url: "https://wiki.example.com/team/plan?view=2",
      title: "Second",
    });
    await store.create({ url: "https://wiki.example.com/team", title: "Team" });
    await store.create({
      url: "https://docs.example.com/guide",
      title: "Guide",
    });
    const tree = buildDomainTree((await store.load()).notes);
    expect(tree.map((domain) => domain.host)).toEqual([
      "docs.example.com",
      "wiki.example.com",
    ]);
    const team = tree[1]?.paths[0];
    expect(team?.path).toBe("/team");
    expect(team?.notes.map((note) => note.title)).toEqual(["Team"]);
    expect(team?.children[0]?.notes.map((note) => note.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(team?.children[0]?.notes.map((note) => note.url)).toEqual([
      "https://wiki.example.com/team/plan?view=1",
      "https://wiki.example.com/team/plan?view=2",
    ]);
  });

  it("keeps repeated slashes, schemes, and deep path leaves distinct without unbounded tree depth", async () => {
    const store = new LibraryStore(memory());
    const exact = await store.create(page("https://example.com/a//b#one"));
    await store.create(page("https://example.com/a/b#one"));
    await store.create(page("http://example.com/a//b#one"));
    const deepUrl = `https://example.com/${Array.from({ length: 100 }, (_, index) => `s${index}`).join("/")}`;
    const deep = await store.create(page(deepUrl));
    const tree = buildDomainTree((await store.load()).notes);
    expect(tree).toHaveLength(1);
    const a = tree[0]!.paths.find((node) => node.path === "/a")!;
    expect(a.children.find((node) => node.path === "/a/b")?.notes).toHaveLength(
      1,
    );
    const repeated = a.children.find((node) => node.path === "/a/")!;
    expect(repeated.children[0]?.path).toBe("/a//b");
    expect(repeated.children[0]?.notes.map((note) => note.url)).toEqual([
      "http://example.com/a//b#one",
      exact.url,
    ]);
    let children = tree[0]!.paths;
    let depth = 0;
    while (children.length) {
      const branch = children.find(
        (node) =>
          node.path === deepUrl.slice("https://example.com".length) ||
          node.path.startsWith("/s0"),
      );
      if (!branch) break;
      depth++;
      if (branch.notes.some((note) => note.id === deep.id)) {
        expect(branch.path).toBe(new URL(deepUrl).pathname);
        break;
      }
      children = branch.children;
    }
    expect(depth).toBe(64);
  });

  it("deduplicates page visits and suppresses rapid identical encrypted writes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    try {
      const persistence = memory();
      const store = new LibraryStore(persistence);
      await store.create(page("https://example.com/a"), "Saved A");
      await store.create(page("https://example.com/b"), "Saved B");
      await store.visit(page("https://example.com/a"));
      const firstWriteCount = persistence.writes;
      clock.mockReturnValue(100_500);
      await store.visit(page("https://example.com/a"));
      expect(persistence.writes).toBe(firstWriteCount);
      clock.mockReturnValue(131_000);
      await store.visit(page("https://example.com/b"));
      await store.visit(page("https://example.com/a"));
      expect((await store.load()).history.map((visit) => visit.url)).toEqual([
        "https://example.com/a",
        "https://example.com/b",
      ]);
      expect(persistence.writes).toBe(firstWriteCount + 2);
    } finally {
      clock.mockRestore();
    }
  });

  it("exposes strict decrypted-library validation without retaining caller objects", () => {
    const source = { version: 1, notes: [], history: [] };
    const safe = validateBrowserLibrary(source);
    safe.history.push({
      url: "https://example.com/",
      title: "X",
      visitedAt: 1,
    });
    expect(source.history).toHaveLength(0);
    expect(() =>
      validateBrowserLibrary({ ...source, unexpected: true }),
    ).toThrow(LibraryError);
  });

  it("caps its own panel-visit log at 100 entries", async () => {
    const store = new LibraryStore(memory());
    for (let index = 0; index < 102; index++) {
      await store.create(
        page(`https://example.com/${index}`),
        `Saved ${index}`,
      );
      await store.visit(page(`https://example.com/${index}`));
    }
    const history = (await store.load()).history;
    expect(history).toHaveLength(100);
    expect(history[0]?.url).toBe("https://example.com/101");
    expect(history.at(-1)?.url).toBe("https://example.com/2");
  });
});
