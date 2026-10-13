import { EditorView } from "@codemirror/view";
import { focusedPage } from "../src/core/note-page-cards.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserApi, Request } from "../src/browser/api";
import type { BrowserNote } from "../src/browser/library";
import {
  FILE_SOURCE_KEY,
  IndexedDbBrowserSources,
} from "../src/browser/markdown-storage";
import { BrowserPanel } from "../src/browser/panel";
import { RECOVERY_KEY } from "../src/browser/recovery-store";
import { createBrowserService } from "../src/browser/service";
import { markdownFixture } from "./helpers/browser-markdown-fixture";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
const PROJECT = "https://example.test/project";
const OTHER = "https://example.test/other";

function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => unknown>();
  return {
    addListener: (listener: (...args: T) => unknown) => listeners.add(listener),
    removeListener: (listener: (...args: T) => unknown) =>
      listeners.delete(listener),
    emit: (...args: T) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

function harness(initial: Record<string, string> = {}) {
  const files = markdownFixture(initial);
  const scans = vi.spyOn(files.root, "values");
  const grant = vi.spyOn(files.root, "requestPermission");
  vi.spyOn(IndexedDbBrowserSources.prototype, "read").mockImplementation(
    files.bindings.read,
  );
  vi.spyOn(IndexedDbBrowserSources.prototype, "write").mockImplementation(
    files.bindings.write,
  );
  const picker = vi.fn(async () => files.root);
  vi.stubGlobal("showDirectoryPicker", picker);
  const local: Record<string, unknown> = {};
  const changed = event<[Record<string, unknown>, string]>();
  const activated = event<[{ tabId: number; windowId: number }]>();
  const page = {
    id: 7,
    windowId: 2,
    url: PROJECT,
    title: "Synthetic project",
    active: true,
  };
  let service: ReturnType<typeof createBrowserService>;
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        try {
          const value = await service.handle(message);
          return { ok: true, value };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code:
              error && typeof error === "object" && "code" in error
                ? error.code
                : "storage",
          };
        }
      },
    },
    windows: { getCurrent: async () => ({ id: 2, incognito: false }) },
    storage: {
      local: {
        get: async () => structuredClone(local),
        set: async (values: Record<string, unknown>) => {
          const updates = Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
              key,
              { oldValue: local[key], newValue: value },
            ]),
          );
          Object.assign(local, structuredClone(values));
          changed.emit(updates, "local");
        },
        setAccessLevel: async () => {},
      },
      onChanged: changed,
    },
    tabs: {
      query: async () => [page],
      onActivated: activated,
      onUpdated: event(),
      onRemoved: event(),
    },
  } as unknown as BrowserApi;
  service = createBrowserService(api, files.bindings);
  return {
    files,
    local,
    api,
    picker,
    grant,
    scans,
    restart: () => {
      service = createBrowserService(api, files.bindings);
    },
    note: () =>
      service.handle({
        type: "load",
        sourceId: (local[FILE_SOURCE_KEY] as { id: string }).id,
      }) as Promise<BrowserNote>,
    /** Switch the active tab of the panel's window. */
    go: (url: string, id = page.id + 1) => {
      Object.assign(page, { url, id });
      activated.emit({ tabId: id, windowId: 2 });
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
function button(root: HTMLElement, label: string) {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.getAttribute("aria-label") === label && !item.closest("[hidden]"),
  );
  expect(found, `Visible ${label} button`).toBeDefined();
  return found!;
}
function currentEditor(root: HTMLElement) {
  const element = root.querySelector<HTMLElement>(".browser-note .cm-editor");
  expect(element, "Note editor").not.toBeNull();
  return EditorView.findFromDOM(element!)!;
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function open(h: ReturnType<typeof harness>) {
  const mounted = mount(h.api);
  await mounted.panel.ready;
  button(mounted.root, "Open folder").click();
  await vi.waitFor(() =>
    expect(
      mounted.root.querySelector(".browser-note .cm-editor"),
    ).not.toBeNull(),
  );
  const view = currentEditor(mounted.root);
  await shows(view, PROJECT);
  return { ...mounted, view };
}
/** Wait until the panel shows the page of `target` (null: the whole note). */
function shows(view: EditorView, target: string | null) {
  return vi.waitFor(() =>
    expect(focusedPage(view.state)?.target ?? null).toBe(target),
  );
}
function pageText(view: EditorView) {
  const page = focusedPage(view.state)!;
  return view.state.sliceDoc(page.from, page.to);
}
function type(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: view.state.selection.main.head, insert: text },
    selection: { anchor: view.state.selection.main.head + text.length },
    userEvent: "input.type",
  });
}
const legacyFolder = () => ({
  "pages/page-1.md": "# Earlier page note\n",
  "shared/shared-1.md": "Shared\r\nnote",
  "global.md": "\uFEFFGlobal",
  "project/readme.md": "# Other Markdown\n",
  ".aic/links.json": JSON.stringify({
    format: "aic-markdown-links",
    version: 1,
    entries: [
      {
        id: "page-1",
        path: "pages/page-1.md",
        scope: "current",
        url: PROJECT,
        title: "Synthetic project",
        createdAt: 1,
        updatedAt: 2,
        revision: 3,
        fingerprint: "0".repeat(64),
      },
    ],
  }),
  ".aic/links.pending.json": JSON.stringify({
    format: "aic-links-pending",
    version: 1,
    baseText: "an index that is no longer on disk",
    nextText: "{}",
    writes: [{ path: "pages/page-1.md", fingerprint: "1".repeat(64) }],
  }),
  ".aic/write.lock": "",
});

describe("one note file, one page per tab", () => {
  it("connects a folder of earlier page notes, focuses aic.md on the tab and leaves every earlier file byte-identical", async () => {
    const h = harness(legacyFolder());
    const before = structuredClone([...h.files.entries]);
    await h.files
      .file(".aic/write.lock")
      .createWritable({ keepExistingData: true, mode: "exclusive" });
    const { root, view } = await open(h);
    // The earlier note for this URL is not shown: the page is an empty card.
    expect(view.state.doc.toString()).toBe("");
    expect(focusedPage(view.state)).toMatchObject({ exists: false });
    expect(root.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(
      root.querySelector(".aic-card--page .aic-card__title")?.textContent,
    ).toBe(PROJECT);
    expect(
      root.querySelector(".browser-file-location .aic-context__path")!
        .textContent,
    ).toBe("notes/aic.md");
    // Connecting and viewing create nothing.
    expect([...h.files.entries]).toEqual(before);
    type(view, "First note");
    await vi.waitFor(() =>
      expect(h.files.text("aic.md")).toBe(`--- ${PROJECT}\nFirst note`),
    );
    type(view, ", continued");
    await vi.waitFor(() =>
      expect(h.files.text("aic.md")).toBe(
        `--- ${PROJECT}\nFirst note, continued`,
      ),
    );
    expect([...h.files.entries].filter(([path]) => path !== "aic.md")).toEqual(
      before,
    );
    expect(h.scans).not.toHaveBeenCalled();
    button(root, "More options").click();
    const menu = root.querySelector<HTMLElement>(".browser-overlay")!;
    expect(menu.textContent).toContain(
      "Earlier page notes stay in this folder as Markdown files.",
    );
    expect(
      [...menu.querySelectorAll("button")].map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Import current content",
      "Insert from Markdown file",
      "Download page",
      "AIC guide",
      "Open file…",
      "Open folder…",
      "Download note file",
      "Terms and privacy",
      "Releases and installation",
      "How to create documents",
    ]);
  });

  it("adopts an existing aic.md as is and appends a page only on the first edit for a new URL", async () => {
    const existing = `---\r\ntitle: Mine\r\n---\r\n\r\nIntro\r\n\r\n--- ${PROJECT}\r\nProject page\r\n`;
    const h = harness({ "aic.md": existing });
    const { view } = await open(h);
    expect(pageText(view)).toBe("Project page\n");
    h.go(OTHER);
    await shows(view, OTHER);
    expect(focusedPage(view.state)).toMatchObject({ exists: false });
    h.go(PROJECT);
    await shows(view, PROJECT);
    // Viewing pages, including one that does not exist, writes nothing.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(h.files.text("aic.md")).toBe(existing);
    expect(h.files.entries.get("aic.md")).toMatchObject({ writes: 0 });
    h.go(OTHER);
    await shows(view, OTHER);
    type(view, "Other page");
    await vi.waitFor(() =>
      expect(h.files.text("aic.md")).toBe(
        `${existing}\r\n--- ${OTHER}\r\nOther page`,
      ),
    );
  });

  it("keeps the editor, the document and an unsaved draft when the tab changes", async () => {
    const h = harness({ "aic.md": `--- ${PROJECT}\nProject page\n` });
    const { root, view } = await open(h);
    type(view, "Unsaved ");
    const text = view.state.doc.toString();
    h.go(OTHER);
    await shows(view, OTHER);
    expect(currentEditor(root)).toBe(view);
    expect(view.state.doc.toString()).toBe(text);
    expect(pageText(view)).toBe("");
    type(view, "Second");
    await vi.waitFor(() =>
      expect(h.files.text("aic.md")).toBe(
        `--- ${PROJECT}\nUnsaved Project page\n\n--- ${OTHER}\nSecond`,
      ),
    );
    h.go(PROJECT);
    await shows(view, PROJECT);
    expect(pageText(view)).toBe("Unsaved Project page");
    // A browser page without an http(s) URL shows the whole note as cards.
    h.go("chrome://extensions/");
    await shows(view, null);
    expect(currentEditor(root)).toBe(view);
    expect(root.querySelectorAll(".aic-card--page")).toHaveLength(2);
    button(root, "More options").click();
    const labels = [...root.querySelectorAll(".browser-overlay button")].map(
      (item) => item.getAttribute("aria-label"),
    );
    expect(labels).not.toContain("Import current content");
    expect(labels).not.toContain("Download page");
    expect(labels).toContain("Download note file");
  });

  it("takes in a change made on disk without losing the page, and never replaces an unsaved draft", async () => {
    const h = harness({ "aic.md": `--- ${PROJECT}\nProject page\n` });
    const { root, view } = await open(h);
    const external = `--- ${OTHER}\nAdded elsewhere\n\n--- ${PROJECT}\nEdited elsewhere\n`;
    h.files.put("aic.md", external);
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe(external));
    expect(currentEditor(root)).toBe(view);
    expect(focusedPage(view.state)?.target).toBe(PROJECT);
    expect(pageText(view)).toBe("Edited elsewhere\n");
    expect(h.files.entries.get("aic.md")).toMatchObject({ writes: 0 });

    vi.useFakeTimers();
    type(view, "Mine ");
    const draft = view.state.doc.toString();
    h.files.put("aic.md", "Changed again elsewhere\n");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    expect(view.state.doc.toString()).toBe(draft);
    expect(pageText(view)).toBe("Mine Edited elsewhere\n");
    expect(h.files.text("aic.md")).toBe("Changed again elsewhere\n");
    await vi.waitFor(() =>
      expect(root.querySelector(".browser-draft-error")?.textContent).toContain(
        "Another window may have changed this note",
      ),
    );
    button(
      root.querySelector<HTMLElement>(".browser-draft-error")!,
      "Export unsaved draft",
    );
  });

  it("reopens the note through one Continue action after permissions reset", async () => {
    const h = harness();
    const initial = await open(h);
    type(initial.view, "Kept");
    const saved = `--- ${PROJECT}\nKept`;
    await vi.waitFor(() => expect(h.files.text("aic.md")).toBe(saved));
    initial.panel.destroy();
    h.files.state.allowed = false;
    h.restart();
    const reopened = mount(h.api);
    await reopened.panel.ready;
    const gate = reopened.root.querySelector<HTMLElement>(
      ".browser-files-gate",
    )!;
    expect(
      [...gate.querySelectorAll("button")]
        .filter((item) => !item.hidden)
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Continue"]);
    h.grant.mockClear();
    await vi.waitFor(() =>
      expect(button(gate, "Continue").disabled).toBe(false),
    );
    button(gate, "Continue").click();
    expect(h.grant).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(currentEditor(reopened.root).state.doc.toString()).toBe(saved),
    );
    expect(h.picker).toHaveBeenCalledTimes(1);
    expect(h.scans).not.toHaveBeenCalled();
    expect(h.files.text("aic.md")).toBe(saved);
    expect(h.local[RECOVERY_KEY]).toBeDefined();
  });
});
