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
    clear() {
      context?.({ item: null });
    },
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
  it("explicitly converts and saves security blocks, retries a failed save and reopens the saved Markdown", async () => {
    vi.resetModules();
    bridge.saves.length = 0;
    window.ReactNativeWebView = {};
    const root = document.createElement("main");
    root.id = "app";
    document.body.append(root);
    await import("../src/main");
    const view = EditorView.findFromDOM(
      root.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const editor = root.querySelector<HTMLElement>(".aic-editor")!;
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const password = "SYNTHETIC-IMPORT-PASSWORD";
    const source = JSON.stringify([
      {
        service: "Synthetic service",
        account: "synthetic@example.invalid",
        secret,
        password,
      },
    ]);

    bridge.stream("synthetic-authenticator", source);
    expect(view.state.doc.toString()).toBe(source);
    view.dispatch({ changes: { from: source.length, insert: "\n" } });
    root.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null }));
    expect(bridge.saves).toHaveLength(0);
    root
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Convert and save security blocks"]',
      )!
      .click();
    const converted = view.state.doc.toString();
    expect(converted).toContain("```aic-security");
    expect(converted).not.toBe(source);
    expect(root.querySelectorAll(".cm-aic-security")).toHaveLength(1);
    expect(root.innerHTML).not.toContain(secret);
    expect(root.innerHTML).not.toContain(password);
    expect(editor.dataset.saveState).toBe("dirty");
    expect(bridge.saves).toHaveLength(1);
    expect(bridge.saves[0]).toMatchObject({
      id: "synthetic-authenticator",
      text: converted,
    });
    expect(bridge.saves[0]!.preview).not.toContain(secret);
    expect(bridge.saves[0]!.preview).not.toContain(password);
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      "Saving note",
    );
    bridge.stream("synthetic-authenticator", source);
    expect(view.state.doc.toString()).toBe(converted);
    bridge.reply({ error: "save-error" });
    await vi.waitFor(() =>
      expect(root.querySelector('[role="status"]')?.textContent).toContain(
        "Note not saved. Keep it open and retry.",
      ),
    );
    expect(editor.dataset.saveState).toBe("dirty");
    root.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null }));
    expect(bridge.saves).toHaveLength(1);
    root
      .querySelector<HTMLButtonElement>('button[aria-label="Retry save"]')!
      .click();
    expect(bridge.saves).toHaveLength(2);
    expect(bridge.saves[1]!.text).toBe(converted);
    expect(view.state.doc.toString()).toBe(converted);
    expect(root.querySelectorAll(".cm-aic-security")).toHaveLength(1);
    bridge.reply({ error: "save-error" });
    await vi.waitFor(() =>
      expect(root.querySelector('[role="status"]')?.textContent).toContain(
        "not saved",
      ),
    );

    bridge.stream("other-synthetic-note", "Other note");
    bridge.stream("synthetic-authenticator", source);
    expect(view.state.doc.toString()).toBe(converted);
    expect(root.querySelectorAll(".cm-aic-security")).toHaveLength(1);
    expect(root.querySelector('[aria-label="Retry save"]')).toBeNull();
    const touchSave = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Save note"]',
    )!;
    expect(touchSave.hidden).toBe(false);
    expect(touchSave.disabled).toBe(false);
    bridge.stream("synthetic-authenticator", source, {
      locked: true,
      metadata: true,
    });
    expect(touchSave.disabled).toBe(true);
    touchSave.click();
    expect(bridge.saves).toHaveLength(2);
    bridge.stream("synthetic-authenticator", source, { metadata: true });
    expect(touchSave.disabled).toBe(false);
    touchSave.click();
    expect(bridge.saves).toHaveLength(3);
    expect(bridge.saves[2]!.text).toBe(converted);
    expect(touchSave.disabled).toBe(true);
    bridge.reply({ error: "save-error" });
    await vi.waitFor(() => expect(touchSave.disabled).toBe(false));
    expect(touchSave.hidden).toBe(false);
    expect(editor.dataset.saveState).toBe("dirty");
    touchSave.click();
    expect(bridge.saves).toHaveLength(4);
    expect(bridge.saves[3]!.text).toBe(converted);
    bridge.reply();
    await vi.waitFor(() => expect(editor.dataset.saveState).toBe("saved"));
    expect(touchSave.hidden).toBe(true);

    bridge.stream("other-synthetic-note", "Other note");
    bridge.stream("synthetic-authenticator", bridge.saves[3]!.text);
    expect(view.state.doc.toString()).toBe(converted);
    expect(root.querySelectorAll(".cm-aic-security")).toHaveLength(1);
    expect(root.innerHTML).not.toContain(secret);
    expect(root.innerHTML).not.toContain(password);
    expect(editor.dataset.saveState).toBe("saved");
  });

  it("keeps newer edits dirty and clears failed-conversion feedback after a toolbar save is acknowledged", async () => {
    vi.resetModules();
    bridge.saves.length = 0;
    window.ReactNativeWebView = {};
    const root = document.createElement("main");
    root.id = "app";
    document.body.append(root);
    await import("../src/main");
    const view = EditorView.findFromDOM(
      root.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    const editor = root.querySelector<HTMLElement>(".aic-editor")!;
    bridge.stream(
      "synthetic-delayed-save",
      JSON.stringify([
        { service: "Synthetic", account: "fixture", secret: "MZXW6YTB" },
      ]),
    );
    root
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Convert and save security blocks"]',
      )!
      .click();
    bridge.reply({ error: "save-error" });
    const status = () => root.querySelector('[role="status"]')?.textContent;
    await vi.waitFor(() => expect(status()).toContain("not saved"));
    const touchSave = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Save note"]',
    )!;
    touchSave.click();
    expect(bridge.saves).toHaveLength(2);
    expect(touchSave.disabled).toBe(true);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\nNew local edit" },
    });
    const newerDraft = view.state.doc.toString();
    expect(bridge.saves).toHaveLength(2);
    bridge.reply();
    await vi.waitFor(() => expect(touchSave.disabled).toBe(false));
    expect(editor.dataset.saveState).toBe("dirty");
    expect(touchSave.hidden).toBe(false);
    expect(view.state.doc.toString()).toBe(newerDraft);
    expect(status()).toContain("not saved");

    touchSave.click();
    expect(bridge.saves).toHaveLength(3);
    expect(bridge.saves[2]!.text).toBe(newerDraft);
    bridge.reply();
    await vi.waitFor(() => expect(status()).toBe("Note saved"));
    expect(editor.dataset.saveState).toBe("saved");
    expect(touchSave.hidden).toBe(true);
    expect(root.querySelector('[aria-label="Retry save"]')).toBeNull();
  });

  it("saves explicitly, protects unacknowledged drafts, isolates UUIDs and applies metadata locks", async () => {
    vi.resetModules();
    bridge.saves.length = 0;
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
    bridge.clear();
    expect(view.state.readOnly).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    expect(editor.dataset.saveState).toBe("unavailable");
    save();
    expect(bridge.saves).toHaveLength(0);
    bridge.stream("note-a", "First");
    expect(view.state.doc.toString()).toBe("First local");
    expect(view.state.readOnly).toBe(false);
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
