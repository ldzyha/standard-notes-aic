import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
import { displayPageLocation } from "../src/browser/navigation";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import type {
  BrowserLibrary,
  BrowserNote,
  PageVisit,
} from "../src/browser/library";

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

const firstPage: ActivePage = {
  tabId: 7,
  windowId: 2,
  title: "First page",
  url: "https://example.com/first",
};
const secondPage: ActivePage = {
  tabId: 8,
  windowId: 2,
  title: "Second page",
  url: "https://example.com/second",
};
const note = (page: ActivePage, markdown: string): BrowserNote => ({
  id: page.url,
  url: page.url,
  title: page.title,
  markdown,
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
});

function fixture(
  options: {
    state?: "locked" | "unlocked";
    private?: boolean;
    page?: ActivePage | null;
    notes?: BrowserNote[];
    history?: PageVisit[];
  } = {},
) {
  let state = options.state ?? "unlocked";
  let page = options.page === undefined ? firstPage : options.page;
  const library: BrowserLibrary = {
    version: 3,
    global: null,
    domains: [],
    notes: options.notes ?? [],
    history: options.history ?? [],
  };
  const changed = event<[Record<string, unknown>, string]>();
  const activated = event<[{ tabId: number; windowId: number }]>();
  const updated =
    event<
      [
        number,
        { url?: string; title?: string; status?: string },
        { id?: number; windowId: number; active?: boolean },
      ]
    >();
  const removed = event<[number, { windowId: number }]>();
  const messages: Request[] = [];
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        messages.push(message);
        let value: unknown = null;
        switch (message.type) {
          case "status":
            value = { state };
            break;
          case "lock":
            state = "locked";
            changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
            break;
          case "context":
            value = page;
            break;
          case "visit":
            value = structuredClone(library);
            break;
          case "create": {
            const created = note(message.page, message.markdown);
            library.notes.push(created);
            value = structuredClone(created);
            break;
          }
          case "save": {
            const existing = library.notes.find(
              (item) => item.id === message.id,
            )!;
            existing.markdown = message.markdown;
            existing.revision += 1;
            value = structuredClone(existing);
            break;
          }
        }
        return { ok: true, value };
      },
    },
    windows: {
      getCurrent: async () => ({ id: 2, incognito: options.private ?? false }),
    },
    storage: { onChanged: changed },
    tabs: { onActivated: activated, onUpdated: updated, onRemoved: removed },
    permissions: { request: vi.fn(async () => true) },
  } as unknown as BrowserApi;
  return {
    api,
    messages,
    activated,
    updated,
    changed,
    setPage(next: ActivePage | null) {
      page = next;
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
function namedButton(
  root: HTMLElement,
  name: RegExp,
): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      name.test(button.getAttribute("aria-label") || button.textContent || ""),
    ) ?? null
  );
}
function press(root: HTMLElement, name: RegExp): HTMLButtonElement {
  const button = namedButton(root, name);
  expect(button, `Expected button ${name}`).not.toBeNull();
  button!.focus();
  button!.click();
  return button!;
}
function view(root: HTMLElement): EditorView {
  return EditorView.findFromDOM(
    root.querySelector<HTMLElement>(".cm-editor")!,
  )!;
}
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser panel compact UX", () => {
  it("keeps page and Markdown import as direct header actions", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(namedButton(root, /^Add content$/iu)).toBeNull();
    expect(namedButton(root, /^Paste from clipboard$/iu)).toBeNull();
    expect(namedButton(root, /^Import current content$/iu)).not.toBeNull();
    expect(namedButton(root, /^Import Markdown file$/iu)).not.toBeNull();
    expect(namedButton(root, /^Export Markdown file$/iu)).not.toBeNull();
    expect(
      root
        .querySelector('[aria-label="Import Markdown file"]')
        ?.hasAttribute("aria-haspopup"),
    ).toBe(false);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps backup actions in More options and restores its trigger on Escape", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(namedButton(root, /^Export encrypted backup$/iu)).toBeNull();
    expect(namedButton(root, /^Import encrypted backup$/iu)).toBeNull();
    const trigger = press(root, /^More options$/iu);
    expect(namedButton(root, /^Export encrypted backup$/iu)).not.toBeNull();
    expect(namedButton(root, /^Import encrypted backup$/iu)).not.toBeNull();
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(namedButton(root, /^Export encrypted backup$/iu)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps More limited to local-note and encrypted-backup actions", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    press(root, /^More options$/iu);
    expect(root.querySelector(".browser-menu-group")?.textContent).toBe(
      "Local note",
    );
    const menu = root.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="More options"]',
    )!;
    expect(namedButton(root, /^Delete local note$/iu)).not.toBeNull();
    expect(namedButton(root, /^Copy note$/iu)).toBeNull();
    expect(namedButton(menu, /^Export Markdown/iu)).toBeNull();
    expect(namedButton(root, /^Export encrypted backup$/iu)).not.toBeNull();
    expect(namedButton(root, /^Import encrypted backup$/iu)).not.toBeNull();
  });

  it("opens one native Markdown picker without an intermediate dialog", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    press(root, /^Import Markdown file$/iu);
    const file = root.querySelector<HTMLInputElement>(
      'input[aria-label="Markdown file"]',
    );
    expect(file).not.toBeNull();
    expect(file!.hidden).toBe(true);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    file!.dispatchEvent(new Event("cancel"));
    expect(file!.isConnected).toBe(false);
  });

  it("focuses encrypted backup file control and returns to More options on Escape", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const trigger = press(root, /^More options$/iu);
    press(root, /^Import encrypted backup$/iu);
    const file = root.querySelector<HTMLInputElement>(
      'input[aria-label="Encrypted backup file"]',
    );
    expect(file).not.toBeNull();
    expect(document.activeElement).toBe(file);
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(file!.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("shows an editable AIC placeholder without creating a note", async () => {
    const fake = fixture();
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const initial = view(root);
    expect(initial.state.doc.toString()).toBe(
      "```aic\n# Properties\n\n```\n\n",
    );
    expect(root.querySelector(".cm-aic-properties")).toBeNull();
    expect(namedButton(root, /^Import current content$/iu)).not.toBeNull();
    expect(namedButton(root, /^Import Markdown file$/iu)).not.toBeNull();
    expect(namedButton(root, /^Create note$/iu)).toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(fake.messages.some((message) => message.type === "create")).toBe(
      false,
    );
  });

  it("leaves native editor paste available without a clipboard-read action", async () => {
    const fake = fixture();
    const readText = vi.fn(async () => "must not be read by the panel");
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator) as Navigator, {
        clipboard: { readText },
      }),
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const initial = view(root);
    const seed = initial.state.doc.toString();
    const content = root.querySelector<HTMLElement>(".cm-content")!;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "Fresh pasted content" },
    });
    content.dispatchEvent(event);
    await vi.waitFor(() =>
      expect(view(root).state.doc.toString()).toBe(
        `${seed}Fresh pasted content`,
      ),
    );
    await vi.waitFor(() =>
      expect(fake.messages).toContainEqual({
        type: "create",
        page: firstPage,
        markdown: `${seed}Fresh pasted content`,
        allowPrivate: false,
        ifAbsent: true,
      }),
    );
    expect(view(root)).toBe(initial);
    expect(readText).not.toHaveBeenCalled();
    expect(fake.api.permissions.request).not.toHaveBeenCalled();
  });

  it("does not rebuild the editor or lose a dirty draft while toggling navigation", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const editor = view(root);
    editor.dispatch({
      changes: { from: 8, insert: " draft" },
      selection: { anchor: 5 },
    });
    press(root, /^Notes and history$/iu);
    expect(view(root)).toBe(editor);
    expect(editor.state.doc.toString()).toBe("Existing draft");
    expect(editor.state.selection.main.anchor).toBe(5);
    press(root, /^Notes and history$/iu);
    expect(view(root)).toBe(editor);
    expect(editor.state.doc.toString()).toBe("Existing draft");
  });

  it("shows compact note titles, safe locations as tooltips, and opens the active domain", async () => {
    const deepPage: ActivePage = {
      ...secondPage,
      title: "Deep note",
      url: "https://docs.example/wiki/spaces/EPC/pages/9954820132/deep-note",
    };
    const fake = fixture({
      notes: [note(firstPage, "Existing"), note(deepPage, "Saved")],
      history: [{ url: deepPage.url, title: "Deep note", visitedAt: 2 }],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    press(root, /^Notes and history$/iu);
    const domains = [
      ...root.querySelectorAll<HTMLDetailsElement>(".browser-domain"),
    ];
    expect(
      domains.map((domain) => domain.querySelector("summary")?.textContent),
    ).toEqual(["example.com", "docs.example"]);
    expect(domains.map((domain) => domain.open)).toEqual([true, false]);
    expect(root.querySelector(".browser-path-label")).toBeNull();
    const deepNote = [
      ...root.querySelectorAll<HTMLButtonElement>(".browser-domain button"),
    ].find((button) => button.textContent === "Deep note");
    expect(deepNote?.title).toBe(displayPageLocation(deepPage.url));
    expect(deepNote?.parentElement?.querySelector(".browser-url")).toBeNull();
    const history = root.querySelector(".browser-history")!;
    // Saved pages already appear in the tree, not again in recent history.
    expect(history.childElementCount).toBe(0);
    const filter = root.querySelector<HTMLInputElement>(".browser-filter")!;
    filter.value = "Deep note";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    const matched = root.querySelector<HTMLDetailsElement>(".browser-domain");
    expect(matched?.querySelector("summary")?.textContent).toBe("docs.example");
    expect(matched?.open).toBe(true);
  });

  it("keeps query and fragment data out of history labels, tooltips and delete prompts without changing destinations", async () => {
    const urls = [
      "https://docs.example/login?login_hint=synthetic-private-user&state=synthetic-private-token#synthetic-private-fragment",
      "https://docs.example/login?login_hint=synthetic-private-other",
    ];
    const fake = fixture({
      history: urls.map((url) => ({ url, title: "Sign in", visitedAt: 1 })),
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    press(root, /^Notes and history$/iu);
    const history = root.querySelector<HTMLElement>(".browser-history")!;
    expect(history.innerHTML).not.toContain("synthetic-private");
    expect(history.textContent).not.toContain("login_hint");
    const destinations = [
      ...history.querySelectorAll<HTMLButtonElement>(
        ".browser-page-row > button:not(.browser-page-delete)",
      ),
    ];
    expect(destinations).toHaveLength(2);
    expect(new Set(destinations.map((button) => button.textContent)).size).toBe(
      2,
    );
    destinations[0]!.click();
    await vi.waitFor(() =>
      expect(fake.messages).toContainEqual({
        type: "navigate",
        url: urls[0],
        windowId: 2,
        allowPrivate: false,
      }),
    );
    press(root, /^Notes and history$/iu);
    press(root, /^Remove recent page: Sign in/iu);
    expect(
      root.querySelector(".browser-delete-confirm")?.innerHTML,
    ).not.toContain("synthetic-private");
    const filter = root.querySelector<HTMLInputElement>(".browser-filter");
    expect(filter).toBeNull();
  });

  it("sanitizes URL-like page titles during initial render and tab title updates", async () => {
    const privatePage = {
      ...firstPage,
      url: "https://example.com/login?state=synthetic-private-token",
      title: "https://example.com/login?state=synthetic-private-token",
    };
    const fake = fixture({ page: privatePage });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(root.querySelector(".browser-toolbar")?.innerHTML).not.toContain(
      "synthetic-private",
    );
    fake.updated.emit(
      privatePage.tabId,
      { title: "Login (login?state=synthetic-private-token)" },
      { windowId: privatePage.windowId },
    );
    expect(root.querySelector(".browser-toolbar")?.innerHTML).not.toContain(
      "synthetic-private",
    );
  });

  it("uses one shared editor with five inline formatting actions", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const editor = view(root);
    expect(namedButton(root, /^Formatting$/iu)).toBeNull();
    expect(root.querySelectorAll(".aic-toolbar-group button")).toHaveLength(5);
    expect(
      root.querySelector(".aic-toolbar select,.aic-toolbar-tray"),
    ).toBeNull();
    expect(view(root)).toBe(editor);
  });

  it("does not expose clipboard-copy or clipboard-read panel actions", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(namedButton(root, /Paste from clipboard|Copy note/iu)).toBeNull();
    press(root, /^More options$/iu);
    expect(namedButton(root, /Paste from clipboard|Copy note/iu)).toBeNull();
  });

  it("closes an old page menu on tab change and restores its draft when returning", async () => {
    const fake = fixture({
      notes: [note(firstPage, "First"), note(secondPage, "Second")],
    });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    view(root).dispatch({ changes: { from: 5, insert: " draft" } });
    press(root, /^More options$/iu);
    expect(namedButton(root, /^Export encrypted backup$/iu)).not.toBeNull();
    fake.setPage(secondPage);
    fake.activated.emit({
      tabId: secondPage.tabId,
      windowId: secondPage.windowId,
    });
    await vi.waitFor(() =>
      expect(view(root).state.doc.toString()).toBe("Second"),
    );
    expect(namedButton(root, /^Export encrypted backup$/iu)).toBeNull();
    expect(root.textContent).not.toContain("First draft");
    fake.setPage(firstPage);
    fake.activated.emit({
      tabId: firstPage.tabId,
      windowId: firstPage.windowId,
    });
    await vi.waitFor(() =>
      expect(view(root).state.doc.toString()).toBe("First draft"),
    );
  });

  it("cannot capture from a stale import button after the vault locks", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const staleAction = namedButton(root, /^Import current content$/iu)!;
    fake.changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
    expect(staleAction.isConnected).toBe(false);
    staleAction.click();
    expect(fake.api.permissions.request).not.toHaveBeenCalled();
    expect(fake.messages.some((message) => message.type === "capture")).toBe(
      false,
    );
    expect(root.dataset.state).toBe("locked");
  });
});
