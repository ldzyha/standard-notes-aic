import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBrowserService } from "../src/browser/service";
import { FILE_SOURCE_KEY } from "../src/browser/markdown-storage";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import type { BrowserNote } from "../src/browser/library";
import { markdownFixture } from "./helpers/browser-markdown-fixture";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

function harness(initial: Record<string, string> = {}, single?: string) {
  const files = markdownFixture(initial);
  if (single) files.handles.set("browser-test", files.file(single));
  const local: Record<string, unknown> = {
    "aic-browser-library": { old: "untouched" },
  };
  let active = {
    id: 7,
    windowId: 1,
    url: "https://example.test/wiki/page?id=2#part",
    title: "Synthetic page",
    incognito: false,
  };
  const api = {
    storage: {
      local: {
        get: vi.fn(async () => local),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(local, value);
        }),
        setAccessLevel: vi.fn(async () => {}),
      },
    },
    tabs: {
      query: vi.fn(async () => [active]),
      create: vi.fn(async () => ({})),
    },
    scripting: {
      executeScript: vi.fn(async () => [
        {
          result: {
            url: active.url,
            title: active.title,
            html: "<p>Synthetic</p>",
            truncated: false,
          },
        },
      ]),
    },
  };
  let service = createBrowserService(
    api as unknown as BrowserApi,
    files.bindings,
  );
  const send = (message: Request) =>
    service.handle({ sourceId: "browser-test", ...message });
  return {
    files,
    api,
    local,
    send,
    connect: () =>
      service.handle({
        type: "connect-source",
        bindingId: "browser-test",
        mode: "open",
      }),
    raw: (message: Request) => service.handle(message),
    restart: () => {
      service = createBrowserService(
        api as unknown as BrowserApi,
        files.bindings,
      );
    },
    page: (): ActivePage => ({
      tabId: active.id,
      windowId: active.windowId,
      url: active.url,
      title: active.title,
    }),
    change: (value: Partial<typeof active>) => {
      active = { ...active, ...value };
    },
  };
}

async function note(h: ReturnType<typeof harness>) {
  return (await h.send({ type: "load" })) as BrowserNote;
}

describe("plain browser file service", () => {
  it("opens files without setup/session/password and retains unrelated old cached data", async () => {
    const h = harness({ "plain.md": "# Existing Markdown" });
    expect(await h.raw({ type: "status" })).toEqual({
      state: "unselected",
      source: { kind: "unselected" },
    });
    await expect(h.raw({ type: "load" })).rejects.toMatchObject({
      code: "source",
    });
    expect(await h.connect()).toMatchObject({
      state: "ready",
      source: { kind: "file", id: "browser-test" },
    });
    // Only the note file is opened; other Markdown is not.
    expect(await note(h)).toMatchObject({ filePath: "aic.md", markdown: "" });
    expect(h.files.text("plain.md")).toBe("# Existing Markdown");
    expect(h.local["aic-browser-library"]).toEqual({ old: "untouched" });
    expect(h.local[FILE_SOURCE_KEY]).toMatchObject({ kind: "file" });
    h.restart();
    expect(await h.send({ type: "status" })).toMatchObject({ state: "ready" });
    for (const request of [
      { type: "setup", password: "obsolete" },
      { type: "unlock", password: "obsolete" },
      { type: "lock" },
      { type: "export" },
      { type: "import", text: "legacy", password: "obsolete" },
    ] as Request[])
      await expect(h.send(request)).rejects.toThrow("not supported");
  });

  it("saves the note file and reads disk changes on load", async () => {
    const h = harness({ ".aic/links.json": "{}" });
    expect(await h.connect()).toMatchObject({ state: "ready" });
    const opened = await note(h);
    const saved = (await h.send({
      type: "save",
      id: opened.id,
      revision: opened.revision,
      markdown: "--- https://example.test/a\nNote",
    })) as BrowserNote;
    expect(saved.markdown).toBe("--- https://example.test/a\nNote");
    expect(h.files.text("aic.md")).toBe("--- https://example.test/a\nNote");
    expect(h.files.text(".aic/links.json")).toBe("{}");
    h.files.put("aic.md", "Edited in another editor");
    expect(await note(h)).toMatchObject({
      markdown: "Edited in another editor",
    });
    await expect(
      h.send({
        type: "save",
        id: opened.id,
        revision: 0,
        markdown: "x",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      h.send({
        type: "save",
        id: opened.id,
        revision: saved.revision,
        markdown: "x".repeat(512 * 1024 + 1),
      }),
    ).rejects.toMatchObject({
      code: "quota",
      message: expect.stringContaining("note file is too large"),
    });
    expect(h.files.text("aic.md")).toBe("Edited in another editor");
  });

  it("rejects the retired per-page, Shared and Global requests without touching files", async () => {
    const h = harness({ "global.md": "# Kept" });
    await h.connect();
    for (const request of [
      { type: "visit", windowId: 1 },
      { type: "create", page: h.page(), markdown: "x" },
      { type: "create-file", path: "new.md", markdown: "x" },
      { type: "link-file", id: "a", page: h.page() },
      { type: "delete-page", url: h.page().url, expectedNote: null },
      { type: "navigate", windowId: 1, url: h.page().url },
      { type: "refresh-files" },
      { type: "scan-status" },
      { type: "create-domain", page: h.page(), markdown: "x" },
      { type: "save-domain", id: "a", markdown: "x", revision: 1 },
      { type: "create-global", markdown: "x" },
      { type: "save-global", id: "a", markdown: "x", revision: 1 },
    ])
      await expect(h.send(request as unknown as Request)).rejects.toThrow(
        "Unsupported AIC request.",
      );
    expect(h.files.text("global.md")).toBe("# Kept");
    expect([...h.files.entries.keys()].sort()).toEqual(["aic.md", "global.md"]);
    expect(h.api.tabs.create).not.toHaveBeenCalled();
  });

  it("acknowledges current single-file revisions for consecutive edits and rejects external changes", async () => {
    const h = harness({ "note.md": "Original" }, "note.md");
    await h.connect();
    let current = await note(h);
    current = (await h.send({
      type: "save",
      id: current.id,
      revision: current.revision,
      markdown: "First",
    })) as BrowserNote;
    current = (await h.send({
      type: "save",
      id: current.id,
      revision: current.revision,
      markdown: "Second",
    })) as BrowserNote;
    expect(h.files.text("note.md")).toBe("Second");
    h.files.put("note.md", "External");
    await expect(
      h.send({
        type: "save",
        id: current.id,
        revision: current.revision,
        markdown: "Stale",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(h.files.text("note.md")).toBe("External");
  });

  it("reports the active http(s) page only and guards private windows", async () => {
    const h = harness();
    await h.connect();
    expect(await h.send({ type: "context", windowId: 1 })).toMatchObject({
      url: "https://example.test/wiki/page?id=2#part",
      tabId: 7,
    });
    h.change({ url: "chrome://extensions/" });
    expect(await h.send({ type: "context", windowId: 1 })).toBeNull();
    h.change({ url: "https://example.test/", incognito: true });
    expect(await h.send({ type: "context", windowId: 1 })).toBeNull();
    expect(
      await h.send({ type: "context", windowId: 1, allowPrivate: true }),
    ).toMatchObject({ url: "https://example.test/" });
    await expect(
      h.send({ type: "capture", page: h.page(), mode: "auto" }),
    ).rejects.toMatchObject({ code: "action" });
  });

  it("captures only the current supported page and cancels capture after a source switch", async () => {
    const h = harness();
    await h.connect();
    expect(
      await h.send({ type: "capture", page: h.page(), mode: "auto" }),
    ).toMatchObject({ html: "<p>Synthetic</p>" });
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.api.scripting.executeScript.mockImplementationOnce(async () => {
      entered();
      await wait;
      return [
        {
          result: {
            url: h.page().url,
            title: h.page().title,
            html: "Old source",
            truncated: false,
          },
        },
      ];
    });
    const capture = h.send({ type: "capture", page: h.page(), mode: "page" });
    await started;
    const other = markdownFixture({ "other.md": "Other" });
    h.files.handles.set("browser-other", other.root);
    await h.send({ type: "connect-source", bindingId: "browser-other" });
    release();
    await expect(capture).rejects.toMatchObject({ code: "source" });
  });

  it("prevents a stale write after the source was switched", async () => {
    const h = harness({ "aic.md": "Original" });
    await h.connect();
    const saved = await note(h);
    const other = markdownFixture();
    h.files.handles.set("browser-other", other.root);
    await h.send({ type: "connect-source", bindingId: "browser-other" });
    await expect(
      h.send({
        type: "save",
        id: saved.id,
        revision: saved.revision,
        markdown: "Stale",
      }),
    ).rejects.toMatchObject({ code: "source" });
    expect(h.files.text("aic.md")).toBe("Original");
    expect(other.text("aic.md")).toBe("");
  });

  it("retains plain draft recovery during an in-flight file write and source permission loss", async () => {
    const h = harness({ "note.md": "Original" }, "note.md");
    await h.connect();
    const saved = await note(h);
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.files.entries.get("note.md")!.beforeClose = async () => {
      entered();
      await wait;
    };
    const saving = h.send({
      type: "save",
      id: saved.id,
      revision: saved.revision,
      markdown: "Earlier",
    });
    await started;
    await h.send({
      type: "checkpoint-drafts",
      clientId: "panel",
      sequence: 1,
      entries: [
        {
          scope: "current",
          key: saved.id,
          context: { url: `file:${saved.id}`, title: saved.filePath },
          record: {
            id: saved.id,
            revision: saved.revision,
            markdown: saved.markdown,
          },
          text: "Latest unsaved text",
        },
      ],
    });
    release();
    await saving;
    h.files.state.allowed = false;
    h.restart();
    expect(await h.send({ type: "status" })).toMatchObject({
      state: "unavailable",
    });
    expect(await h.send({ type: "list-recovery" })).toMatchObject([
      { entries: [{ text: "Latest unsaved text" }] },
    ]);
    expect(h.files.text("note.md")).toBe("Earlier");
  });

  it("reports read-only grants before a save and restores editing after a trusted reconnect across worker restart", async () => {
    const h = harness({ "aic.md": "Original" });
    let writable = true;
    h.files.root.queryPermission = async ({ mode }) =>
      mode === "read" || writable ? "granted" : "prompt";
    h.files.root.requestPermission = async () => {
      writable = true;
      return "granted";
    };
    await h.connect();
    const original = await note(h);
    writable = false;
    h.restart();
    expect(await h.send({ type: "status" })).toMatchObject({
      state: "ready",
      access: { read: "granted", write: "prompt" },
      sourceErrorCode: "permission",
    });
    expect((await note(h)).markdown).toBe("Original");
    await expect(
      h.send({
        type: "save",
        id: original.id,
        revision: original.revision,
        markdown: "New draft",
      }),
    ).rejects.toMatchObject({ code: "permission" });
    expect(h.files.text("aic.md")).toBe("Original");
    const { BrowserSourceAccess } =
      await import("../src/browser/markdown-storage");
    const access = new BrowserSourceAccess(h.files.bindings);
    await access.warm("browser-test");
    await access.reconnect("browser-test");
    expect(await h.send({ type: "status" })).toMatchObject({
      state: "ready",
      access: { read: "granted", write: "granted" },
    });
    await h.send({
      type: "save",
      id: original.id,
      revision: original.revision,
      markdown: "New draft",
    });
    expect(h.files.text("aic.md")).toBe("New draft");
  });

  it("restores a remembered source after restart without an automatic permission prompt", async () => {
    const h = harness({ "aic.md": "Saved on disk" });
    await h.connect();
    const originalSource = structuredClone(h.local[FILE_SOURCE_KEY]);
    const request = vi.spyOn(h.files.root, "requestPermission");
    h.files.state.allowed = false;
    h.files.root.queryPermission = async () =>
      h.files.state.allowed ? "granted" : "prompt";
    h.restart();
    h.api.storage.local.set.mockClear();
    expect(await h.send({ type: "status" })).toMatchObject({
      state: "unavailable",
      source: originalSource,
      access: { read: "prompt", write: "prompt" },
      sourceErrorCode: "permission",
    });
    expect(request).not.toHaveBeenCalled();
    expect(h.api.storage.local.set).not.toHaveBeenCalled();
    expect(h.local[FILE_SOURCE_KEY]).toEqual(originalSource);

    const { BrowserSourceAccess } =
      await import("../src/browser/markdown-storage");
    const access = new BrowserSourceAccess(h.files.bindings);
    await access.warm("browser-test");
    // A visible editor tab may grant access while the original side panel waits.
    const reconnect = access.reconnect("browser-test");
    expect(request).toHaveBeenCalledExactlyOnceWith({ mode: "readwrite" });
    await reconnect;
    expect(await h.send({ type: "status" })).toMatchObject({
      state: "ready",
      source: originalSource,
      access: { read: "granted", write: "granted" },
    });
    expect((await note(h)).markdown).toBe("Saved on disk");
    expect(h.local[FILE_SOURCE_KEY]).toEqual(originalSource);
  });
});
