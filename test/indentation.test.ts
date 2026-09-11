import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  undo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { snippet } from "@codemirror/autocomplete";
import { continueList } from "../src/commands";
import { AicEditor } from "../src/editor";
import {
  codeSourceIndentationEdit,
  editorIndentation,
  wireCodeSourceIndentation,
} from "../src/core/indentation.js";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});
function editor(text: string, readOnly = false) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: [
        EditorState.readOnly.of(readOnly),
        EditorState.allowMultipleSelections.of(true),
        editorIndentation({ continueList }),
        markdown({
          codeLanguages: (info) =>
            info === "js" ? javascript().language : null,
        }),
        history(),
        keymap.of([...historyKeymap, ...defaultKeymap]),
      ],
    }),
  });
  views.push(view);
  return view;
}
const press = (view: EditorView, key: string, shiftKey = false) =>
  runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key, shiftKey, cancelable: true }),
    "editor",
  );

describe("shared editor indentation", () => {
  it.each(["  raw text", "\t\ttext", "    "])(
    "keeps the literal prefix of %j",
    (source) => {
      const view = editor(source);
      press(view, "Enter");
      expect(view.state.doc.toString()).toBe(
        source + "\n" + /^[\t ]*/u.exec(source)![0],
      );
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    },
  );
  it.each([
    ["  - task", "  - task\n  - "],
    ["  - [x] task", "  - [x] task\n  - [ ] "],
    ["  1. item", "  1. item\n  2. "],
    ["  - ", "  "],
    ["> quote", "> quote\n> "],
  ])("continues Markdown markup %j", (source, expected) => {
    const view = editor(source);
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe(expected);
  });
  it("uses the fenced language indentation and does not continue list-looking code", () => {
    const view = editor("```js\nif (true) {\n```\n");
    view.dispatch({ selection: { anchor: 17 } });
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("```js\nif (true) {\n  \n```\n");
    const code = editor("```text\n  - code\n```\n");
    code.dispatch({ selection: { anchor: 16 } });
    press(code, "Enter");
    expect(code.state.doc.toString()).toBe("```text\n  - code\n  \n```\n");
  });
  it("inserts a newline at each caret without discarding secondary selections", () => {
    const view = editor("  one\n    two");
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(5),
        EditorSelection.cursor(13),
      ]),
    });
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("  one\n  \n    two\n    ");
    expect(view.state.selection.ranges).toHaveLength(2);
  });
  it("preserves indentation in unknown fenced languages including Mermaid", () => {
    const view = editor("```mermaid\ngraph TD\n    A --> B\n```\n");
    const end = view.state.doc.toString().indexOf("B") + 1;
    view.dispatch({ selection: { anchor: end } });
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe(
      "```mermaid\ngraph TD\n    A --> B\n    \n```\n",
    );
  });
  it("indents selected lines, excludes an end-at-next-line boundary and outdents symmetrically", () => {
    const view = editor("one\ntwo\nthree");
    view.dispatch({ selection: { anchor: 0, head: 8 } });
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("  one\n  two\nthree");
    press(view, "Tab", true);
    expect(view.state.doc.toString()).toBe("one\ntwo\nthree");
  });
  it("nests the current list item with Tab", () => {
    const view = editor("- one");
    press(view, "Tab");
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("  - one\n  - ");
  });
  it("leaves snippet field navigation ahead of indentation", () => {
    const view = editor("");
    snippet("${first} and ${second} then ${third}")(view, null, 0, 0);
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("first and second then third");
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("second");
    press(view, "Tab", true);
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("first");
  });
  it("does not edit read-only content", () => {
    const view = editor("  - one", true);
    press(view, "Enter");
    press(view, "Tab");
    press(view, "Tab", true);
    expect(view.state.doc.toString()).toBe("  - one");
  });
  it("is actually mounted before the Standard Notes Markdown keymap", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const aic = new AicEditor(host, { initialText: "  text" });
    aic.view.dispatch({ selection: { anchor: 6 } });
    press(aic.view, "Enter");
    press(aic.view, "Tab");
    expect(aic.value).toBe("  text\n    ");
    aic.destroy();
  });
});

describe("code source textarea indentation", () => {
  function source(text: string) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.append(textarea);
    textarea.focus();
    textarea.setSelectionRange(text.length, text.length);
    const dispose = wireCodeSourceIndentation(textarea);
    const input = vi.fn();
    textarea.addEventListener("input", input);
    return { textarea, dispose, input };
  }
  function key(textarea: HTMLTextAreaElement, key: string, shiftKey = false) {
    const event = new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);
    return event;
  }
  it("preserves source indentation, emits one input, and supports a selected multiline indent", () => {
    const { textarea, input } = source("graph TD\n  A --> B");
    key(textarea, "Enter");
    expect(textarea.value).toBe("graph TD\n  A --> B\n  ");
    expect(input).toHaveBeenCalledTimes(1);
    textarea.setSelectionRange(9, textarea.value.length);
    key(textarea, "Tab");
    expect(textarea.value).toBe("graph TD\n    A --> B\n    ");
    key(textarea, "Tab", true);
    expect(textarea.value).toBe("graph TD\n  A --> B\n  ");
    expect(input).toHaveBeenCalledTimes(3);
  });
  it("preserves reversed selection and excludes the next line at a boundary", () => {
    const { textarea } = source("one\ntwo\nthree");
    textarea.setSelectionRange(0, 8, "backward");
    key(textarea, "Tab");
    expect(textarea.value).toBe("  one\n  two\nthree");
    expect(textarea.selectionDirection).toBe("backward");
    expect(textarea.selectionEnd).toBe(12);
    key(textarea, "Tab", true);
    expect(textarea.value).toBe("one\ntwo\nthree");
  });
  it("keeps Escape inside the dialog and releases the next Tab", () => {
    const { textarea } = source("  x");
    expect(key(textarea, "Escape").defaultPrevented).toBe(true);
    expect(key(textarea, "Tab").defaultPrevented).toBe(false);
    expect(textarea.value).toBe("  x");
    expect(key(textarea, "Tab").defaultPrevented).toBe(true);
    expect(key(textarea, "Escape").defaultPrevented).toBe(true);
    expect(key(textarea, "Escape").defaultPrevented).toBe(false);
  });
  it("ignores read-only fields, unrelated controls, modified keys and disposed handlers", () => {
    const { textarea, dispose, input } = source("  x");
    textarea.readOnly = true;
    expect(key(textarea, "Tab").defaultPrevented).toBe(false);
    textarea.readOnly = false;
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    dispose();
    expect(key(textarea, "Enter").defaultPrevented).toBe(false);
    expect(input).not.toHaveBeenCalled();
    const property = document.createElement("textarea");
    document.body.append(property);
    expect(key(property, "Tab").defaultPrevented).toBe(false);
  });
  it("outdents mixed spaces/tabs and leaves an unindented line untouched", () => {
    expect(
      codeSourceIndentationEdit("\tfirst\n second\nthird", 0, 20, "Tab", true)
        ?.insert,
    ).toBe("first\nsecond\nthird");
  });
  it("indents an empty first line without moving into the second line", () => {
    expect(codeSourceIndentationEdit("\nnext", 0, 0, "Tab")).toEqual({
      from: 0,
      to: 0,
      insert: "  ",
      anchor: 2,
      head: 2,
    });
  });
  it("publishes the completed edit once even if native insertText emits twice", () => {
    const original = document.execCommand;
    const { textarea, input } = source("  text");
    document.execCommand = vi.fn((_command, _ui, text) => {
      textarea.setRangeText(
        text!,
        textarea.selectionStart,
        textarea.selectionEnd,
        "end",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    try {
      key(textarea, "Enter");
      expect(input).toHaveBeenCalledTimes(1);
      expect(textarea.value).toBe("  text\n  ");
      expect(textarea.selectionStart).toBe(9);
    } finally {
      document.execCommand = original;
    }
  });
});
