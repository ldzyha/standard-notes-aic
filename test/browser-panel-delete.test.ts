import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { BrowserPanel } from "../src/browser/panel";
import { displayPageLocation } from "../src/browser/navigation";
import { AIC_EMPTY_DOCUMENT } from "../src/core/security-model.js";
import type { BrowserApi, Request } from "../src/browser/api";
import type { BrowserLibrary } from "../src/browser/library";

const page = {
  url: "https://example.test/guide/page",
  title: "Current page",
  tabId: 1,
  windowId: 2,
};
const other = "https://example.test/other";
const panels: BrowserPanel[] = [];
const placeholder = AIC_EMPTY_DOCUMENT;
function event() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    addListener: (listener: (...args: unknown[]) => void) =>
      listeners.add(listener),
    removeListener: (listener: (...args: unknown[]) => void) =>
      listeners.delete(listener),
    emit: (...args: unknown[]) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

function fixture(
  options: {
    empty?: boolean;
    failure?: string;
    saveGate?: Promise<void>;
    deleteGate?: Promise<void>;
  } = {},
) {
  const makeNote = (url: string, title: string) => ({
    id: url,
    url,
    title,
    markdown: title + " content",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const library: BrowserLibrary = {
    version: 2,
    domains: [],
    notes: options.empty
      ? []
      : [makeNote(page.url, page.title), makeNote(other, "Other page")],
    history: [page, { url: other, title: "Other page" }].map((item) => ({
      url: item.url,
      title: item.title,
      visitedAt: 1,
    })),
  };
  const messages: Request[] = [];
  let active = { ...page };
  const activated = event();
  const api = {
    runtime: {
      sendMessage: async (message: Request) => {
        messages.push(message);
        let value: unknown;
        switch (message.type) {
          case "status":
            value = { state: "unlocked" };
            break;
          case "context":
            value = active;
            break;
          case "visit":
          case "load":
            value = structuredClone(library);
            break;
          case "save": {
            await options.saveGate;
            if (options.failure === "save")
              return { ok: false, code: "storage", error: "Save failed" };
            const note = library.notes.find((item) => item.id === message.id)!;
            note.markdown = message.markdown;
            note.revision++;
            value = structuredClone(note);
            break;
          }
          case "create": {
            const note = makeNote(message.page.url, message.page.title);
            note.markdown = message.markdown;
            library.notes.push(note);
            value = structuredClone(note);
            break;
          }
          case "delete-page": {
            await options.deleteGate;
            if (options.failure === "delete")
              return {
                ok: false,
                code: "conflict",
                error:
                  "This page changed elsewhere. Reload it before deleting.",
              };
            const current = library.notes.find(
              (item) => item.url === message.url,
            );
            if (
              message.expectedNote
                ? current?.id !== message.expectedNote.id ||
                  current?.revision !== message.expectedNote.revision
                : !!current
            )
              return {
                ok: false,
                code: "conflict",
                error: "Changed elsewhere",
              };
            library.notes = library.notes.filter(
              (item) => item.url !== message.url,
            );
            library.history = library.history.filter(
              (item) => item.url !== message.url,
            );
            value = structuredClone(library);
            break;
          }
        }
        return { ok: true, value };
      },
    },
    windows: { getCurrent: async () => ({ id: 2 }) },
    storage: { onChanged: event() },
    tabs: { onActivated: activated, onUpdated: event(), onRemoved: event() },
  } as unknown as BrowserApi;
  const root = document.createElement("div");
  document.body.append(root);
  const panel = new BrowserPanel(root, api);
  panels.push(panel);
  return {
    root,
    panel,
    library,
    messages,
    switchPage() {
      active = { ...page, url: other, title: "Other page", tabId: 3 };
      activated.emit({ tabId: 3, windowId: 2 });
    },
  };
}

function press(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeTruthy();
  button!.click();
}
function view(root: HTMLElement) {
  return EditorView.findFromDOM(
    root.querySelector<HTMLElement>(".browser-note .cm-editor")!,
  )!;
}
function openDelete(root: HTMLElement) {
  press(root, "More options");
  press(root, "Delete local note");
}
afterEach(() => {
  panels.splice(0).forEach((panel) => panel.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("local page deletion UI", () => {
  it("deletes a first-created draft without retaining pending-key contents", async () => {
    const f = fixture({ empty: true });
    await f.panel.ready;
    view(f.root).dispatch({
      changes: { from: placeholder.length, insert: "Draft secret" },
    });
    openDelete(f.root);
    press(f.root, "Delete note");
    await vi.waitFor(() =>
      expect(f.messages.some((message) => message.type === "delete-page")).toBe(
        true,
      ),
    );
    await vi.waitFor(() =>
      expect(view(f.root).state.doc.toString()).toBe(placeholder),
    );
    expect(f.library.notes).toHaveLength(0);
    expect(
      f.messages.filter((message) => message.type === "create"),
    ).toHaveLength(1);
  });

  it("accepts our own save finishing while the confirmation is open", async () => {
    const f = fixture();
    await f.panel.ready;
    view(f.root).dispatch({ changes: { from: 0, insert: "Own edit " } });
    openDelete(f.root);
    await vi.waitFor(() => expect(f.library.notes[0]!.revision).toBe(2));
    press(f.root, "Delete note");
    await vi.waitFor(() => expect(f.library.notes).toHaveLength(1));
    expect(
      f.messages.find((message) => message.type === "delete-page"),
    ).toMatchObject({ expectedNote: { revision: 2 } });
  });

  it("does not authorize a newer revision written by another panel", async () => {
    const f = fixture();
    await f.panel.ready;
    openDelete(f.root);
    f.library.notes[0]!.revision++;
    f.library.notes[0]!.markdown = "Remote edit";
    press(f.root, "Delete note");
    await vi.waitFor(() =>
      expect(
        f.root.querySelector(".browser-feedback[role=alert]"),
      ).not.toBeNull(),
    );
    expect(f.library.notes[0]!.markdown).toBe("Remote edit");
    expect(
      f.messages.find((message) => message.type === "delete-page"),
    ).toMatchObject({ expectedNote: { revision: 1 } });
  });

  it("cancels deletion if the page changes before its save acknowledges", async () => {
    let release!: () => void;
    const f = fixture({
      saveGate: new Promise<void>((done) => {
        release = done;
      }),
    });
    await f.panel.ready;
    view(f.root).dispatch({ changes: { from: 0, insert: "Edited " } });
    openDelete(f.root);
    press(f.root, "Delete note");
    await vi.waitFor(() =>
      expect(f.messages.some((message) => message.type === "save")).toBe(true),
    );
    f.switchPage();
    await vi.waitFor(() =>
      expect(view(f.root).state.doc.toString()).toBe("Other page content"),
    );
    release();
    await vi.waitFor(() =>
      expect(f.root.querySelector<HTMLElement>(".browser-content")?.inert).toBe(
        false,
      ),
    );
    expect(f.messages.some((message) => message.type === "delete-page")).toBe(
      false,
    );
    expect(f.library.notes).toHaveLength(2);
  });

  it("does not replace the new page when deletion acknowledges late", async () => {
    let release!: () => void;
    const f = fixture({
      deleteGate: new Promise<void>((done) => {
        release = done;
      }),
    });
    await f.panel.ready;
    openDelete(f.root);
    press(f.root, "Delete note");
    await vi.waitFor(() =>
      expect(f.messages.some((message) => message.type === "delete-page")).toBe(
        true,
      ),
    );
    f.switchPage();
    await vi.waitFor(() =>
      expect(view(f.root).state.doc.toString()).toBe("Other page content"),
    );
    const next = view(f.root);
    release();
    await vi.waitFor(() => expect(f.library.notes).toHaveLength(1));
    expect(view(f.root)).toBe(next);
    expect(next.state.doc.toString()).toBe("Other page content");
    await vi.waitFor(() =>
      expect(f.root.querySelector<HTMLElement>(".browser-content")?.inert).toBe(
        false,
      ),
    );
  });

  it("confirms before deleting and resets the active note to a memory-only placeholder", async () => {
    const f = fixture();
    await f.panel.ready;
    const original = view(f.root);
    openDelete(f.root);
    expect(f.root.textContent).toContain(
      "website, shared properties, and other notes stay unchanged",
    );
    press(f.root, "Cancel");
    expect(f.messages.some((message) => message.type === "delete-page")).toBe(
      false,
    );
    openDelete(f.root);
    press(f.root, "Delete note");
    await vi.waitFor(() => expect(f.library.notes).toHaveLength(1));
    expect(f.library.notes[0]!.url).toBe(other);
    expect(f.library.history.map((item) => item.url)).toEqual([other]);
    expect(view(f.root)).not.toBe(original);
    expect(view(f.root).state.doc.toString()).toBe(placeholder);
    expect(f.messages.some((message) => message.type === "create")).toBe(false);
    view(f.root).dispatch({
      changes: { from: placeholder.length, insert: "New content" },
    });
    await vi.waitFor(() =>
      expect(f.messages.some((message) => message.type === "create")).toBe(
        true,
      ),
    );
  });

  it("deletes from the tree without changing the active note and deduplicates history", async () => {
    const f = fixture();
    await f.panel.ready;
    const original = view(f.root);
    press(f.root, "Notes and history");
    expect(
      f.root.querySelectorAll(
        '.browser-page-row button[title="' +
          displayPageLocation(page.url) +
          '"]',
      ),
    ).toHaveLength(1);
    expect(f.root.querySelector(".browser-history")?.childElementCount).toBe(0);
    press(f.root, "Delete local note: Other page");
    press(f.root, "Delete note");
    await vi.waitFor(() => expect(f.library.notes).toHaveLength(1));
    expect(f.library.notes[0]!.url).toBe(page.url);
    expect(view(f.root)).toBe(original);
    press(f.root, "Notes and history");
    expect(f.root.querySelector(".browser-library")?.textContent).not.toContain(
      "Other page",
    );
  });

  it("removes history-only entries without creating a note", async () => {
    const f = fixture({ empty: true });
    await f.panel.ready;
    press(f.root, "More options");
    press(f.root, "Remove page from history");
    press(f.root, "Remove page");
    await vi.waitFor(() => expect(f.library.history).toHaveLength(1));
    expect(f.library.notes).toHaveLength(0);
    expect(view(f.root).state.doc.toString()).toBe(placeholder);
    expect(
      f.messages.find((message) => message.type === "delete-page"),
    ).toMatchObject({ expectedNote: null });
  });

  it("waits for an in-flight save and deletes its acknowledged revision", async () => {
    let release!: () => void;
    const saveGate = new Promise<void>((done) => {
      release = done;
    });
    const f = fixture({ saveGate });
    await f.panel.ready;
    view(f.root).dispatch({ changes: { from: 0, insert: "Edited " } });
    openDelete(f.root);
    press(f.root, "Delete note");
    await vi.waitFor(() =>
      expect(f.messages.some((message) => message.type === "save")).toBe(true),
    );
    expect(f.root.querySelector<HTMLElement>(".browser-content")?.inert).toBe(
      true,
    );
    expect(f.messages.some((message) => message.type === "delete-page")).toBe(
      false,
    );
    release();
    await vi.waitFor(() => expect(f.library.notes).toHaveLength(1));
    expect(
      f.messages.find((message) => message.type === "delete-page"),
    ).toMatchObject({ expectedNote: { revision: 2 } });
    expect(view(f.root).state.doc.toString()).toBe(placeholder);
    expect(f.root.querySelector<HTMLElement>(".browser-content")?.inert).toBe(
      false,
    );
  });

  it.each(["save", "delete"])(
    "preserves the current text when %s fails",
    async (failure) => {
      const f = fixture({ failure });
      await f.panel.ready;
      const current = view(f.root);
      current.dispatch({ changes: { from: 0, insert: "Keep " } });
      openDelete(f.root);
      press(f.root, "Delete note");
      await vi.waitFor(() =>
        expect(
          f.root.querySelector(".browser-feedback[role=alert]"),
        ).not.toBeNull(),
      );
      expect(f.library.notes).toHaveLength(2);
      expect(view(f.root)).toBe(current);
      expect(current.state.doc.toString()).toContain("Keep ");
      expect(f.root.querySelector<HTMLElement>(".browser-content")?.inert).toBe(
        false,
      );
      if (failure === "save")
        expect(
          f.messages.some((message) => message.type === "delete-page"),
        ).toBe(false);
    },
  );
});
