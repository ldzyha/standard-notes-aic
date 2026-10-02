import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBrowserService } from "../src/browser/service";
import { FILE_SOURCE_KEY } from "../src/browser/markdown-storage";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import type { BrowserLibrary, BrowserNote } from "../src/browser/library";
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
      update: vi.fn(async () => ({})),
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

async function note(h: ReturnType<typeof harness>, markdown = "Page note") {
  return (await h.send({
    type: "create",
    page: h.page(),
    markdown,
  })) as BrowserNote;
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
      source: { kind: "directory", id: "browser-test" },
    });
    expect(
      ((await h.send({ type: "load" })) as BrowserLibrary).notes[0],
    ).toMatchObject({
      url: "",
      filePath: "plain.md",
      markdown: "# Existing Markdown",
    });
    expect(h.local["aic-browser-library"]).toEqual({ old: "untouched" });
    expect(h.local[FILE_SOURCE_KEY]).toMatchObject({ kind: "directory" });
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

  it("saves Current, Shared and Global as individual Markdown files with portable scope links", async () => {
    const h = harness();
    await h.connect();
    const pageNote = await note(h);
    const shared = (await h.send({
      type: "create-domain",
      page: h.page(),
      markdown: "```aic\nShared | value\n```",
    })) as BrowserNote;
    const global = (await h.send({
      type: "create-global",
      markdown: "```aic\nGlobal | value\n```",
    })) as BrowserNote;
    expect(h.files.text(pageNote.filePath!)).toBe("Page note");
    expect(h.files.text(shared.filePath!)).toContain("Shared | value");
    expect(h.files.text(global.filePath!)).toContain("Global | value");
    expect(h.files.text(".aic/links.json")).toContain(h.page().url);
    expect(h.files.text(".aic/links.json")).not.toContain("Page note");
    h.restart();
    const restored = (await h.send({ type: "load" })) as BrowserLibrary;
    expect(restored.notes[0]).toEqual(pageNote);
    expect(restored.domains[0]).toEqual(shared);
    expect(restored.global).toEqual(global);
  });

  it("acknowledges current single-file revisions for consecutive edits and rejects external changes", async () => {
    const h = harness({ "note.md": "Original" }, "note.md");
    await h.connect();
    let current = ((await h.send({ type: "load" })) as BrowserLibrary)
      .notes[0]!;
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

  it("creates an unassociated Markdown file and links it without replacing its body", async () => {
    const h = harness();
    await h.connect();
    const created = (await h.send({
      type: "create-file",
      path: "project/design.md",
      markdown: "# Design",
    })) as BrowserNote;
    expect(created).toMatchObject({ url: "", filePath: "project/design.md" });
    const writes = h.files.entries.get(created.filePath!)!.closes;
    const linked = (await h.send({
      type: "link-file",
      id: created.id,
      page: h.page(),
    })) as BrowserNote;
    expect(linked.url).toBe(h.page().url);
    expect(h.files.entries.get(created.filePath!)!.closes).toBe(writes);
    await expect(
      h.send({ type: "create-file", path: "../outside.md", markdown: "Bad" }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("unlinks a page while preserving its original Markdown file", async () => {
    const h = harness();
    await h.connect();
    const original = await note(h);
    await h.send({
      type: "delete-page",
      url: original.url,
      expectedNote: { id: original.id, revision: original.revision },
    });
    expect(h.files.text(original.filePath!)).toBe(original.markdown);
    expect(
      ((await h.send({ type: "load" })) as BrowserLibrary).notes,
    ).toMatchObject([
      { url: "", filePath: original.filePath, markdown: original.markdown },
    ]);
    expect(h.api.tabs.create).not.toHaveBeenCalled();
    expect(h.api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("does not remember unnoted page visits or write note files on navigation", async () => {
    const h = harness();
    await h.connect();
    expect(await h.send({ type: "visit", windowId: 1 })).toMatchObject({
      notes: [],
      history: [],
    });
    await expect(
      h.send({ type: "navigate", windowId: 1, url: h.page().url }),
    ).rejects.toMatchObject({ code: "action" });
    const saved = await note(h);
    const writes = h.files.entries.get(saved.filePath!)!.closes;
    await h.send({ type: "visit", windowId: 1 });
    await h.send({ type: "navigate", windowId: 1, url: saved.url });
    expect(h.api.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(h.files.entries.get(saved.filePath!)!.closes).toBe(writes);
  });

  it("keeps Current creation bound to the intended tab and guards private windows", async () => {
    const h = harness();
    await h.connect();
    const old = h.page();
    h.change({ url: "https://changed.test/" });
    await expect(
      h.send({ type: "create", page: old, markdown: "No" }),
    ).rejects.toMatchObject({ code: "action" });
    h.change({ incognito: true });
    expect(await h.send({ type: "context", windowId: 1 })).toBeNull();
    await expect(
      h.send({ type: "create", page: h.page(), markdown: "No" }),
    ).rejects.toMatchObject({ code: "action" });
    const saved = (await h.send({
      type: "create",
      page: h.page(),
      markdown: "Explicit",
      allowPrivate: true,
    })) as BrowserNote;
    await expect(
      h.send({ type: "navigate", windowId: 1, url: saved.url }),
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

  it("serializes concurrent first imports and prevents stale source writes", async () => {
    const h = harness();
    await h.connect();
    await Promise.all(
      ["First", "Second"].map((markdown) =>
        h.send({ type: "create", page: h.page(), markdown }),
      ),
    );
    const saved = ((await h.send({ type: "load" })) as BrowserLibrary)
      .notes[0]!;
    expect(saved.markdown).toBe("First\n\nSecond");
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
    expect(h.files.text(saved.filePath!)).toBe("First\n\nSecond");
  });

  it("retains plain draft recovery during an in-flight file write and source permission loss", async () => {
    const h = harness({ "note.md": "Original" }, "note.md");
    await h.connect();
    const saved = ((await h.send({ type: "load" })) as BrowserLibrary)
      .notes[0]!;
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
          context: { url: `file:${saved.id}`, title: saved.title },
          record: saved,
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
    const h = harness({ "note.md": "Original" });
    let writable = true;
    h.files.root.queryPermission = async ({ mode }) =>
      mode === "read" || writable ? "granted" : "prompt";
    h.files.root.requestPermission = async () => {
      writable = true;
      return "granted";
    };
    await h.connect();
    const original = ((await h.send({ type: "load" })) as BrowserLibrary)
      .notes[0]!;
    writable = false;
    h.restart();
    expect(await h.send({ type: "status" })).toMatchObject({
      state: "ready",
      access: { read: "granted", write: "prompt" },
      sourceErrorCode: "permission",
    });
    expect(
      ((await h.send({ type: "load" })) as BrowserLibrary).notes[0]!.markdown,
    ).toBe("Original");
    await expect(
      h.send({
        type: "save",
        id: original.id,
        revision: original.revision,
        markdown: "New draft",
      }),
    ).rejects.toMatchObject({ code: "permission" });
    expect(h.files.text("note.md")).toBe("Original");
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
    expect(h.files.text("note.md")).toBe("New draft");
  });

  it("restores a remembered source after restart without a failed scan or automatic permission prompt", async () => {
    const h = harness({ "note.md": "Saved on disk" });
    await h.connect();
    const originalSource = structuredClone(h.local[FILE_SOURCE_KEY]);
    const request = vi.spyOn(h.files.root, "requestPermission");
    h.files.state.allowed = false;
    h.files.root.queryPermission = async () =>
      h.files.state.allowed ? "granted" : "prompt";
    h.restart();
    const scanCount = h.files.state.scans;
    h.api.storage.local.set.mockClear();
    expect(await h.send({ type: "status" })).toMatchObject({
      state: "unavailable",
      source: originalSource,
      access: { read: "prompt", write: "prompt" },
      sourceErrorCode: "permission",
    });
    expect(await h.send({ type: "scan-status" })).toEqual({
      scan: null,
      notes: [],
      next: 0,
    });
    expect(h.files.state.scans).toBe(scanCount);
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
    expect(
      ((await h.send({ type: "load" })) as BrowserLibrary).notes[0]!.markdown,
    ).toBe("Saved on disk");
    expect(h.local[FILE_SOURCE_KEY]).toEqual(originalSource);
  });

  it("allows explicit recreation of a confirmed deleted Global file without resurrecting it during autosave", async () => {
    const h = harness();
    await h.connect();
    const global = (await h.send({
      type: "create-global",
      markdown: "```aic\nValue | old\n```",
    })) as BrowserNote;
    h.files.remove("global.md");
    await expect(
      h.send({
        type: "save-global",
        id: global.id,
        revision: global.revision,
        markdown: "",
      }),
    ).rejects.toBeDefined();
    expect(h.files.text("global.md")).toBeUndefined();
    await h.send({ type: "refresh-files" });
    expect(
      ((await h.send({ type: "load" })) as BrowserLibrary).global,
    ).toBeNull();
    await h.send({
      type: "create-global",
      markdown: "```aic\nValue | new\n```",
    });
    expect(h.files.text("global.md")).toContain("Value | new");
  });
});
