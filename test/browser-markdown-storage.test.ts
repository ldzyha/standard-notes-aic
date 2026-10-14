import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  BrowserMarkdownStorage,
  BrowserSourceAccess,
  FILE_SOURCE_KEY,
  reconnectBrowserSource,
} from "../src/browser/markdown-storage";
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
  const open = () => new BrowserMarkdownStorage(persistence, fixture.bindings);
  const storage = open();
  await storage.connect("browser-test");
  return { fixture, local, storage, restart: open };
}

describe("the one note file", () => {
  it("writes a connected file as exact Markdown across repeated saves and a restart", async () => {
    const h = await harness({ "note.md": "Original" }, "note.md");
    const opened = await h.storage.read();
    expect(opened).toMatchObject({ filePath: "note.md", markdown: "Original" });
    const first = await h.storage.save(
      opened.id,
      "First edit",
      opened.revision,
    );
    await h.storage.save(first.id, "Second edit", first.revision);
    expect(h.fixture.text("note.md")).toBe("Second edit");
    expect([...h.fixture.entries.keys()].sort()).toEqual(["aic.md", "note.md"]);
    expect(h.fixture.text("aic.md")).toBe("");
    expect((await h.restart().read()).markdown).toBe("Second edit");
    expect(h.local[FILE_SOURCE_KEY]).toMatchObject({
      kind: "file",
      id: "browser-test",
    });
    expect(h.local["aic-browser-library"]).toEqual({ untouched: true });
    expect(h.local["aic-browser-file-source"]).toEqual({ untouched: true });
  });

  it("preserves UTF-8 BOM and CRLF when native File.text would strip the BOM", async () => {
    const h = await harness({ "note.md": "﻿# Note\r\n" }, "note.md");
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
    expect(opened.markdown).toBe("﻿# Note\r\n");
    await storage.save(opened.id, "﻿# Updated\r\n", opened.revision);
    expect(h.fixture.text("note.md")).toBe("﻿# Updated\r\n");
  });

  it("asks for the note file again when an earlier version remembered a folder", async () => {
    const h = await harness({ "aic.md": "Note" });
    h.local[FILE_SOURCE_KEY] = {
      id: "browser-test",
      kind: "directory",
      name: "notes",
    };
    await expect(h.restart().read()).rejects.toMatchObject({
      code: "source",
      message: expect.stringContaining("no longer opens folders"),
    });
    expect(h.fixture.entries.get("aic.md")).toMatchObject({ writes: 0 });
  });

  it("adopts an existing aic.md byte for byte", async () => {
    const text =
      "---\r\ntitle: Mine\r\n---\r\n\r\nIntro\r\n\r\n--- /b\r\nB\r\n";
    const h = await harness({ "aic.md": text });
    expect((await h.storage.read()).markdown).toBe(text);
    expect(h.fixture.text("aic.md")).toBe(text);
    expect(h.fixture.entries.get("aic.md")).toMatchObject({ writes: 0 });
  });

  it("rejects external changes and a deleted note file without overwriting or recreating it", async () => {
    for (const single of [undefined, "aic.md"]) {
      const h = await harness({ "aic.md": "Original" }, single);
      const before = await h.storage.read(false);
      h.fixture.put("aic.md", "External edit");
      await expect(
        h.storage.save(before.id, "Stale draft", before.revision),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(h.fixture.text("aic.md")).toBe("External edit");
      // Reading again adopts the change; the stale token stays rejected.
      const current = await h.storage.read();
      expect(current.markdown).toBe("External edit");
      await expect(
        h.storage.save(before.id, "Stale draft", before.revision),
      ).rejects.toMatchObject({ code: "conflict" });
      h.fixture.remove("aic.md");
      await expect(
        h.storage.save(current.id, "Must not recreate", current.revision),
      ).rejects.toBeDefined();
      expect(h.fixture.entries.has("aic.md")).toBe(false);
    }
  });

  it("lets only one of two windows save over the same text", async () => {
    const h = await harness({});
    const other = h.restart();
    const first = await h.storage.read();
    const second = await other.read();
    await h.storage.save(first.id, "From the first window", first.revision);
    await expect(
      other.save(second.id, "From the second window", second.revision),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(h.fixture.text("aic.md")).toBe("From the first window");
  });

  it("keeps the 512 KiB cap on the whole note without truncating", async () => {
    const large = "x".repeat(512 * 1024 + 1);
    const h = await harness({ "aic.md": "Small" });
    const opened = await h.storage.read();
    await expect(
      h.storage.save(opened.id, large, opened.revision),
    ).rejects.toMatchObject({
      code: "quota",
      message: expect.stringContaining("note file is too large"),
    });
    expect(h.fixture.text("aic.md")).toBe("Small");
    h.fixture.put("aic.md", large);
    await expect(h.storage.read()).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("note file is too large"),
    });
    expect(h.fixture.text("aic.md")).toBe(large);
    expect(h.fixture.entries.get("aic.md")).toMatchObject({ writes: 0 });
  });

  it("restores permission to the retained source without changing file contents", async () => {
    const h = await harness({ "aic.md": "Original" });
    h.fixture.state.allowed = false;
    await expect(h.storage.read()).rejects.toMatchObject({
      code: "permission",
    });
    const access = new BrowserSourceAccess(h.fixture.bindings);
    await access.warm("browser-test");
    await reconnectBrowserSource("browser-test", access);
    expect((await h.storage.read()).markdown).toBe("Original");
  });
});
