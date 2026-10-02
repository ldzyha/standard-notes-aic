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
const SHARED =
  "# Shared project\n\nCommon project notes.\n\n```aic\nTeam | Synthetic shared field\n```\n";
const GLOBAL =
  "# Global notes\n\n- Reusable checklist\n\n```aic\nFormat | Synthetic global field\n```\n";

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
  let page = {
    id: 7,
    windowId: 2,
    url: "https://example.test/project",
    title: "Synthetic project",
    active: true,
  };
  const messages: Request[] = [];
  let nextLoad: { captured: () => void; wait: Promise<void> } | null = null;
  let service: ReturnType<typeof createBrowserService>;
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        messages.push(message);
        const delayed = message.type === "load" ? nextLoad : null;
        if (delayed) nextLoad = null;
        try {
          const value = await service.handle(message);
          if (delayed) {
            delayed.captured();
            await delayed.wait;
          }
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
    messages,
    picker,
    grant,
    scans,
    restart: () => {
      service = createBrowserService(api, files.bindings);
    },
    navigate: (url: string) => {
      page = { ...page, id: page.id + 1, url, title: "Another page" };
      activated.emit({ tabId: page.id, windowId: page.windowId });
    },
    refreshFromDisk: async () => {
      const sourceId = (local[FILE_SOURCE_KEY] as { id: string }).id;
      await service.handle({ type: "refresh-files", sourceId });
      const library = (await service.handle({
        type: "load",
        sourceId,
      })) as BrowserLibrary;
      changed.emit({ "aic-browser-markdown-change": {} }, "local");
      return library;
    },
    notify: () => changed.emit({ "aic-browser-markdown-change": {} }, "local"),
    pauseNextLoad: () => {
      let captured!: () => void;
      let release!: () => void;
      const observed = new Promise<void>((resolve) => {
        captured = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      nextLoad = { captured, wait };
      return { captured: observed, release };
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
  const element = root.querySelector<HTMLElement>(
    '.browser-scope-panel[data-scope="current"] .cm-editor',
  );
  expect(element, "Current editor").not.toBeNull();
  return EditorView.findFromDOM(element!)!;
}
async function scope(root: HTMLElement, name: "Current" | "Shared" | "Global") {
  button(root, name).click();
  await vi.waitFor(() =>
    expect(
      root.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toBe(name),
  );
}
function writeProperties(
  root: HTMLElement,
  kind: "shared" | "global",
  text: string,
) {
  const container = root.querySelector<HTMLElement>(
    `.browser-domain-properties[data-scope="${kind === "shared" ? "domain" : "global"}"]`,
  )!;
  const view = EditorView.findFromDOM(
    container.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
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
  it.each([
    ["Shared", false, "lower"],
    ["Global", false, "lower"],
    ["Shared", true, "lower"],
    ["Global", true, "lower"],
    ["Shared", true, "higher"],
    ["Global", true, "higher"],
  ] as const)(
    "observes external file changes in %s with dirty=%s and %s revisions",
    async (target, dirty, direction) => {
      const h = harness();
      const { root, panel } = mount(h.api);
      await panel.ready;
      button(root, "Open folder").click();
      await vi.waitFor(() =>
        expect(
          root.querySelector(
            '.browser-scope-panel[data-scope="current"] .cm-editor',
          ),
        ).not.toBeNull(),
      );
      const kind = target === "Shared" ? "shared" : "global";
      const record = (library: BrowserLibrary) =>
        target === "Shared" ? library.domains[0]! : library.global!;
      const activeEditor = () =>
        EditorView.findFromDOM(
          root.querySelector<HTMLElement>(
            `.browser-domain-properties[data-scope="${kind === "shared" ? "domain" : "global"}"] .cm-editor`,
          )!,
        )!;
      await scope(root, target);
      writeProperties(root, kind, "# Original scope\n");
      await scope(root, "Current");
      await scope(root, target);
      const path = record(await h.library()).filePath!;
      // These real SHA-256 tokens change in either numeric direction. Neither
      // is an edit counter; both observations must reach the scope owner.
      const oldText =
        direction === "lower"
          ? "# External version gamma\n"
          : "# External version alpha\n";
      const newText =
        direction === "lower"
          ? "# External version alpha\n"
          : "# External version gamma\n";
      h.files.put(path, oldText);
      const previous = record(await h.refreshFromDisk());
      await vi.waitFor(() =>
        expect(activeEditor().state.doc.toString()).toBe(previous.markdown),
      );
      const view = activeEditor();
      const localDraft = "# Local unsaved version\n";
      if (dirty) {
        // Isolate observation from the later autosave CAS failure: a conflict must
        // be visible before the 350ms save timer gets a chance to run.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: localDraft },
          selection: { anchor: 5 },
        });
      }
      const saves = h.messages.filter(
        (message) =>
          message.type === `save-${kind === "shared" ? "domain" : "global"}`,
      ).length;
      h.files.put(path, newText);
      const incoming = record(await h.refreshFromDisk());
      if (direction === "lower")
        expect(incoming.revision).toBeLessThan(previous.revision);
      else expect(incoming.revision).toBeGreaterThan(previous.revision);
      if (dirty) {
        await vi.waitFor(
          () => expect(root.textContent).toMatch(/another window|conflict/iu),
          { timeout: 50, interval: 1 },
        );
        expect(activeEditor()).toBe(view);
        expect(view.state.doc.toString()).toBe(localDraft);
        expect(view.state.selection.main.anchor).toBe(5);
      } else {
        await vi.waitFor(() =>
          expect(activeEditor().state.doc.toString()).toBe(incoming.markdown),
        );
        expect(activeEditor()).toBe(view);
      }
      expect(
        h.messages.filter(
          (message) =>
            message.type === `save-${kind === "shared" ? "domain" : "global"}`,
        ),
      ).toHaveLength(saves);
      expect(h.files.text(path)).toBe(newText);
    },
  );

  it.each(["Shared", "Global"] as const)(
    "does not replace an acknowledged %s edit with a delayed older library response",
    async (target) => {
      const h = harness();
      const { root, panel } = mount(h.api);
      await panel.ready;
      button(root, "Open folder").click();
      await vi.waitFor(() =>
        expect(
          root.querySelector(
            '.browser-scope-panel[data-scope="current"] .cm-editor',
          ),
        ).not.toBeNull(),
      );
      const kind = target === "Shared" ? "shared" : "global";
      await scope(root, target);
      writeProperties(root, kind, "# Baseline scope\n");
      await scope(root, "Current");
      await scope(root, target);
      const library = await h.library();
      const record =
        target === "Shared" ? library.domains[0]! : library.global!;
      const surface = root.querySelector<HTMLElement>(
        `.browser-domain-properties[data-scope="${kind === "shared" ? "domain" : "global"}"]`,
      )!;
      const view = EditorView.findFromDOM(
        surface.querySelector<HTMLElement>(".cm-editor")!,
      )!;
      const delayed = h.pauseNextLoad();
      h.notify();
      await delayed.captured;
      try {
        const latest = "# Latest acknowledged edit\n";
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: latest },
          selection: { anchor: 6 },
        });
        button(surface, "Save note").click();
        await vi.waitFor(() =>
          expect(
            surface.querySelector<HTMLElement>(".aic-editor")!.dataset
              .saveState,
          ).toBe("saved"),
        );
        expect(h.files.text(record.filePath!)).toBe(latest);
        const writes = h.files.entries.get(record.filePath!)!.closes;
        const statusRequests = h.messages.filter(
          (message) => message.type === "status",
        ).length;
        delayed.release();
        await vi.waitFor(() =>
          expect(
            h.messages.filter((message) => message.type === "status").length,
          ).toBeGreaterThan(statusRequests),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
          EditorView.findFromDOM(
            surface.querySelector<HTMLElement>(".cm-editor")!,
          ),
        ).toBe(view);
        expect(view.state.doc.toString()).toBe(latest);
        expect(view.state.selection.main.anchor).toBe(6);
        expect(h.files.text(record.filePath!)).toBe(latest);
        expect(h.files.entries.get(record.filePath!)!.closes).toBe(writes);
      } finally {
        delayed.release();
      }
    },
  );

  it("saves all scopes into one folder and reopens them through one Continue action after permissions reset", async () => {
    const h = harness();
    const initial = mount(h.api);
    await initial.panel.ready;
    button(initial.root, "Open folder").click();
    await vi.waitFor(() =>
      expect(
        initial.root.querySelector(
          '.browser-scope-panel[data-scope="current"] .cm-editor',
        ),
      ).not.toBeNull(),
    );
    const view = currentEditor(initial.root);
    view.dispatch({ changes: { from: 0, insert: CURRENT } });
    await scope(initial.root, "Shared");
    await writeProperties(initial.root, "shared", SHARED);
    await scope(initial.root, "Global");
    await writeProperties(initial.root, "global", GLOBAL);
    await scope(initial.root, "Current");
    const before = await h.library();
    expect(before.notes).toHaveLength(1);
    expect(before.domains).toHaveLength(1);
    expect(before.global).not.toBeNull();
    expect(before.notes[0]?.markdown).toBe(CURRENT);
    expect(before.domains[0]?.markdown).toBe(SHARED);
    expect(before.global?.markdown).toBe(GLOBAL);
    for (const record of [...before.notes, ...before.domains, before.global!])
      expect(h.files.text(record.filePath!)).toBe(record.markdown);
    expect(before.notes[0]?.url).toBe("https://example.test/project");
    expect(before.domains[0]?.origin).toBe("https://example.test");
    expect(h.files.text(".aic/links.json")).not.toContain(
      "Synthetic shared field",
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
    expect(after.domains).toEqual(before.domains);
    expect(after.global).toEqual(before.global);
    await scope(reopened.root, "Shared");
    expect(
      EditorView.findFromDOM(
        reopened.root.querySelector<HTMLElement>(
          '.browser-domain-properties[data-scope="domain"] .cm-editor',
        )!,
      )!.state.doc.toString(),
    ).toBe(SHARED);
    expect(
      reopened.root.querySelector(".browser-file-location .aic-context__path")!
        .textContent,
    ).toContain(before.domains[0]!.filePath!);
    await scope(reopened.root, "Global");
    expect(
      EditorView.findFromDOM(
        reopened.root.querySelector<HTMLElement>(
          '.browser-domain-properties[data-scope="global"] .cm-editor',
        )!,
      )!.state.doc.toString(),
    ).toBe(GLOBAL);
    expect(
      reopened.root.querySelector(".browser-file-location .aic-context__path")!
        .textContent,
    ).toContain(before.global!.filePath!);
    expect(h.scans).toHaveBeenCalledTimes(scans + 1);
    const oldContextReads = h.messages.filter(
      (message) => message.type === "context",
    ).length;
    h.navigate("https://another.example.test/page");
    await vi.waitFor(() =>
      expect(
        h.messages.filter((message) => message.type === "context").length,
      ).toBeGreaterThan(oldContextReads),
    );
    await vi.waitFor(() =>
      expect(
        reopened.root.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent,
      ).toBe("Global"),
    );
    expect(
      EditorView.findFromDOM(
        reopened.root.querySelector<HTMLElement>(
          '.browser-domain-properties[data-scope="global"] .cm-editor',
        )!,
      )!.state.doc.toString(),
    ).toBe(GLOBAL);
    expect(
      reopened.root.querySelector(".browser-file-location .aic-context__path")!
        .textContent,
    ).toContain(before.global!.filePath!);
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
    expect(
      menu.querySelector('[aria-label="Link file to current page"]'),
    ).toBeNull();
    expect(menu.querySelector('[aria-label="Pin note"]')).toBeNull();
    button(menu, "Download copy").click();
    expect(blobs).toHaveLength(1);
    const downloaded = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blobs[0]!);
    });
    expect(downloaded).toBe(GLOBAL);
    for (const [path, value] of originalBytes)
      expect(h.files.text(path)).toBe(value);
  });

  it.each(["reconnect", "focus"] as const)(
    "keeps the exact live draft and selection when %s restores a restarted worker's folder access",
    async (action) => {
      const h = harness();
      const { root, panel } = mount(h.api);
      await panel.ready;
      button(root, "Open folder").click();
      await vi.waitFor(() =>
        expect(
          root.querySelector(
            '.browser-scope-panel[data-scope="current"] .cm-editor',
          ),
        ).not.toBeNull(),
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
