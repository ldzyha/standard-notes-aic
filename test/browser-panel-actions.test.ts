import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
import type { ActivePage, BrowserApi, Request } from "../src/browser/api";
import type { BrowserLibrary, BrowserNote } from "../src/browser/library";

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
  tabId: 31,
  windowId: 4,
  title: "First page",
  url: "https://fixture.example/first",
};
const secondPage: ActivePage = {
  tabId: 32,
  windowId: 4,
  title: "Second page",
  url: "https://fixture.example/second",
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
  notes = [note(firstPage, "First"), note(secondPage, "Second")],
) {
  let page = firstPage;
  const library: BrowserLibrary = {
    version: 3,
    global: null,
    notes,
    history: [],
    domains: [],
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
      getURL: vi.fn((path: string) => `chrome-extension://fixture/${path}`),
      sendMessage: async (message: Request) => {
        messages.push(message);
        let value: unknown = null;
        if (message.type === "status") value = { state: "ready" };
        if (message.type === "context") value = page;
        if (message.type === "visit") value = structuredClone(library);
        if (message.type === "save") {
          const saved = library.notes.find((item) => item.id === message.id)!;
          saved.markdown = message.markdown;
          saved.revision += 1;
          value = structuredClone(saved);
        }
        return { ok: true, value };
      },
    },
    windows: { getCurrent: async () => ({ id: 4, incognito: false }) },
    storage: { onChanged: changed },
    tabs: {
      create: vi.fn(async () => ({ id: 40, windowId: 4 })),
      onActivated: activated,
      onUpdated: updated,
      onRemoved: removed,
    },
    permissions: { request: vi.fn(async () => true) },
  } as unknown as BrowserApi;
  return {
    api,
    messages,
    activated,
    setPage(next: ActivePage) {
      page = next;
    },
  };
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  if (
    [
      "Pin note",
      "Unpin note",
      "Import current content",
      "Insert from Markdown file",
      "Download copy",
      "AIC guide",
    ].includes(label) &&
    !root.querySelector(`button[aria-label="${label}"]`)
  )
    root
      .querySelector<HTMLButtonElement>('button[aria-label="More options"]')!
      .click();
  const result = root.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(result).not.toBeNull();
  return result!;
}

function editorText(root: HTMLElement): string {
  return EditorView.findFromDOM(
    root.querySelector<HTMLElement>(".cm-editor")!,
  )!.state.doc.toString();
}

const panels: BrowserPanel[] = [];
afterEach(() => {
  for (const panel of panels.splice(0)) panel.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("browser panel direct actions", () => {
  it("focuses an enabled menu action when the current note cannot be pinned yet", async () => {
    const fake = fixture([]);
    const root = document.createElement("div");
    document.body.append(root);
    const panel = new BrowserPanel(root, fake.api);
    panels.push(panel);
    await panel.ready;

    button(root, "More options").click();
    expect(button(root, "Pin note").disabled).toBe(true);
    expect(document.activeElement).toBe(button(root, "Import current content"));
  });

  it.each([
    ["Terms and privacy", "https://aic.dzyha.com/terms"],
    ["Releases and installation", "https://aic.dzyha.com/releases"],
    ["How to create documents", "https://aic.dzyha.com/how-to"],
  ])("opens %s through the browser tab API", async (label, url) => {
    const fake = fixture();
    const root = document.createElement("div");
    document.body.append(root);
    const panel = new BrowserPanel(root, fake.api);
    panels.push(panel);
    await panel.ready;
    const previousRequests = fake.messages.length;

    button(root, "More options").click();
    button(root, label!).click();
    await Promise.resolve();

    expect(fake.api.tabs.create).toHaveBeenCalledWith({ url, windowId: 4 });
    expect(fake.api.runtime.getURL).not.toHaveBeenCalled();
    expect(fake.messages).toHaveLength(previousRequests);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(editorText(root)).toBe("First");
  });

  it("keeps exactly two header controls and readable actions in More", async () => {
    const fake = fixture();
    const root = document.createElement("div");
    document.body.append(root);
    const panel = new BrowserPanel(root, fake.api);
    panels.push(panel);
    await panel.ready;

    const headerButtons = [
      ...root.querySelectorAll<HTMLButtonElement>(".browser-toolbar button"),
    ];
    expect(
      headerButtons.map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Notes", "More options"]);
    for (const control of headerButtons) {
      expect(control.classList.contains("aic-button--touch")).toBe(true);
      expect(control.classList.contains("aic-button--compact")).toBe(false);
    }
    expect(
      root.querySelector('[aria-label="Import current content"]'),
    ).toBeNull();
    button(root, "More options").click();
    for (const [label, caption] of [
      ["Pin note", "Pin note"],
      ["Import current content", "Import current content"],
      ["Insert from Markdown file", "Insert from file…"],
      ["Download copy", "Download copy"],
      ["AIC guide", "AIC guide"],
    ]) {
      const action = button(root, label!);
      expect(action.closest(".browser-popover")).not.toBeNull();
      expect(action.textContent).toBe(caption);
      expect(action.title).not.toBe("");
    }
    expect(root.querySelector('[aria-label="Add content"]')).toBeNull();
    expect(
      root.querySelector('[aria-label="Paste from clipboard"]'),
    ).toBeNull();
    expect(root.querySelector('[aria-label="Copy note"]')).toBeNull();
    expect(root.querySelector(".browser-menu-group")?.textContent).toBe(
      "Current note",
    );
    expect(button(root, "Delete local note")).not.toBeNull();
    expect(button(root, "Open file…").textContent).toBe("Open file…");
    expect(button(root, "Open folder…").textContent).toBe("Open folder…");
    expect(
      root.querySelector<HTMLElement>(".browser-overlay")?.dataset.layout,
    ).toBe("actions");
    button(root, "More options").click();
    button(root, "AIC guide").click();
    const guide = root.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="AIC guide"]',
    );
    expect(
      root.querySelector<HTMLElement>(".browser-overlay")?.dataset.layout,
    ).toBeUndefined();
    expect(guide?.textContent).toMatch(/Browser transfer.*Insert from file/su);
    expect(guide?.textContent).not.toMatch(
      /browser-vault|passphrase|encrypted backup/iu,
    );
    const view = EditorView.findFromDOM(
      root.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    view.dispatch({ selection: { anchor: 2 } });
    for (let index = 0; index < 2; index++) {
      root.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(document.activeElement).toBe(button(root, "More options"));
      expect(
        EditorView.findFromDOM(root.querySelector<HTMLElement>(".cm-editor")!),
      ).toBe(view);
      expect(view.state.selection.main.head).toBe(2);
      button(root, "AIC guide").click();
      expect(
        root.querySelector('[role="dialog"][aria-label="AIC guide"]'),
      ).not.toBeNull();
    }
  });

  it("cancels a pending native file choice when the page changes", async () => {
    const fake = fixture();
    const root = document.createElement("div");
    document.body.append(root);
    const panel = new BrowserPanel(root, fake.api);
    panels.push(panel);
    await panel.ready;

    button(root, "Insert from Markdown file").click();
    const input = root.querySelector<HTMLInputElement>(
      'input[aria-label="Markdown file"]',
    )!;
    expect(input.hidden).toBe(true);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    fake.setPage(secondPage);
    fake.activated.emit({ tabId: secondPage.tabId, windowId: 4 });
    await vi.waitFor(() => expect(editorText(root)).toBe("Second"));
    expect(input.isConnected).toBe(false);

    const selected = new File(["stale"], "stale.md", {
      type: "text/markdown",
    });
    Object.defineProperty(input, "files", { value: [selected] });
    input.dispatchEvent(new Event("change"));
    await Promise.resolve();
    expect(editorText(root)).toBe("Second");
    expect(root.dataset.importing).toBe("false");
    expect(
      fake.messages.some(
        (message) => message.type === "save" || message.type === "create",
      ),
    ).toBe(false);
  });

  it("drops a late file read after a tab switch", async () => {
    const fake = fixture();
    const root = document.createElement("div");
    document.body.append(root);
    const panel = new BrowserPanel(root, fake.api);
    panels.push(panel);
    await panel.ready;

    button(root, "Insert from Markdown file").click();
    const input = root.querySelector<HTMLInputElement>(
      'input[aria-label="Markdown file"]',
    )!;
    const pending = deferred<string>();
    const selected = new File([""], "late.md", { type: "text/markdown" });
    Object.defineProperty(selected, "text", { value: () => pending.promise });
    Object.defineProperty(input, "files", { value: [selected] });
    input.dispatchEvent(new Event("change"));
    expect(root.dataset.importing).toBe("true");

    fake.setPage(secondPage);
    fake.activated.emit({ tabId: secondPage.tabId, windowId: 4 });
    await vi.waitFor(() => expect(editorText(root)).toBe("Second"));
    pending.resolve("must not reach either note");
    await Promise.resolve();
    await Promise.resolve();
    expect(editorText(root)).toBe("Second");
    expect(root.dataset.importing).toBe("false");
    expect(
      fake.messages.some(
        (message) => message.type === "save" || message.type === "create",
      ),
    ).toBe(false);
  });
});
