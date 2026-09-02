import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => {
  let subscriber: ((text: string) => void) | null = null;
  let text = "";
  let preview = "";
  const writes: string[] = [];
  const unsubscribe = vi.fn();
  const api = {
    initialize: vi.fn(),
    subscribe: vi.fn((callback: (text: string) => void) => {
      subscriber = callback;
      return unsubscribe;
    }),
    locked: false,
    lastStreamedItem: null as {
      uuid: string;
      created_at?: string;
      content?: { title?: string };
    } | null,
    get text() {
      return text;
    },
    set text(value: string) {
      text = value;
      writes.push(`text:${value}`);
    },
    get preview() {
      return preview;
    },
    set preview(value: string) {
      preview = value;
      writes.push(`preview:${value}`);
    },
  };
  return {
    api,
    writes,
    unsubscribe,
    stream(
      id: string,
      value: string,
      identity: { title?: string; createdAt?: string } = {},
    ) {
      api.lastStreamedItem = {
        uuid: id,
        created_at: identity.createdAt,
        content: { title: identity.title },
      };
      text = value;
      subscriber?.(value);
    },
  };
});

vi.mock("sn-extension-api", () => ({ default: bridge.api }));

afterEach(() => {
  document.documentElement.removeAttribute("data-environment");
  document.documentElement.removeAttribute("style");
  document.head.replaceChildren();
  document.body.replaceChildren();
  delete window.ReactNativeWebView;
  vi.restoreAllMocks();
});

describe("Standard Notes editor bridge", () => {
  it("saves only on Ctrl+S and isolates dirty drafts by working-note UUID", async () => {
    window.ReactNativeWebView = {};
    const root = document.createElement("main");
    root.id = "app";
    document.body.append(root);
    await import("../src/main");

    expect(bridge.api.initialize).toHaveBeenCalledWith({ debounceSave: 0 });
    expect(bridge.api.subscribe).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.environment).toBe("standard-notes");

    const editorElement = root.querySelector<HTMLElement>(".cm-editor")!;
    const view = EditorView.findFromDOM(editorElement);
    if (!view) throw new Error("CodeMirror view was not mounted");
    const editor = root.querySelector<HTMLElement>(".aic-editor")!;

    expect(view.state.readOnly).toBe(true);
    expect(editor.dataset.saveState).toBe("unavailable");

    const first = "# First\n\n- [ ] exact  \n";
    bridge.stream("note-first", first);
    expect(view.state.doc.toString()).toBe(first);
    expect(view.state.readOnly).toBe(false);
    expect(editor.dataset.saveState).toBe("saved");

    view.dispatch({
      changes: { from: first.length, insert: "local" },
      userEvent: "input",
    });
    expect(editor.dataset.saveState).toBe("dirty");
    root.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null }));
    expect(bridge.writes).toEqual([]);

    const second = "## Second\n\nremote\n";
    bridge.stream("note-second", second);
    expect(view.state.doc.toString()).toBe(second);
    expect(bridge.writes).toEqual([]);

    bridge.stream("note-first", first);
    expect(view.state.doc.toString()).toBe(`${first}local`);
    expect(editor.dataset.saveState).toBe("dirty");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
    );
    expect(bridge.api.text).toBe(`${first}local`);
    expect(bridge.api.preview).toBe("First exact local");
    expect(bridge.writes).toEqual([
      "preview:First exact local",
      `text:${first}local`,
    ]);
    expect(editor.dataset.saveState).toBe("saved");

    bridge.stream("note-empty", "");
    expect(editor.dataset.saveState).toBe("placeholder");

    const documentSource = "---\nstatus: draft\n---\n\n# Document\n";
    bridge.stream("markdown-file", documentSource, {
      title: "documentation.md",
      createdAt: "2026-08-20T10:00:00.000Z",
    });
    const writesBeforeFileSave = bridge.writes.length;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
    );
    expect(bridge.api.text).toBe(documentSource);
    expect(view.state.doc.toString()).toBe(bridge.api.text);
    expect(bridge.writes).toHaveLength(writesBeforeFileSave);
    expect(editor.dataset.saveState).toBe("saved");

    const noteSource = "---\nstatus: draft\n---\n\n# Note\n";
    bridge.stream("markdown-note", noteSource, {
      title: "documentation.note.md",
      createdAt: "2026-08-20T10:00:00.000Z",
    });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
    );
    expect(bridge.api.text).toMatch(
      /^---\nfile: documentation\.note\.md\ncreated: 2026-08-20T10:00:00\.000Z\nupdated: .+Z\nstatus: draft\n---\n\n# Note\n$/u,
    );

    bridge.api.locked = true;
    bridge.stream("note-empty", "");
    expect(
      [
        ...root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
          "button,select",
        ),
      ].every((control) => control.disabled),
    ).toBe(true);

    bridge.api.locked = false;
    bridge.stream("note-first", `${first}local`);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    const writesBeforeUnload = [...bridge.writes];
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(bridge.writes).toEqual(writesBeforeUnload);
    expect(bridge.unsubscribe).toHaveBeenCalledOnce();
    expect(root.querySelector(".aic-editor")).toBeNull();
  });
});
