import { describe, expect, it, vi } from "vitest";
import {
  buildDomainTree,
  BrowserLibrary,
  LibraryError,
  LibraryStore,
  normalizePageUrl,
  normalizeDomainOrigin,
  validateDomainProperties,
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
    `---\n# aic-fields: v2\nPassword*: ${value}\n---\n`;

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
    await store.createDomain("https://example.com", properties());
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
    result.domains[0]!.markdown = "External mutation";
    result.notes[0]!.markdown = "External mutation";
    expect((await store.load()).domains).toEqual(before.domains);
    expect((await store.load()).notes[0]!.markdown).toBe("Keep");
  });

  it("removes history-only pages and makes repeated history-only deletion a no-op", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    await store.visit(page());
    await store.createDomain("https://wiki.example.com", properties());
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
    await store.createDomain("https://wiki.example.com", properties());
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

  it("lifts legacy data without sharing or modifying root-page Properties", async () => {
    const source = new LibraryStore(memory());
    const root = await source.create(
      page("https://example.com/"),
      `${properties()}\nRoot body`,
    );
    const persistence = memory({ version: 1, notes: [root], history: [] });
    const store = new LibraryStore(persistence);
    expect(await store.load()).toEqual({
      version: 2,
      notes: [root],
      history: [],
      domains: [],
    });
    expect(persistence.writes).toBe(0);
    await store.createDomain("https://example.com", properties("shared"));
    expect((await store.load()).notes).toEqual([root]);
    expect(persistence.value).toMatchObject({
      version: 2,
      domains: [{ origin: "https://example.com" }],
    });
  });

  it("keeps origins distinct without copying shared values into page notes", async () => {
    const store = new LibraryStore(memory());
    const origins = [
      "https://example.com",
      "http://example.com",
      "https://example.com:8443",
      "https://sub.example.com",
    ];
    for (const origin of origins)
      await store.createDomain(origin, properties());
    for (const path of ["/", "/a", "/b?q=x#y"])
      await store.create(page(`https://example.com${path}`), "Page only");
    const library = await store.load();
    expect(library.domains.map((domain) => domain.origin)).toEqual(origins);
    expect(library.notes.every((note) => note.markdown === "Page only")).toBe(
      true,
    );
    library.domains[0]!.markdown = "external mutation";
    expect((await store.load()).domains[0]!.markdown).toBe(properties());
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

  it("rejects concurrent shared creates and stale saves without touching the winner", async () => {
    const store = new LibraryStore(memory());
    const created = await Promise.allSettled([
      store.createDomain("https://example.com", properties("first")),
      store.createDomain("https://example.com", properties("second")),
    ]);
    expect(created.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((created[1] as PromiseRejectedResult).reason).toMatchObject({
      code: "conflict",
    });
    const domain = (await store.load()).domains[0]!;
    const saved = await Promise.allSettled([
      store.saveDomain(domain.id, properties("winner"), 1),
      store.saveDomain(domain.id, properties("stale"), 1),
    ]);
    expect(saved.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((await store.load()).domains[0]).toEqual({
      ...domain,
      markdown: properties("winner"),
      updatedAt: expect.any(Number),
      revision: 2,
    });
  });

  it("persists only complete supported Properties and preserves data on failures", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const domain = await store.createDomain(
      "https://example.com",
      properties(),
    );
    for (const text of [
      "",
      "---\nPassword*: unfinished",
      `${properties()}ordinary Markdown`,
      "---\nkey: [\n---",
      "---\n# aic-fields: v99\nkey: value\n---",
      "---\na: &shared value\nb: *shared\n---",
    ])
      await expect(store.saveDomain(domain.id, text, 1)).rejects.toMatchObject({
        code: "invalid",
        message: "Invalid browser library data.",
      });
    expect(
      validateDomainProperties("---\n# aic-fields: v2\n---\n\n"),
    ).toContain("aic-fields");
    expect(
      validateDomainProperties(properties().replaceAll("\n", "\r\n")),
    ).toContain("\r\n");
    await expect(
      store.saveDomain(domain.id, "x".repeat(512 * 1024 + 1), 1),
    ).rejects.toMatchObject({ code: "quota" });
    persistence.setFailure(true);
    await expect(
      store.saveDomain(domain.id, properties("failed"), 1),
    ).rejects.toMatchObject({ code: "storage" });
    persistence.setFailure(false);
    expect((await store.load()).domains).toEqual([domain]);
  });

  it("merges domain backups by origin and atomically rejects invalid domains", async () => {
    const persistence = memory();
    const store = new LibraryStore(persistence);
    const local = await store.createDomain(
      "https://example.com",
      properties("local"),
    );
    const incoming = {
      version: 2,
      notes: [],
      history: [],
      domains: [
        {
          ...local,
          id: "conflicting-origin",
          markdown: properties("conflicting"),
        },
        {
          ...local,
          origin: "https://other.example.com",
          markdown: properties("addition"),
        },
      ],
    };
    expect(await store.importBackup(JSON.stringify(incoming))).toMatchObject({
      created: 0,
      skipped: 0,
      domainsCreated: 1,
      domainsSkipped: 1,
    });
    const library = await store.load();
    expect(library.domains[0]).toEqual(local);
    expect(library.domains[1]!.id).not.toBe(local.id);
    expect(JSON.parse(await store.exportBackup()).domains).toHaveLength(2);
    const writes = persistence.writes;
    await expect(
      store.importBackup(
        JSON.stringify({
          ...incoming,
          domains: [
            {
              ...local,
              origin: "https://new.example.com",
              markdown: "plaintext body",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(persistence.writes).toBe(writes);
    expect(await store.load()).toEqual(library);
    expect(() =>
      validateBrowserLibrary({
        ...library,
        domains: [local, { ...local, id: "another" }],
      }),
    ).toThrow(LibraryError);
    expect(() =>
      validateBrowserLibrary({
        version: 2,
        notes: [],
        history: [],
        domains: Array.from({ length: 501 }, (_, index) => ({
          ...local,
          id: String(index),
          origin: `https://h${index}.example.com`,
        })),
      }),
    ).toThrow(LibraryError);
  });

  it("counts domain source in the shared encrypted-library quota before committing", async () => {
    const markdown = `${properties()}${" ".repeat(500_000)}`;
    const domains = Array.from({ length: 12 }, (_, index) => ({
      id: `quota-domain-${index}`,
      origin: `https://h${index}.example.com`,
      markdown,
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    }));
    const persistence = memory({ version: 2, notes: [], history: [], domains });
    const store = new LibraryStore(persistence);
    await expect(
      store.createDomain("https://extra.example.com", markdown),
    ).rejects.toMatchObject({ code: "quota" });
    expect(persistence.writes).toBe(0);
    expect((await store.load()).domains).toHaveLength(12);
  });

  it("persists notes and own visits across store restarts, with no mutable return values", async () => {
    const persistence = memory();
    const first = new LibraryStore(persistence);
    await first.visit(page());
    const created = await first.create(page(), "Original");
    created.markdown = "Changed outside the store";
    const second = new LibraryStore(persistence);
    const loaded = await second.load();
    expect(loaded.notes[0]?.markdown).toBe("Original");
    expect(loaded.history).toMatchObject([{ url: page().url, title: "Plan" }]);
    loaded.notes[0]!.markdown = "Corruption attempt";
    expect((await second.load()).notes[0]?.markdown).toBe("Original");
    expect(JSON.parse(await second.exportBackup())).toMatchObject({
      version: 2,
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
    ).rejects.toMatchObject({ code: "invalid" });
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
    for (let index = 0; index < 102; index++)
      await store.visit(page(`https://example.com/${index}`));
    const history = (await store.load()).history;
    expect(history).toHaveLength(100);
    expect(history[0]?.url).toBe("https://example.com/101");
    expect(history.at(-1)?.url).toBe("https://example.com/2");
  });
});
