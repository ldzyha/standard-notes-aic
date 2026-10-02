import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserApi, Request } from "../src/browser/api";
import type { BrowserLibrary, BrowserNote } from "../src/browser/library";
import {
  BrowserSourceAccess,
  chooseBrowserSource,
  FILE_SOURCE_KEY,
  type BrowserStatus,
} from "../src/browser/markdown-storage";
import { BrowserPanel } from "../src/browser/panel";

vi.mock("../src/browser/markdown-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/browser/markdown-storage")>()),
  chooseBrowserSource: vi.fn(),
}));

function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => unknown>();
  return {
    addListener: (callback: (...args: T) => unknown) => listeners.add(callback),
    removeListener: (callback: (...args: T) => unknown) =>
      listeners.delete(callback),
    emit: (...args: T) => {
      for (const callback of listeners) callback(...args);
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const note = (id: string): BrowserNote => ({
  id,
  url: "",
  title: `${id}.md`,
  filePath: `${id}.md`,
  markdown: `${id} saved text`,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
});

function fixture(
  initial: Partial<BrowserStatus> = {},
  delayFollowUpStatus?: () => Promise<void>,
) {
  let status: BrowserStatus = {
    state: "ready",
    source: { id: "browser-first", kind: "file", name: "first.md" },
    access: { read: "granted", write: "granted" },
    ...initial,
  };
  const library: BrowserLibrary = {
    version: 3,
    global: null,
    domains: [],
    notes: [note("first")],
    history: [],
  };
  let failSaves = false;
  let delaySave: (() => Promise<void>) | undefined;
  let statusRequests = 0;
  const changed = event<[Record<string, unknown>, string]>();
  const messages: Request[] = [];
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        messages.push(message);
        switch (message.type) {
          case "status":
            if (++statusRequests > 1) await delayFollowUpStatus?.();
            return { ok: true, value: structuredClone(status) };
          case "scan-status":
            return { ok: true, value: { scan: null, notes: [], next: 0 } };
          case "context":
            return {
              ok: true,
              value: {
                tabId: 7,
                windowId: 2,
                title: "Active page",
                url: "https://example.test/",
              },
            };
          case "load":
          case "visit":
            return { ok: true, value: structuredClone(library) };
          case "list-recovery":
            return { ok: true, value: [] };
          case "checkpoint-drafts":
            return { ok: true, value: { sequence: message.sequence } };
          case "save": {
            await delaySave?.();
            if (failSaves)
              return {
                ok: false,
                code: "permission",
                error: "File editing was not allowed. Your draft is unchanged.",
              };
            const existing = library.notes.find(
              (entry) => entry.id === message.id,
            );
            if (!existing || message.sourceId !== status.source.id)
              return {
                ok: false,
                code: "source",
                error: "The selected files changed.",
              };
            Object.assign(existing, {
              markdown: message.markdown,
              revision: message.revision + 1,
            });
            return { ok: true, value: structuredClone(existing) };
          }
          case "connect-source":
            status = {
              state: "ready",
              source: {
                id: message.bindingId,
                kind: "file",
                name: "second.md",
              },
              access: { read: "granted", write: "granted" },
            };
            library.notes = [note("second")];
            return { ok: true, value: structuredClone(status) };
          default:
            throw new Error(`Unexpected request: ${message.type}`);
        }
      },
    },
    windows: { getCurrent: async () => ({ id: 2, incognito: false }) },
    storage: { onChanged: changed },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event() },
  } as unknown as BrowserApi;
  return {
    api,
    messages,
    library,
    setFailSaves: (value: boolean) => {
      failSaves = value;
    },
    setSaveDelay: (value: () => Promise<void>) => {
      delaySave = value;
    },
    setStatus: (value: Partial<BrowserStatus>) => {
      status = { ...status, ...value };
    },
    refresh: () => changed.emit({ "aic-browser-markdown-change": {} }, "local"),
    switchSource: () => {
      status = {
        state: "ready",
        source: { id: "browser-second", kind: "file", name: "second.md" },
        access: { read: "granted", write: "granted" },
      };
      library.notes = [note("second")];
      changed.emit({ [FILE_SOURCE_KEY]: { newValue: status.source } }, "local");
    },
  };
}

const panels: BrowserPanel[] = [];
function mount(api: BrowserApi) {
  const root = document.createElement("div");
  document.body.append(root);
  const panel = new BrowserPanel(root, api);
  panels.push(panel);
  return { root, panel };
}

function reconnect(root: HTMLElement) {
  const visibleButton = () =>
    [
      ...root.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Reconnect access"], button[aria-label="Continue"]',
      ),
    ].find((button) => !button.closest("[hidden]"));
  if (!visibleButton())
    root
      .querySelector<HTMLButtonElement>('button[aria-label="More options"]')!
      .click();
  return visibleButton()!;
}

function editor(root: HTMLElement) {
  return EditorView.findFromDOM(
    root.querySelector<HTMLElement>(".cm-editor")!,
  )!;
}

beforeEach(() => {
  vi.mocked(chooseBrowserSource).mockReset();
  vi.spyOn(BrowserSourceAccess.prototype, "warm").mockResolvedValue();
  vi.spyOn(BrowserSourceAccess.prototype, "has").mockReturnValue(true);
  vi.spyOn(BrowserSourceAccess.prototype, "reconnect").mockResolvedValue();
});
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("browser panel file access recovery", () => {
  it("retains the chosen candidate until old drafts finish saving despite background access warming", async () => {
    const picker = deferred();
    const saved = deferred();
    vi.mocked(chooseBrowserSource).mockImplementation(async () => {
      await picker.promise;
      return "browser-second";
    });
    const selected = vi.spyOn(BrowserSourceAccess.prototype, "select");
    const fake = fixture();
    fake.setSaveDelay(() => saved.promise);
    const { root, panel } = mount(fake.api);
    await panel.ready;
    selected.mockClear();
    const view = editor(root);
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "Save the old file before switching",
      },
    });
    root
      .querySelector<HTMLButtonElement>('button[aria-label="More options"]')!
      .click();
    root
      .querySelector<HTMLButtonElement>('button[aria-label="Open file…"]')!
      .click();
    expect(chooseBrowserSource).toHaveBeenCalledWith(
      "file",
      undefined,
      expect.any(BrowserSourceAccess),
    );

    // A background status must not prune candidate handles while the picker is pending.
    fake.refresh();
    await vi.waitFor(() =>
      expect(
        vi.mocked(BrowserSourceAccess.prototype.warm).mock.calls.length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(selected).not.toHaveBeenCalled();
    picker.resolve();
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "save")).toBe(
        true,
      ),
    );

    // The same protection must cover the old draft's still-pending disk ACK.
    fake.refresh();
    await vi.waitFor(() =>
      expect(
        vi.mocked(BrowserSourceAccess.prototype.warm).mock.calls.length,
      ).toBeGreaterThanOrEqual(3),
    );
    expect(selected).not.toHaveBeenCalled();
    expect(editor(root)).toBe(view);
    expect(
      fake.messages.some((message) => message.type === "connect-source"),
    ).toBe(false);

    saved.resolve();
    await vi.waitFor(() =>
      expect(editor(root).state.doc.toString()).toBe("second saved text"),
    );
    await vi.waitFor(() =>
      expect(selected).toHaveBeenLastCalledWith("browser-second"),
    );
    expect(selected).not.toHaveBeenCalledWith("browser-first");
    expect(
      fake.messages.filter((message) => message.type === "save"),
    ).toMatchObject([
      {
        id: "first",
        sourceId: "browser-first",
        markdown: "Save the old file before switching",
      },
    ]);
  });

  it.each(["unavailable", "ready"] as const)(
    "does not claim restored access when follow-up status is %s without write permission",
    async (state) => {
      const fake = fixture({
        state,
        sourceErrorCode: "permission",
        sourceError: "File access is still unavailable.",
        access: { read: "granted", write: "prompt" },
      });
      const { root, panel } = mount(fake.api);
      await panel.ready;
      const requests = fake.messages.filter(
        (message) => message.type === "status",
      ).length;
      reconnect(root).click();
      expect(BrowserSourceAccess.prototype.reconnect).toHaveBeenCalledWith(
        "browser-first",
      );
      await vi.waitFor(() =>
        expect(
          fake.messages.filter((message) => message.type === "status").length,
        ).toBeGreaterThan(requests),
      );
      await vi.waitFor(() =>
        expect(root.querySelector(".browser-feedback")!.textContent).toContain(
          "File access is still unavailable.",
        ),
      );
      expect(root.textContent).not.toContain("File access restored.");
      expect(reconnect(root).disabled).toBe(false);
      expect(fake.messages.some((message) => message.type === "save")).toBe(
        false,
      );
    },
  );

  it("ignores permission completion after the panel is disposed", async () => {
    const pending = deferred();
    vi.mocked(BrowserSourceAccess.prototype.reconnect).mockReturnValue(
      pending.promise,
    );
    const fake = fixture({
      access: { read: "granted", write: "prompt" },
      sourceErrorCode: "permission",
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    reconnect(root).click();
    expect(BrowserSourceAccess.prototype.reconnect).toHaveBeenCalledTimes(1);
    panel.destroy();
    const requests = fake.messages.length;
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.messages).toHaveLength(requests);
    expect(root.childElementCount).toBe(0);
  });

  it("does not flush a different source's draft when an old permission request completes", async () => {
    const pending = deferred();
    vi.mocked(BrowserSourceAccess.prototype.reconnect).mockReturnValue(
      pending.promise,
    );
    const fake = fixture({
      access: { read: "granted", write: "prompt" },
      sourceErrorCode: "permission",
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    reconnect(root).click();
    fake.switchSource();
    await vi.waitFor(() =>
      expect(editor(root).state.doc.toString()).toBe("second saved text"),
    );
    const view = editor(root);
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "Second pending draft",
      },
      selection: { anchor: 6 },
    });
    const requests = fake.messages.length;
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      fake.messages
        .slice(requests)
        .filter((message) => ["save", "status"].includes(message.type)),
    ).toEqual([]);
    expect(editor(root)).toBe(view);
    expect(view.state.doc.toString()).toBe("Second pending draft");
    expect(view.state.selection.main.anchor).toBe(6);
    expect(root.textContent).not.toContain("File access restored.");
    expect(fake.library.notes[0]?.markdown).toBe("second saved text");
  });

  it("retries a failed draft after the trusted reconnect click while retaining its editor and selection", async () => {
    const pending = deferred();
    vi.mocked(BrowserSourceAccess.prototype.reconnect).mockReturnValue(
      pending.promise,
    );
    const fake = fixture();
    fake.setFailSaves(true);
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const view = editor(root);
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "Draft retained after denied access",
      },
      selection: { anchor: 8 },
    });
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "save")).toBe(
        true,
      ),
    );
    await vi.waitFor(() =>
      expect(
        root.querySelector(".browser-file-location")!.textContent,
      ).toContain("Reconnect access"),
    );
    const reconnectTarget = reconnect(root);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " and another edit" },
      selection: { anchor: 8 },
    });
    reconnectTarget.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(
        fake.messages.filter((message) => message.type === "save"),
      ).toHaveLength(2),
    );
    expect(reconnect(root)).toBe(reconnectTarget);
    expect(reconnectTarget.isConnected).toBe(true);
    expect(reconnectTarget.hidden).toBe(false);
    reconnectTarget.click();
    expect(BrowserSourceAccess.prototype.reconnect).toHaveBeenCalledWith(
      "browser-first",
    );
    expect(editor(root)).toBe(view);
    expect(view.state.doc.toString()).toBe(
      "Draft retained after denied access and another edit",
    );
    expect(view.state.selection.main.anchor).toBe(8);
    expect(fake.library.notes[0]?.markdown).toBe("first saved text");
    fake.setFailSaves(false);
    pending.resolve();
    await vi.waitFor(() =>
      expect(fake.library.notes[0]?.markdown).toBe(
        "Draft retained after denied access and another edit",
      ),
    );
    await vi.waitFor(() =>
      expect(root.textContent).toContain("File access restored."),
    );
    expect(editor(root)).toBe(view);
    expect(view.state.selection.main.anchor).toBe(8);
    expect(root.querySelector(".browser-file-location")!.textContent).toContain(
      "first.mdOn disk",
    );
    expect(
      fake.messages.filter((message) => message.type === "save"),
    ).toHaveLength(3);
    expect(
      fake.messages
        .filter((message) => message.type === "save")
        .every((message) => message.sourceId === "browser-first"),
    ).toBe(true);
  });

  it("does not adopt a delayed background status for another source while an old draft is pending", async () => {
    const pending = deferred();
    const fake = fixture({}, () => pending.promise);
    const { root, panel } = mount(fake.api);
    await panel.ready;
    fake.refresh();
    await vi.waitFor(() =>
      expect(
        fake.messages.filter((message) => message.type === "status"),
      ).toHaveLength(2),
    );
    const view = editor(root);
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "Keep this first-file draft",
      },
      selection: { anchor: 9 },
    });
    fake.switchSource();
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor(root)).toBe(view);
    expect(view.state.doc.toString()).toBe("Keep this first-file draft");
    expect(view.state.selection.main.anchor).toBe(9);
    expect(
      root.querySelector<HTMLElement>(
        ".browser-file-location .aic-context__path",
      )!.title,
    ).toContain("first.md");
    await vi.waitFor(() =>
      expect(fake.messages.some((message) => message.type === "save")).toBe(
        true,
      ),
    );
    expect(
      fake.messages
        .filter((message) => message.type === "save")
        .every((message) => message.sourceId === "browser-first"),
    ).toBe(true);
    expect(fake.library.notes[0]?.markdown).toBe("second saved text");
    expect(view.state.doc.toString()).toBe("Keep this first-file draft");
    expect(root.textContent).not.toContain("File access restored.");
  });
});
