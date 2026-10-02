import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BrowserMarkdownStorage,
  BrowserSourceAccess,
  FILE_SOURCE_KEY,
  reconnectBrowserSource,
} from "../src/browser/markdown-storage";
import type { BrowserLibrary } from "../src/browser/library";
import { markdownFixture } from "./helpers/browser-markdown-fixture";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

async function harness(initial: Record<string, string>, single?: string) {
  const fixture = markdownFixture(initial);
  if (single) fixture.handles.set("browser-test", fixture.file(single));
  const local: Record<string, unknown> = {
    "aic-browser-library": { untouched: true },
    "aic-browser-file-source": { untouched: true },
  };
  const persistence = {
    get: async () => local,
    set: async (value: Record<string, unknown>) => {
      Object.assign(local, value);
    },
  };
  let storage = new BrowserMarkdownStorage(persistence, fixture.bindings);
  await storage.connect("browser-test");
  return {
    fixture,
    local,
    storage,
    restart: () =>
      (storage = new BrowserMarkdownStorage(persistence, fixture.bindings)),
  };
}
function changed(library: BrowserLibrary, markdown: string): BrowserLibrary {
  const copy = structuredClone(library);
  copy.notes[0]!.markdown = markdown;
  copy.notes[0]!.revision++;
  return copy;
}

describe("plain Markdown source storage", () => {
  it("opens actual files without passwords or changing bytes, preserving old opaque caches", async () => {
    const h = await harness({
      "project/readme.md": "# Original\n",
      "notes.txt": "not a note",
    });
    expect(await h.storage.read()).toMatchObject({
      notes: [
        { url: "", filePath: "project/readme.md", markdown: "# Original\n" },
      ],
    });
    expect(
      [...h.fixture.entries].filter(([name]) => name.startsWith(".aic")),
    ).toEqual([]);
    expect(h.local[FILE_SOURCE_KEY]).toMatchObject({
      kind: "directory",
      id: "browser-test",
    });
    expect(h.local["aic-browser-library"]).toEqual({ untouched: true });
    expect(h.local["aic-browser-file-source"]).toEqual({ untouched: true });
  });

  it("writes a single file as exact Markdown and supports repeated saves and restart", async () => {
    const h = await harness({ "note.md": "Original" }, "note.md");
    await h.storage.write(changed(await h.storage.read(), "First edit"));
    const first = h.storage.snapshot();
    await h.storage.write(changed(first, "Second edit"));
    expect(h.fixture.text("note.md")).toBe("Second edit");
    expect(
      [...h.fixture.entries.keys()].filter((key) => key.startsWith(".aic")),
    ).toEqual([]);
    expect((await h.restart().read()).notes[0]?.markdown).toBe("Second edit");
  });

  it("preserves UTF-8 BOM and CRLF when native File.text would strip the BOM", async () => {
    const h = await harness({ "note.md": "\uFEFF# Note\r\n" }, "note.md");
    const native = h.fixture.file("note.md");
    native.getFile = async () => {
      const bytes = new TextEncoder().encode(h.fixture.text("note.md")!);
      return {
        size: bytes.length,
        text: async () => "# Note\r\n",
        arrayBuffer: async () => bytes.buffer,
      };
    };
    h.fixture.handles.set("browser-test", native);
    const storage = h.restart();
    const opened = await storage.read();
    expect(opened.notes[0]?.markdown).toBe("\uFEFF# Note\r\n");
    await storage.write(changed(opened, "\uFEFF# Updated\r\n"));
    expect(h.fixture.text("note.md")).toBe("\uFEFF# Updated\r\n");
  });

  it("rejects external changes and deleted originals without recreating or overwriting them", async () => {
    const h = await harness({ "note.md": "Original" });
    const before = await h.storage.read();
    h.fixture.put("note.md", "External edit");
    await expect(
      h.storage.write(changed(before, "Stale draft")),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(h.fixture.text("note.md")).toBe("External edit");
    h.fixture.remove("note.md");
    await expect(
      h.storage.write(changed(before, "Must not recreate")),
    ).rejects.toBeDefined();
    expect(h.fixture.entries.has("note.md")).toBe(false);
  });

  it("keeps found notes after large non-Markdown selections and applies nested ignore rules", async () => {
    const data: Record<string, string> = {
      ".gitignore": "build/\nignored.md\n",
      ".ignore": "*.private.md\n",
      "root.md": "Root",
      "nested/.ignore": "hidden.md\n",
      "nested/visible.md": "Nested",
      "nested/hidden.md": "Ignored",
      "ignored.md": "Ignored",
      "note.private.md": "Ignored",
      "build/readme.md": "Ignored",
      "node_modules/readme.md": "Ignored",
      ".git/readme.md": "Ignored",
    };
    for (let i = 0; i < 10_100; i++) data[`asset-${i}.js`] = "// source";
    const h = await harness(data);
    expect(
      (await h.storage.read()).notes.map((note) => note.filePath).sort(),
    ).toEqual(["nested/visible.md", "root.md"]);
  });

  it("does not apply the old vault's 500-note cap to a selected folder", async () => {
    const data = Object.fromEntries(
      Array.from({ length: 501 }, (_, n) => [`note-${n}.md`, "Body"]),
    );
    const h = await harness(data);
    expect((await h.storage.read()).notes).toHaveLength(501);
  });

  it("keeps readable notes and reports oversized/unreadable siblings without blocking saves", async () => {
    const h = await harness({
      "good.md": "Original",
      "large.md": "x".repeat(512 * 1024 + 1),
    });
    const library = await h.storage.read();
    expect(library.notes.map((note) => note.filePath)).toEqual(["good.md"]);
    expect(h.storage.warnings.join(" ")).toContain("large.md");
    const scans = h.fixture.state.scans;
    await h.storage.read(false);
    await h.storage.write(changed(library, "Saved good note"));
    expect(h.fixture.state.scans).toBe(scans);
    expect(h.fixture.text("good.md")).toBe("Saved good note");
  });

  it("retains metadata for files excluded later and never writes Markdown inside metadata", async () => {
    const h = await harness({ "one.md": "First", "two.md": "Second" });
    const initial = await h.storage.read();
    initial.notes[1]!.url = "https://example.test/hidden";
    await h.storage.write(initial);
    const beforeIndex = JSON.parse(h.fixture.text(".aic/links.json")!);
    h.fixture.put(".ignore", "two.md\n");
    const visible = await h.storage.read();
    await h.storage.write(changed(visible, "Changed first"));
    const afterIndex = JSON.parse(h.fixture.text(".aic/links.json")!);
    expect(
      afterIndex.entries.find(
        (entry: { path: string }) => entry.path === "two.md",
      ),
    ).toEqual(
      beforeIndex.entries.find(
        (entry: { path: string }) => entry.path === "two.md",
      ),
    );
    expect(h.fixture.text(".aic/links.json")).not.toContain("Changed first");
    expect(h.fixture.text("two.md")).toBe("Second");
  });

  it("acknowledges committed Markdown plus durable metadata intent and recovers identity after restart", async () => {
    const index = JSON.stringify({
      format: "aic-markdown-links",
      version: 1,
      entries: [],
    });
    const h = await harness({ ".aic/links.json": index });
    h.fixture.entries.get(".aic/links.json")!.failClose = true;
    const next = await h.storage.read();
    next.notes.push({
      id: "created-page",
      url: "https://example.test/page",
      title: "Page",
      markdown: "Saved actual text",
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    });
    await h.storage.write(next);
    expect(h.fixture.text("pages/created-page.md")).toBe("Saved actual text");
    expect(h.fixture.text(".aic/links.pending.json")).not.toContain(
      "Saved actual text",
    );
    const reopened = h.restart();
    expect((await reopened.read()).notes).toMatchObject([
      {
        id: "created-page",
        url: "https://example.test/page",
        markdown: "Saved actual text",
      },
    ]);
    await reopened.write(changed(reopened.snapshot(), "Second real edit"));
    expect(
      [...h.fixture.entries.keys()].filter((path) => path.endsWith(".md")),
    ).toEqual(["pages/created-page.md"]);
    h.fixture.entries.get(".aic/links.json")!.failClose = false;
    const finalStorage = h.restart();
    const restored = await finalStorage.read();
    expect(restored.notes[0]).toMatchObject({
      id: "created-page",
      markdown: "Second real edit",
      revision: 2,
    });
    expect(h.fixture.text(".aic/links.pending.json")).not.toBe("");
    await finalStorage.write(changed(restored, "Final edit"));
    expect(h.fixture.text(".aic/links.pending.json")).toBe("");
  });

  it("does not replay pending links over externally modified sidecar metadata", async () => {
    const initial = JSON.stringify({
      format: "aic-markdown-links",
      version: 1,
      entries: [],
    });
    const h = await harness({
      ".aic/links.json": initial,
      "note.md": "Before",
    });
    h.fixture.entries.get(".aic/links.json")!.failClose = true;
    await h.storage.write(changed(await h.storage.read(), "Committed body"));
    h.fixture.put(
      ".aic/links.json",
      JSON.stringify(
        { format: "aic-markdown-links", version: 1, entries: [] },
        null,
        2,
      ),
    );
    h.fixture.entries.get(".aic/links.json")!.failClose = false;
    const reopened = h.restart();
    const library = await reopened.read();
    expect(reopened.warnings.join(" ")).toContain("changed");
    await expect(
      reopened.write(changed(library, "Must not write")),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(h.fixture.text("note.md")).toBe("Committed body");
  });

  it("restores permission to the retained source without changing file contents", async () => {
    const h = await harness({ "note.md": "Original" });
    h.fixture.state.allowed = false;
    await expect(h.storage.read()).rejects.toMatchObject({
      code: "permission",
    });
    const access = new BrowserSourceAccess(h.fixture.bindings);
    await access.warm("browser-test");
    await reconnectBrowserSource("browser-test", access);
    expect((await h.storage.read()).notes[0]?.markdown).toBe("Original");
  });
});
