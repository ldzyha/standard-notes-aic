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

function fixture() {
  let page = firstPage;
  const library: BrowserLibrary = {
    version: 3,
    global: null,
    notes: [note(firstPage, "First"), note(secondPage, "Second")],
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
      sendMessage: async (message: Request) => {
        messages.push(message);
        let value: unknown = null;
        if (message.type === "status") value = { state: "unlocked" };
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
    tabs: { onActivated: activated, onUpdated: updated, onRemoved: removed },
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
  it("uses direct accessible transfer actions and a minimal More menu", async () => {
    const fake = fixture();
    const root = document.createElement("div");
    document.body.append(root);
    const panel = new BrowserPanel(root, fake.api);
    panels.push(panel);
    await panel.ready;

    for (const label of [
      "Import current content",
      "Import Markdown file",
      "Export Markdown file",
      "AIC guide",
    ]) {
      const action = button(root, label);
      expect(action.title).not.toBe("");
    }
    expect(root.querySelector('[aria-label="Add content"]')).toBeNull();
    expect(
      root.querySelector('[aria-label="Paste from clipboard"]'),
    ).toBeNull();
    expect(root.querySelector('[aria-label="Copy note"]')).toBeNull();
    button(root, "More options").click();
    expect(root.querySelector(".browser-menu-group")?.textContent).toBe(
      "Local note",
    );
    expect(button(root, "Delete local note")).not.toBeNull();
    expect(button(root, "Export encrypted backup")).not.toBeNull();
    expect(button(root, "Import encrypted backup")).not.toBeNull();
    button(root, "More options").click();
    button(root, "AIC guide").click();
    const guide = root.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="AIC guide"]',
    );
    expect(guide?.textContent).toMatch(/Browser transfer.*↑ Markdown/su);
    expect(guide?.textContent).toMatch(/current browser-vault passphrase/iu);
  });

  it("cancels a pending native file choice when the page changes", async () => {
    const fake = fixture();
    const root = document.createElement("div");
    document.body.append(root);
    const panel = new BrowserPanel(root, fake.api);
    panels.push(panel);
    await panel.ready;

    button(root, "Import Markdown file").click();
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

    button(root, "Import Markdown file").click();
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
