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
  it("does not automatically retry a failed pending save after a note switch", async () => {
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

    bridge.stream("note-a", "A");
    view.dispatch({ changes: { from: 1, insert: " draft" } });
    save();
    expect(bridge.saves).toHaveLength(1);
    bridge.stream("note-b", "B");
    expect(view.state.doc.toString()).toBe("B");

    bridge.reply({ error: "save-error" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.saves).toHaveLength(1);
    bridge.stream("note-a", "A");
    expect(view.state.doc.toString()).toBe("A draft");
    expect(editor.dataset.saveFeedback).toBe("failed");
    const retry = root.querySelector<HTMLButtonElement>(".aic-save-button")!;
    expect(retry.getAttribute("aria-label")).toBe("Retry save");
    expect(retry.disabled).toBe(false);
    expect(bridge.saves).toHaveLength(1);

    retry.click();
    expect(bridge.saves).toHaveLength(2);
    expect(bridge.saves[1]).toMatchObject({ id: "note-a", text: "A draft" });
    bridge.reply();
    await vi.waitFor(() => expect(editor.dataset.saveState).toBe("saved"));
  });

  it("starts a dirty old-note save before a direct context switch", async () => {
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
    bridge.stream("note-a", "A");
    view.dispatch({ changes: { from: 1, insert: " draft" } });
    expect(bridge.saves).toHaveLength(0);
    bridge.stream("note-b", "B");
    expect(bridge.saves).toHaveLength(1);
    expect(bridge.saves[0]).toMatchObject({ id: "note-a", text: "A draft" });
    expect(view.state.doc.toString()).toBe("B");
    bridge.reply();
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("B");
    bridge.stream("note-a", "A draft");
    expect(view.state.doc.toString()).toBe("A draft");
    expect(
      root.querySelector<HTMLElement>(".aic-editor")?.dataset.saveState,
    ).toBe("saved");
  });

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
    expect(converted).toContain("```aic\n");
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
    expect(
      root.querySelector('.cm-aic-security-import-bar [role="status"]')
        ?.textContent,
    ).toContain("Saving note");
    bridge.stream("synthetic-authenticator", source);
    expect(view.state.doc.toString()).toBe(converted);
    bridge.reply({ error: "save-error" });
    await vi.waitFor(() =>
      expect(
        root.querySelector('.cm-aic-security-import-bar [role="status"]')
          ?.textContent,
      ).toContain("Note not saved. Keep it open and retry."),
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
      expect(
        root.querySelector('.cm-aic-security-import-bar [role="status"]')
          ?.textContent,
      ).toContain("not saved"),
    );

    bridge.stream("other-synthetic-note", "Other note");
    bridge.stream("synthetic-authenticator", source);
    expect(view.state.doc.toString()).toBe(converted);
    expect(root.querySelectorAll(".cm-aic-security")).toHaveLength(1);
    const touchSave =
      root.querySelector<HTMLButtonElement>(".aic-save-button")!;
    expect(touchSave.getAttribute("aria-label")).toBe("Retry save");
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
    const documentBeforeAck = view.state.doc;
    bridge.reply();
    await vi.waitFor(() => expect(editor.dataset.saveState).toBe("saved"));
    expect(view.state.doc).toBe(documentBeforeAck);
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
    const status = () =>
      root.querySelector('.cm-aic-security-import-bar [role="status"]')
        ?.textContent;
    await vi.waitFor(() => expect(status()).toContain("not saved"));
    const touchSave =
      root.querySelector<HTMLButtonElement>(".aic-save-button")!;
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

  it("saves on editor exit, coalesces the latest old-note draft across a switch, and respects locks", async () => {
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
    view.dispatch({
      changes: { from: 5, insert: " local" },
      userEvent: "input",
    });
    expect(bridge.saves).toHaveLength(0);
    expect(editor.dataset.saveState).toBe("dirty");
    expect(root.querySelector(".aic-save-status")?.textContent).toBe("");
    expect(
      root
        .querySelector(".aic-save-button.aic-button--unsaved")
        ?.getAttribute("aria-description"),
    ).toBe("Unsaved changes");
    editor.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null }));
    expect(bridge.saves).toHaveLength(1);
    expect(bridge.saves[0]).toMatchObject({
      id: "note-a",
      text: "First local",
    });
    expect(editor.dataset.saveState).toBe("dirty");
    expect(root.querySelector(".aic-save-status")?.textContent).toBe(
      "Saving note…",
    );
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    const latestA = view.state.doc.toString();
    expect(bridge.saves).toHaveLength(1);
    bridge.stream("note-b", "Second");
    expect(view.state.doc.toString()).toBe("Second");
    expect(editor.dataset.saveState).toBe("saved");
    bridge.reply();
    await vi.waitFor(() => expect(bridge.saves).toHaveLength(2));
    expect(bridge.saves[1]).toMatchObject({ id: "note-a", text: latestA });
    expect(view.state.doc.toString()).toBe("Second");
    bridge.reply();
    await Promise.resolve();
    bridge.stream("note-a", latestA);
    expect(view.state.doc.toString()).toBe(latestA);
    expect(editor.dataset.saveState).toBe("saved");

    view.dispatch({
      changes: { from: view.state.doc.length, insert: " more" },
    });
    bridge.stream("note-a", latestA, { locked: true, metadata: true });
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
    expect(view.state.doc.toString()).toBe(latestA + " more");
    expect(editor.dataset.saveState).toBe("dirty");
    save();
    expect(bridge.saves).toHaveLength(2);
    bridge.stream("note-a", latestA, { metadata: true });
    expect(view.state.readOnly).toBe(false);
    save();
    expect(bridge.saves).toHaveLength(3);
    expect(bridge.saves[2]).toMatchObject({
      id: "note-a",
      text: latestA + " more",
    });
    bridge.reply({ error: "save-error" });
    await vi.waitFor(() => expect(editor.dataset.saveFeedback).toBe("failed"));
    expect(editor.dataset.saveState).toBe("dirty");
    expect(
      root.querySelector(".aic-save-button")?.getAttribute("aria-label"),
    ).toBe("Retry save");
    editor.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null }));
    expect(bridge.saves).toHaveLength(3);
    root.querySelector<HTMLButtonElement>(".aic-save-button")!.click();
    expect(bridge.saves).toHaveLength(4);
    bridge.reply();
    await vi.waitFor(() => expect(editor.dataset.saveState).toBe("saved"));

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
    bridge.stream("locked-markdown-note", "# Locked", {
      title: "documentation.note.md",
      createdAt: "2026-08-20T10:00:00.000Z",
      locked: true,
    });
    const savesBeforeLocked = bridge.saves.length;
    save();
    expect(bridge.saves).toHaveLength(savesBeforeLocked);
    expect(view.state.doc.toString()).toBe("# Locked");
    bridge.stream("markdown-note", "# Note", {
      title: "documentation.note.md",
      createdAt: "2026-08-20T10:00:00.000Z",
    });
    const savesBeforeNote = bridge.saves.length;
    save();
    expect(bridge.saves).toHaveLength(savesBeforeNote);
    expect(view.state.doc.toString()).toBe("# Note");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " edited" },
    });
    save();
    expect(bridge.saves.at(-1)?.text).toBe("# Note edited");
    bridge.reply();
    await vi.waitFor(() => expect(editor.dataset.saveState).toBe("saved"));

    // Even a managed-name legacy document is never stamped or converted on save.
    bridge.stream("old-managed-note", documentSource, { title: "old.note.md" });
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "Only this edit" },
    });
    save();
    expect(bridge.saves.at(-1)?.text).toBe(documentSource + "Only this edit");
    bridge.reply();
    await vi.waitFor(() => expect(editor.dataset.saveState).toBe("saved"));
  });
});
