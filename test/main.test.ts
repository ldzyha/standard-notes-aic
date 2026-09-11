import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => {
  type Callback = (reply: unknown) => void;
  let context: Callback | undefined;
  const saves: {
    text: string;
    preview: string;
    id: string;
    callback?: Callback;
  }[] = [];
  const api = {
    initialize: vi.fn(() =>
      api.postMessage("stream-context-item", {}, () => {}),
    ),
    postMessage(action: string, data: any, callback?: Callback) {
      if (action === "stream-context-item") context = callback;
      else if (action === "save-items") {
        const item = data.items[0];
        saves.push({
          text: item.content.text,
          preview: item.content.preview_plain,
          id: item.uuid,
          callback,
        });
      }
    },
  };
  return {
    api,
    saves,
    stream(
      id: string,
      text: string,
      options: {
        title?: string;
        createdAt?: string;
        locked?: boolean;
        metadata?: boolean;
      } = {},
    ) {
      context?.({
        item: {
          uuid: id,
          created_at: options.createdAt,
          isMetadataUpdate: options.metadata,
          content: {
            text,
            title: options.title,
            appData: {
              "org.standardnotes.sn": { locked: options.locked ?? false },
            },
          },
        },
      });
    },
    reply(value: unknown = {}) {
      saves.at(-1)?.callback?.(value);
    },
  };
});

vi.mock("sn-extension-api", () => ({ default: bridge.api }));

afterEach(() => {
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  document.documentElement.removeAttribute("data-environment");
  document.documentElement.removeAttribute("style");
  document.head.replaceChildren();
  document.body.replaceChildren();
  delete window.ReactNativeWebView;
  vi.restoreAllMocks();
});

function save() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
  );
}

describe("Standard Notes editor bridge", () => {
  it("saves explicitly, protects unacknowledged drafts, isolates UUIDs and applies metadata locks", async () => {
    window.ReactNativeWebView = {};
    const root = document.createElement("main");
    root.id = "app";
    document.body.append(root);
    await import("../src/main");
    expect(bridge.api.initialize).toHaveBeenCalledWith({ debounceSave: 0 });
    const view = EditorView.findFromDOM(
      root.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const editor = root.querySelector<HTMLElement>(".aic-editor")!;
    expect(view.state.readOnly).toBe(true);
    expect(editor.dataset.saveState).toBe("unavailable");

    bridge.stream("note-a", "First");
    view.dispatch({ selection: { anchor: 3 } });
    bridge.stream("note-a", "prefix First");
    expect(view.state.selection.main.head).toBe(10);
    bridge.stream("note-a", "First");
    view.dispatch({
      changes: { from: 5, insert: " local" },
      userEvent: "input",
    });
    root.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null }));
    expect(bridge.saves).toHaveLength(0);
    expect(editor.dataset.saveState).toBe("dirty");
    bridge.stream("note-b", "Second");
    bridge.stream("note-a", "First");
    expect(view.state.doc.toString()).toBe("First local");
    save();
    expect(bridge.saves).toHaveLength(1);
    expect(bridge.saves[0]).toMatchObject({
      id: "note-a",
      text: "First local",
      preview: "First local",
    });
    expect(editor.dataset.saveState).toBe("dirty");
    save();
    expect(bridge.saves).toHaveLength(1);
    bridge.stream("note-a", "First");
    expect(view.state.doc.toString()).toBe("First local");
    bridge.stream("note-a", "First local");
    expect(editor.dataset.saveState).toBe("dirty");
    bridge.reply();
    await vi.waitFor(() => expect(editor.dataset.saveState).toBe("saved"));

    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    bridge.stream("note-a", "First local", { locked: true, metadata: true });
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(view.state.doc.toString()).toBe("First local!");
    expect(editor.dataset.saveState).toBe("dirty");
    save();
    expect(bridge.saves).toHaveLength(1);
    bridge.stream("note-a", "First local", { metadata: true });
    expect(view.state.readOnly).toBe(false);
    save();
    bridge.reply({ error: "save-error" });
    await Promise.resolve();
    expect(editor.dataset.saveState).toBe("dirty");
    save();
    bridge.stream("note-b", "Second");
    bridge.reply();
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("Second");
    expect(editor.dataset.saveState).toBe("saved");

    view.dispatch({ changes: { from: 0, to: 6, insert: "Shared" } });
    bridge.stream("note-c", "Shared");
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("Shared");
    bridge.stream("note-empty", "");
    expect(editor.dataset.saveState).toBe("placeholder");

    const documentSource = "---\nstatus: draft\n---\n\n# Document\n";
    bridge.stream("markdown-file", documentSource, {
      title: "documentation.md",
      createdAt: "2026-08-20T10:00:00.000Z",
    });
    const savesBeforeDocument = bridge.saves.length;
    save();
    expect(bridge.saves).toHaveLength(savesBeforeDocument);
    expect(view.state.doc.toString()).toBe(documentSource);
    bridge.stream("markdown-note", "# Note", {
      title: "documentation.note.md",
      createdAt: "2026-08-20T10:00:00.000Z",
    });
    save();
    expect(bridge.saves.at(-1)?.text).toMatch(
      /^---\nfile: documentation\.note\.md\ncreated: 2026-08-20T10:00:00\.000Z\nupdated: .+Z\n---\n\n# Note$/u,
    );
    bridge.reply();
    await vi.waitFor(() => expect(editor.dataset.saveState).toBe("saved"));
  });
});
