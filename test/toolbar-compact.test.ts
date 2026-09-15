import { afterEach, describe, expect, it } from "vitest";
import { AicEditor } from "../src/editor";

const editors: AicEditor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});

function mount(options: ConstructorParameters<typeof AicEditor>[1] = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new AicEditor(host, options);
  editors.push(editor);
  return editor;
}
const actions = (editor: AicEditor) => [
  ...editor.toolbar.element.querySelectorAll<HTMLButtonElement>(
    ".aic-toolbar-group button",
  ),
];

const visibleButtonLabels = (editor: AicEditor) =>
  [...editor.toolbar.element.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => !button.hidden)
    .map((button) => button.getAttribute("aria-label"));

describe("compact toolbar", () => {
  it("uses the compact seven-button Standard Notes surface by default", () => {
    const editor = mount();
    const toolbar = editor.toolbar.element;
    expect(toolbar.classList.contains("aic-toolbar--compact")).toBe(true);
    expect(visibleButtonLabels(editor)).toEqual([
      "Show Markdown source",
      "Strikethrough",
      "Insert link (Ctrl/Command+K)",
      "Bullet list",
      "Ordered list",
      "Task list",
      "AIC editor guide",
    ]);
    expect(
      toolbar.querySelectorAll(":scope > .aic-toolbar-group"),
    ).toHaveLength(2);
    expect(toolbar.querySelector("select,.aic-toolbar-tray")).toBeNull();
    const guide = toolbar.querySelector<HTMLButtonElement>(
      ".aic-editor-help-toggle",
    )!;
    expect(guide.getAttribute("aria-label")).toBe("AIC editor guide");
    expect(guide.disabled).toBe(false);
    guide.click();
    expect(guide.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelector(".aic-editor-help-popover")?.textContent,
    ).toContain("Standard Notes owns its account encryption");
  });

  it("lets browser hosts omit the duplicate local guide", () => {
    const editor = mount({ showEditorHelp: false });
    expect(visibleButtonLabels(editor)).toEqual([
      "Show Markdown source",
      "Strikethrough",
      "Insert link (Ctrl/Command+K)",
      "Bullet list",
      "Ordered list",
      "Task list",
    ]);
    expect(editor.element.querySelector(".aic-editor-help-toggle")).toBeNull();
    expect(editor.element.querySelector(".aic-editor-help-popover")).toBeNull();
  });

  it("shows only five direct formatting actions with no selectors or disclosure", () => {
    const editor = mount();
    expect(
      actions(editor).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Strikethrough",
      "Insert link (Ctrl/Command+K)",
      "Bullet list",
      "Ordered list",
      "Task list",
    ]);
    expect(
      editor.toolbar.element.querySelector(
        "select,.aic-formatting-toggle,.aic-toolbar-tray",
      ),
    ).toBeNull();
    for (const button of actions(editor)) {
      expect(button.title).toBe(button.getAttribute("aria-label"));
      expect(button.dataset.aicIcon).toBeTruthy();
    }
  });

  it.each([
    ["Strikethrough", "~~hello~~ world"],
    ["Insert link (Ctrl/Command+K)", "[hello]() world"],
    ["Bullet list", "- hello world"],
    ["Ordered list", "1. hello world"],
    ["Task list", "- [ ] hello world"],
  ])(
    "%s works on the selection without replacing the editor",
    (label, expected) => {
      const editor = mount({
        initialText: "hello world",
      });
      const view = editor.view;
      view.dispatch({ selection: { anchor: 0, head: 5 } });
      const button = actions(editor).find(
        (item) => item.getAttribute("aria-label") === label,
      )!;
      const pointer = new Event("pointerdown", {
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(pointer);
      expect(pointer.defaultPrevented).toBe(true);
      button.click();
      expect(editor.value).toBe(expected);
      expect(editor.view).toBe(view);
    },
  );

  it("retains keyboard formatting that is no longer duplicated by buttons", () => {
    const editor = mount({ initialText: "hello" });
    editor.view.dispatch({ selection: { anchor: 0, head: 5 } });
    editor.view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor.value).toBe("**hello**");
  });

  it("reflects save states without displacing the compact formatting actions", () => {
    const editor = mount({ initialText: "word", onSave: () => true });
    const save =
      editor.toolbar.element.querySelector<HTMLButtonElement>(
        ".aic-save-button",
      )!;
    const status =
      editor.toolbar.element.querySelector<HTMLElement>(".aic-save-status")!;

    expect(save.hidden).toBe(true);
    expect(visibleButtonLabels(editor)).toHaveLength(7);

    editor.setSaveState("dirty", false, "dirty");
    expect(save.hidden).toBe(false);
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("aria-label")).toBe("Save note");
    expect(status.textContent).toBe("Unsaved changes");
    expect(visibleButtonLabels(editor)).toHaveLength(8);

    editor.setSaveState("dirty", true, "saving");
    expect(save.disabled).toBe(true);
    expect(status.textContent).toBe("Saving note…");

    editor.setSaveState("saved", false, "saved");
    expect(save.hidden).toBe(true);
    expect(status.textContent).toBe("Note saved");
    expect(visibleButtonLabels(editor)).toHaveLength(7);

    editor.setSaveState("dirty", false, "failed");
    expect(save.hidden).toBe(false);
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("aria-label")).toBe("Retry save");
    expect(status.textContent).toBe("Note not saved. Retry save.");
  });

  it("keeps source and local help accessible while read-only", () => {
    const editor = mount({
      initialText: "word",
      readOnly: true,
      onSave: () => true,
    });
    const toolbar = editor.toolbar.element;
    const source = toolbar.querySelector<HTMLButtonElement>(
      ".aic-source-mode-toggle",
    )!;
    expect(source.parentElement).toBe(toolbar);
    expect(toolbar.querySelector(".aic-save-controls")?.parentElement).toBe(
      toolbar,
    );
    const guide = toolbar.querySelector<HTMLButtonElement>(
      ".aic-editor-help-toggle",
    )!;
    expect(source.disabled).toBe(false);
    expect(guide.disabled).toBe(false);
    expect(actions(editor).every((button) => button.disabled)).toBe(true);
    editor.setSaveState("dirty", false, "dirty");
    expect(
      toolbar.querySelector<HTMLButtonElement>(".aic-save-button")!.disabled,
    ).toBe(true);
    source.click();
    expect(source.getAttribute("aria-pressed")).toBe("true");
    expect(editor.value).toBe("word");
    guide.click();
    expect(guide.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.tagName).toBe("H2");
    expect(editor.setReadOnly(false)).toBe(true);
    expect(actions(editor).every((button) => !button.disabled)).toBe(true);
  });
});
