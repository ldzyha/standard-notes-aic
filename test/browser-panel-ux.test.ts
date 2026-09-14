import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
    version: 2,
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
function announcements(root: HTMLElement): string {
  return [
    ...root.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
  ]
    .map((status) => status.textContent || "")
    .join(" ");
}
function clipboard(readText: () => Promise<string>) {
  const read = vi.fn(readText);
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator) as Navigator, {
      clipboard: { readText: read },
    }),
  );
  return read;
}
function openClipboard(root: HTMLElement) {
  press(root, /^Add content$/iu);
  press(root, /^Paste from clipboard$/iu);
}

afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser panel compact UX", () => {
  it("keeps import choices in a menu and Escape closes it with focus restored", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(namedButton(root, /^Paste from clipboard$/iu)).toBeNull();
    const trigger = press(root, /^Add content$/iu);
    expect(
      root.querySelector('[role="dialog"][aria-label="Add content"]'),
    ).not.toBeNull();
    expect(namedButton(root, /^Import page$/iu)).not.toBeNull();
    expect(namedButton(root, /^Import selection$/iu)).not.toBeNull();
    expect(namedButton(root, /^Paste from clipboard$/iu)).not.toBeNull();
    expect(namedButton(root, /^Import Markdown$/iu)).not.toBeNull();
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(namedButton(root, /^Paste from clipboard$/iu)).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

  it("returns focus to More options after Copy note", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator) as Navigator, {
        clipboard: { writeText },
      }),
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const trigger = press(root, /^More options$/iu);
    press(root, /^Copy note$/iu);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Existing"));
    expect(
      root.querySelector('[role="dialog"][aria-label="More options"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("focuses Markdown import file control and returns to Add content on Escape", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const trigger = press(root, /^Add content$/iu);
    press(root, /^Import Markdown$/iu);
    const file = root.querySelector<HTMLInputElement>(
      'input[aria-label="Markdown file"]',
    );
    expect(file).not.toBeNull();
    expect(document.activeElement).toBe(file);
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(file!.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
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

  it("shows an editable Properties placeholder without creating a note", async () => {
    const fake = fixture();
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const initial = view(root);
    expect(initial.state.doc.toString()).toBe("---\n# aic-fields: v2\n---\n\n");
    expect(root.querySelector(".cm-aic-properties")).not.toBeNull();
    expect(namedButton(root, /^Add content$/iu)).not.toBeNull();
    expect(namedButton(root, /^Import page$/iu)).toBeNull();
    expect(namedButton(root, /^Create note$/iu)).toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(fake.messages.some((message) => message.type === "create")).toBe(
      false,
    );
    press(root, /^Add content$/iu);
    expect(namedButton(root, /^Import page$/iu)).not.toBeNull();
    expect(namedButton(root, /^Paste from clipboard$/iu)).not.toBeNull();
  });

  it("replaces an untouched placeholder with clipboard import in the same editor", async () => {
    const fake = fixture();
    const read = clipboard(async () => "Fresh pasted content");
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const initial = view(root);
    openClipboard(root);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(view(root).state.doc.toString()).toBe("Fresh pasted content"),
    );
    expect(fake.messages).toContainEqual({
      type: "create",
      page: firstPage,
      markdown: "Fresh pasted content",
      allowPrivate: false,
      ifAbsent: true,
    });
    expect(view(root)).toBe(initial);
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

  it("shows compact note titles, keeps URLs as tooltips, and opens the active domain", async () => {
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
    expect(deepNote?.title).toBe(deepPage.url);
    expect(deepNote?.parentElement?.querySelector(".browser-url")).toBeNull();
    const history = root.querySelector(".browser-history")!;
    expect(history.querySelector("button")?.title).toBe(deepPage.url);
    expect(history.querySelector("small")?.textContent).toBe("docs.example");
    expect(history.textContent).not.toContain(deepPage.url);
    const filter = root.querySelector<HTMLInputElement>(".browser-filter")!;
    filter.value = "Deep note";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    const matched = root.querySelector<HTMLDetailsElement>(".browser-domain");
    expect(matched?.querySelector("summary")?.textContent).toBe("docs.example");
    expect(matched?.open).toBe(true);
  });

  it("uses one shared editor with a collapsed formatting tray", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    const editor = view(root);
    const trigger = namedButton(root, /^Formatting$/iu);
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("aria-expanded")).toBe("false");
    const tray = document.getElementById(
      trigger!.getAttribute("aria-controls")!,
    );
    expect(tray?.hidden).toBe(true);
    press(root, /^Formatting$/iu);
    expect(trigger!.getAttribute("aria-expanded")).toBe("true");
    expect(tray?.hidden).toBe(false);
    expect(view(root)).toBe(editor);
    tray!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(tray?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(view(root)).toBe(editor);
  });

  it("reads clipboard only after a deliberate click and appends instead of replacing", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const pending = deferred<string>();
    const read = clipboard(() => pending.promise);
    const { root, panel } = mount(fake.api);
    await panel.ready;
    expect(read).not.toHaveBeenCalled();
    press(root, /^Add content$/iu);
    expect(read).not.toHaveBeenCalled();
    press(root, /^Paste from clipboard$/iu);
    expect(read).toHaveBeenCalledTimes(1);
    namedButton(root, /^Add content$/iu)?.click();
    namedButton(root, /^Paste from clipboard$/iu)?.click();
    expect(read).toHaveBeenCalledTimes(1);
    expect(
      root.querySelector('[aria-busy="true"]') ||
        root.textContent?.match(/Importing|Reading clipboard/iu),
    ).toBeTruthy();
    pending.resolve("Pasted content");
    await vi.waitFor(() =>
      expect(view(root).state.doc.toString()).toBe(
        "Existing\n\nPasted content",
      ),
    );
    expect(fake.messages).toContainEqual({
      type: "save",
      id: firstPage.url,
      markdown: "Existing\n\nPasted content",
      revision: 1,
    });
    expect(announcements(root)).toMatch(/Pasted|Imported|added/iu);
  });

  it("shows a clipboard read error without changing the note", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    clipboard(() => Promise.reject(new Error("Clipboard access denied")));
    const { root, panel } = mount(fake.api);
    await panel.ready;
    openClipboard(root);
    await vi.waitFor(() =>
      expect(announcements(root)).toMatch(/Clipboard access (?:was )?denied/iu),
    );
    expect(view(root).state.doc.toString()).toBe("Existing");
    expect(fake.messages.some((message) => message.type === "save")).toBe(
      false,
    );
  });

  it("does not read clipboard without a current page, private consent, or unlock", async () => {
    const read = clipboard(async () => "Private text");
    for (const options of [
      { page: null },
      { private: true },
      { state: "locked" as const },
    ]) {
      const fake = fixture(options);
      const { root, panel } = mount(fake.api);
      await panel.ready;
      namedButton(root, /^Add content$/iu)?.click();
      namedButton(root, /^Paste from clipboard$/iu)?.click();
      expect(read).not.toHaveBeenCalled();
      expect(fake.messages.some((message) => message.type === "create")).toBe(
        false,
      );
    }
  });

  it("drops a late clipboard result after a tab switch", async () => {
    const fake = fixture({
      notes: [note(firstPage, "First"), note(secondPage, "Second")],
    });
    const pending = deferred<string>();
    clipboard(() => pending.promise);
    const { root, panel } = mount(fake.api);
    await panel.ready;
    openClipboard(root);
    fake.setPage(secondPage);
    fake.activated.emit({
      tabId: secondPage.tabId,
      windowId: secondPage.windowId,
    });
    await vi.waitFor(() =>
      expect(view(root).state.doc.toString()).toBe("Second"),
    );
    pending.resolve("Stale clipboard content");
    await Promise.resolve();
    await Promise.resolve();
    expect(view(root).state.doc.toString()).toBe("Second");
    expect(
      fake.messages.some(
        (message) => message.type === "save" || message.type === "create",
      ),
    ).toBe(false);
    expect(root.textContent).not.toContain("Stale clipboard content");
  });

  it("lets the new tab import while an old clipboard read is pending without losing its busy state", async () => {
    const fake = fixture({
      notes: [note(firstPage, "First"), note(secondPage, "Second")],
    });
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    let reads = 0;
    const read = clipboard(() =>
      ++reads === 1 ? firstRead.promise : secondRead.promise,
    );
    const { root, panel } = mount(fake.api);
    await panel.ready;
    openClipboard(root);
    expect(read).toHaveBeenCalledTimes(1);

    fake.setPage(secondPage);
    fake.activated.emit({
      tabId: secondPage.tabId,
      windowId: secondPage.windowId,
    });
    await vi.waitFor(() =>
      expect(view(root).state.doc.toString()).toBe("Second"),
    );
    expect(namedButton(root, /^Add content$/iu)?.disabled).toBe(false);
    openClipboard(root);
    expect(read).toHaveBeenCalledTimes(2);
    expect(
      root.querySelector(".browser-content")?.getAttribute("aria-busy"),
    ).toBe("true");

    firstRead.resolve("Old tab clipboard");
    await Promise.resolve();
    await Promise.resolve();
    expect(
      root.querySelector(".browser-content")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(namedButton(root, /^Add content$/iu)?.disabled).toBe(true);
    expect(view(root).state.doc.toString()).toBe("Second");
    expect(fake.messages.some((message) => message.type === "save")).toBe(
      false,
    );

    secondRead.resolve("New tab clipboard");
    await vi.waitFor(() =>
      expect(view(root).state.doc.toString()).toBe(
        "Second\n\nNew tab clipboard",
      ),
    );
    expect(fake.messages.filter((message) => message.type === "save")).toEqual([
      {
        type: "save",
        id: secondPage.url,
        markdown: "Second\n\nNew tab clipboard",
        revision: 1,
      },
    ]);
    await vi.waitFor(() =>
      expect(
        root.querySelector(".browser-content")?.getAttribute("aria-busy"),
      ).toBe("false"),
    );
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

  it("drops a late clipboard result after the vault locks", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const pending = deferred<string>();
    clipboard(() => pending.promise);
    const { root, panel } = mount(fake.api);
    await panel.ready;
    openClipboard(root);
    fake.changed.emit({ "aic-browser-unlock": { oldValue: {} } }, "session");
    pending.resolve("Secret clipboard content");
    await Promise.resolve();
    await Promise.resolve();
    expect(root.dataset.state).toBe("locked");
    expect(root.querySelector(".cm-editor")).toBeNull();
    expect(root.textContent).not.toContain("Secret clipboard content");
    expect(
      fake.messages.some(
        (message) => message.type === "save" || message.type === "create",
      ),
    ).toBe(false);
  });

  it("cannot capture from a stale import button after the vault locks", async () => {
    const fake = fixture({ notes: [note(firstPage, "Existing")] });
    const { root, panel } = mount(fake.api);
    await panel.ready;
    press(root, /^Add content$/iu);
    const staleAction = namedButton(root, /^Import page$/iu)!;
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
