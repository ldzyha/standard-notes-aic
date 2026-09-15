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

describe("optional compact toolbar", () => {
  it("keeps the existing Standard Notes toolbar structure by default", () => {
    const toolbar = mount().toolbar.element;
    expect(toolbar.classList.contains("aic-toolbar--compact")).toBe(false);
    expect(
      toolbar.querySelectorAll(":scope > .aic-toolbar-group"),
    ).toHaveLength(4);
    expect(toolbar.querySelectorAll("select")).toHaveLength(2);
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

  it("keeps the local guide accessible while the note is read-only", () => {
    const editor = mount({ readOnly: true });
    const guide = editor.toolbar.element.querySelector<HTMLButtonElement>(
      ".aic-editor-help-toggle",
    )!;
    expect(guide.disabled).toBe(false);
    guide.click();
    expect(guide.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.tagName).toBe("H2");
  });

  it("shows only five direct formatting actions with no selectors or disclosure", () => {
    const editor = mount({ compactToolbar: true });
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
    expect(
      editor.toolbar.element.querySelector(".aic-editor-help-toggle"),
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
        compactToolbar: true,
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
    const editor = mount({ compactToolbar: true, initialText: "hello" });
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

  it("keeps source accessible and disables mutation actions while read-only", () => {
    const editor = mount({
      compactToolbar: true,
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
    expect(source.disabled).toBe(false);
    expect(actions(editor).every((button) => button.disabled)).toBe(true);
    source.click();
    expect(source.getAttribute("aria-pressed")).toBe("true");
    expect(editor.value).toBe("word");
    expect(editor.setReadOnly(false)).toBe(true);
    expect(actions(editor).every((button) => !button.disabled)).toBe(true);
  });
});
