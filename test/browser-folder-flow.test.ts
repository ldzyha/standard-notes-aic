import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserApi, Request } from "../src/browser/api";
import type { BrowserLibrary } from "../src/browser/library";
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
const CURRENT =
  "# Current project\n\nOrdinary Markdown with **emphasis**.\n\n```aic\nStatus | Synthetic current field\n```\n";

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

function harness() {
  const files = markdownFixture();
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
    url: "https://example.test/project",
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
    library: () =>
      service.handle({
        type: "load",
        sourceId: (local[FILE_SOURCE_KEY] as { id: string }).id,
      }) as Promise<BrowserLibrary>,
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

describe("browser folder workflow across worker and browser restarts", () => {
  it("saves the page note into one folder and reopens it through one Continue action after permissions reset", async () => {
    const h = harness();
    const initial = mount(h.api);
    await initial.panel.ready;
    button(initial.root, "Open folder").click();
    await vi.waitFor(() =>
      expect(
        initial.root.querySelector(".browser-note .cm-editor"),
      ).not.toBeNull(),
    );
    const view = currentEditor(initial.root);
    view.dispatch({ changes: { from: 0, insert: CURRENT } });
    // One note per page: no scope tabs and no second editor.
    expect(initial.root.querySelector('[role="tab"]')).toBeNull();
    expect(initial.root.querySelectorAll(".cm-editor")).toHaveLength(1);
    await vi.waitFor(async () =>
      expect((await h.library()).notes[0]?.markdown).toBe(CURRENT),
    );
    const before = await h.library();
    expect(before).toEqual({
      version: 3,
      notes: [expect.objectContaining({ markdown: CURRENT })],
      history: before.history,
    });
    expect(h.files.text(before.notes[0]!.filePath!)).toBe(CURRENT);
    expect(before.notes[0]?.url).toBe("https://example.test/project");
    expect(
      [...h.files.entries.keys()].filter((path) => path.endsWith(".md")),
    ).toEqual([before.notes[0]!.filePath]);
    expect(h.files.text(".aic/links.json")).not.toContain(
      "Synthetic current field",
    );
    const originalBytes = new Map(
      [...h.files.entries]
        .filter(([path]) => path.endsWith(".md"))
        .map(([path, value]) => [path, value.text]),
    );
    const scans = h.scans.mock.calls.length;
    initial.panel.destroy();
    h.files.state.allowed = false;
    h.restart();
    let allowWarm!: () => void;
    const warming = new Promise<void>((resolve) => {
      allowWarm = resolve;
    });
    vi.mocked(IndexedDbBrowserSources.prototype.read).mockImplementationOnce(
      async (id) => {
        await warming;
        return h.files.bindings.read(id);
      },
    );
    const reopened = mount(h.api);
    await reopened.panel.ready;
    expect(h.scans).toHaveBeenCalledTimes(scans);
    const gate = reopened.root.querySelector<HTMLElement>(
      ".browser-files-gate",
    )!;
    expect(
      [...gate.querySelectorAll("button")]
        .filter((item) => !item.hidden)
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Continue"]);
    h.grant.mockClear();
    expect(button(gate, "Continue").disabled).toBe(true);
    button(gate, "Continue").click();
    expect(h.grant).not.toHaveBeenCalled();
    allowWarm();
    await vi.waitFor(() =>
      expect(button(gate, "Continue").disabled).toBe(false),
    );
    button(gate, "Continue").click();
    expect(h.grant).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(currentEditor(reopened.root).state.doc.toString()).toBe(CURRENT),
    );
    expect(h.scans).toHaveBeenCalledTimes(scans + 1);
    expect(h.picker).toHaveBeenCalledTimes(1);
    expect(
      reopened.root.querySelector<HTMLElement>(".browser-scan")!.hidden,
    ).toBe(true);
    const after = await h.library();
    expect(after.notes).toEqual(before.notes);
    expect(
      reopened.root.querySelector(".browser-file-location .aic-context__path")!
        .textContent,
    ).toContain(before.notes[0]!.filePath!);
    expect(h.scans).toHaveBeenCalledTimes(scans + 1);
    const blobs: Blob[] = [];
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL(blob: Blob) {
          blobs.push(blob);
          return "blob:synthetic-scope-download";
        }
        static override revokeObjectURL() {}
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    button(reopened.root, "More options").click();
    const menu = reopened.root.querySelector<HTMLElement>(".browser-overlay")!;
    button(menu, "Download copy").click();
    expect(blobs).toHaveLength(1);
    const downloaded = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blobs[0]!);
    });
    expect(downloaded).toBe(CURRENT);
    for (const [path, value] of originalBytes)
      expect(h.files.text(path)).toBe(value);
  });

  it("opens a folder holding retired Shared and Global files as ordinary notes and leaves them and their links intact", async () => {
    const h = harness();
    const sha = async (text: string) =>
      Array.from(
        new Uint8Array(
          await webcrypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(text),
          ),
        ),
        (n) => n.toString(16).padStart(2, "0"),
      ).join("");
    const shared = "# Shared project\n\nCommon project notes.\n";
    const global = "# Global notes\n\n- Reusable checklist\n";
    const legacy = [
      {
        id: "shared-1",
        path: "shared/shared-1.md",
        scope: "shared",
        origin: "https://example.test",
        createdAt: 3,
        updatedAt: 4,
        revision: 2,
        fingerprint: await sha(shared),
      },
      {
        id: "global-1",
        path: "global.md",
        scope: "global",
        createdAt: 5,
        updatedAt: 6,
        revision: 7,
        fingerprint: await sha(global),
      },
    ];
    h.files.put("shared/shared-1.md", shared);
    h.files.put("global.md", global);
    h.files.put(
      ".aic/links.json",
      JSON.stringify({
        format: "aic-markdown-links",
        version: 1,
        entries: legacy,
      }),
    );
    const { root, panel } = mount(h.api);
    await panel.ready;
    button(root, "Open folder").click();
    await vi.waitFor(() =>
      expect(root.querySelector(".browser-note .cm-editor")).not.toBeNull(),
    );
    // The page note is the only editor; the retired files are not shown as tabs.
    expect(root.querySelector('[role="tab"]')).toBeNull();
    expect(root.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(currentEditor(root).state.doc.toString()).toBe("");
    currentEditor(root).dispatch({ changes: { from: 0, insert: CURRENT } });
    await vi.waitFor(async () =>
      expect((await h.library()).notes).toHaveLength(3),
    );
    const retired = () =>
      (
        JSON.parse(h.files.text(".aic/links.json")!) as {
          entries: { id: string; scope: string }[];
        }
      ).entries
        .filter((entry) => entry.scope !== "current")
        .sort((a, b) => b.id.localeCompare(a.id));
    expect(retired()).toEqual(legacy);
    expect(h.files.text("shared/shared-1.md")).toBe(shared);
    expect(h.files.text("global.md")).toBe(global);
    // Opening a folder with files shows the existing file tree, where they
    // stay reachable as plain Markdown files.
    const file = [
      ...root.querySelectorAll<HTMLButtonElement>(".browser-overlay button"),
    ].find((item) => item.title === "global.md");
    expect(file).toBeDefined();
    expect(
      [
        ...root.querySelectorAll<HTMLButtonElement>(".browser-overlay button"),
      ].some((item) => item.title === "shared/shared-1.md"),
    ).toBe(true);
    file!.click();
    await vi.waitFor(() =>
      expect(currentEditor(root).state.doc.toString()).toBe(global),
    );
    expect(root.querySelector(".browser-page-title")?.textContent).toBe(
      "global.md",
    );
    expect(h.files.text("global.md")).toBe(global);
    expect(retired()).toEqual(legacy);
  });

  it.each(["reconnect", "focus"] as const)(
    "keeps the exact live draft and selection when %s restores a restarted worker's folder access",
    async (action) => {
      const h = harness();
      const { root, panel } = mount(h.api);
      await panel.ready;
      button(root, "Open folder").click();
      await vi.waitFor(() =>
        expect(root.querySelector(".browser-note .cm-editor")).not.toBeNull(),
      );
      const view = currentEditor(root);
      view.dispatch({ changes: { from: 0, insert: "Saved baseline" } });
      await vi.waitFor(() =>
        expect(
          [...h.files.entries].some(
            ([path, entry]) =>
              path.endsWith(".md") && entry.text === "Saved baseline",
          ),
        ).toBe(true),
      );
      const before = await h.library();
      const path = before.notes[0]!.filePath!;
      h.files.state.allowed = false;
      h.restart();
      const draft = "Exact pending draft\nSecond line\n";
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: draft },
        selection: { anchor: 7 },
      });
      await vi.waitFor(() =>
        expect(
          root.querySelector<HTMLButtonElement>(".browser-reconnect")?.hidden,
        ).toBe(false),
      );
      await vi.waitFor(() =>
        expect(JSON.stringify(h.local[RECOVERY_KEY])).toContain(
          "Exact pending draft",
        ),
      );
      expect(h.files.text(path)).toBe("Saved baseline");
      const scans = h.scans.mock.calls.length;
      h.grant.mockClear();
      if (action === "reconnect") {
        root.querySelector<HTMLButtonElement>(".browser-reconnect")!.click();
        expect(h.grant).toHaveBeenCalledTimes(1);
      } else {
        h.files.state.allowed = true;
        window.dispatchEvent(new Event("focus"));
        expect(h.grant).not.toHaveBeenCalled();
      }
      await vi.waitFor(() => expect(h.files.text(path)).toBe(draft));
      await vi.waitFor(() =>
        expect(root.querySelector<HTMLElement>(".browser-scan")!.hidden).toBe(
          true,
        ),
      );
      expect(currentEditor(root)).toBe(view);
      expect(view.state.doc.toString()).toBe(draft);
      expect(view.state.selection.main.anchor).toBe(7);
      expect(h.picker).toHaveBeenCalledTimes(1);
      expect(h.scans).toHaveBeenCalledTimes(scans + 1);
      await vi.waitFor(() =>
        expect(JSON.stringify(h.local[RECOVERY_KEY])).not.toContain(
          "Exact pending draft",
        ),
      );
    },
  );
});
