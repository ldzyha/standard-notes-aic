import {
  indentLess,
  indentMore,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

function inCode(state, position) {
  for (
    let node = syntaxTree(state).resolve(position, -1);
    node;
    node = node.parent
  ) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return true;
  }
  return false;
}

function hasCodeLanguage(state, position) {
  const tree = syntaxTree(state);
  for (let node = tree.resolveInner(position, -1); node; node = node.parent) {
    if (node.type.isTop && node.type !== tree.type) return true;
  }
  return false;
}

/** Markdown is not a programming-language indentation service. Preserve its
 * literal prefix, while letting fenced languages calculate their own indent. */
export function insertIndentedNewline(view, continueList) {
  const { state } = view;
  if (state.readOnly) return true;
  const ranges = state.selection.ranges;
  if (ranges.every((range) => !inCode(state, range.from))) {
    if (ranges.length === 1 && continueList?.(view)) return true;
    if (insertNewlineContinueMarkup(view)) return true;
  }
  const changes = state.changeByRange((range) => {
    if (inCode(state, range.from) && hasCodeLanguage(state, range.from)) {
      const selected = state.update({
        selection: EditorSelection.create([range]),
      }).state;
      let transaction;
      insertNewlineAndIndent({
        state: selected,
        dispatch: (value) => {
          transaction = value;
        },
      });
      return {
        changes: transaction.changes,
        range: transaction.state.selection.main,
      };
    }
    const line = state.doc.lineAt(range.from);
    const prefix = /^[\t ]*/u.exec(
      line.text.slice(0, range.from - line.from),
    )[0];
    const insert = state.lineBreak + prefix;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + 1 + prefix.length),
    };
  });
  view.dispatch(
    state.update(changes, { scrollIntoView: true, userEvent: "input" }),
  );
  return true;
}

/** Mount before language keymaps. Completion/snippet bindings remain highest
 * priority. CodeMirror's Escape then Tab focus-navigation escape stays native. */
export function editorIndentation({ continueList } = {}) {
  return [
    EditorState.tabSize.of(2),
    indentUnit.of("  "),
    Prec.high(
      keymap.of([
        {
          key: "Enter",
          run: (view) => insertIndentedNewline(view, continueList),
        },
        { key: "Tab", run: indentMore, shift: indentLess },
      ]),
    ),
  ];
}

/** A minimal source edit, shared by code textareas only (not data fields). */
export function codeSourceIndentationEdit(
  text,
  from,
  to,
  key,
  shift = false,
  unit = "  ",
) {
  const lineStart = from === 0 ? 0 : text.lastIndexOf("\n", from - 1) + 1;
  if (key === "Enter") {
    const prefix = /^[\t ]*/u.exec(text.slice(lineStart, from))[0];
    const insert = "\n" + prefix;
    return {
      from,
      to,
      insert,
      anchor: from + insert.length,
      head: from + insert.length,
    };
  }
  if (key !== "Tab") return null;
  const lastPosition = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const newline = text.indexOf("\n", lastPosition);
  const lineEnd = newline < 0 ? text.length : newline;
  const source = text.slice(lineStart, lineEnd);
  let offset = lineStart;
  let anchor = from;
  let head = to;
  const insert = source
    .split("\n")
    .map((line) => {
      const removed = shift
        ? line.startsWith("\t")
          ? 1
          : Math.min(unit.length, /^ */u.exec(line)[0].length)
        : 0;
      const delta = shift ? -removed : unit.length;
      if (from >= offset)
        anchor += shift ? -Math.min(removed, from - offset) : delta;
      if (to >= offset) head += shift ? -Math.min(removed, to - offset) : delta;
      offset += line.length + 1;
      return shift ? line.slice(removed) : unit + line;
    })
    .join("\n");
  return { from: lineStart, to: lineEnd, insert, anchor, head };
}

/** Preserve native textarea Undo where insertText is supported. A DOM-only
 * fallback is used by hosts without that editing command, never whole-document
 * replacement. Consumers receive exactly one input event per handled edit. */
export function wireCodeSourceIndentation(
  textarea,
  { indentUnit: unit = "  " } = {},
) {
  let escapeTab = false;
  const blur = () => {
    escapeTab = false;
  };
  const keydown = (event) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (event.key === "Escape") {
      if (escapeTab) {
        escapeTab = false;
        return;
      }
      escapeTab = true;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Tab" && escapeTab) {
      escapeTab = false;
      return;
    }
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key))
      escapeTab = false;
    if (
      textarea.readOnly ||
      textarea.disabled ||
      !["Enter", "Tab"].includes(event.key)
    )
      return;
    const edit = codeSourceIndentationEdit(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      event.key,
      event.shiftKey,
      unit,
    );
    event.preventDefault();
    if (textarea.value.slice(edit.from, edit.to) === edit.insert) return;
    const before = textarea.value;
    const direction = textarea.selectionDirection;
    // Chromium can emit multiple native input events for one insertText
    // containing a newline. Publish the final value/selection once, after the
    // scoped edit, without replacing its native Undo transaction.
    const input = (nativeEvent) => nativeEvent.stopImmediatePropagation();
    textarea.addEventListener("input", input, true);
    textarea.setSelectionRange(edit.from, edit.to);
    try {
      textarea.ownerDocument.execCommand?.("insertText", false, edit.insert);
    } catch {
      /* Unsupported host: use the scoped fallback below. */
    }
    if (textarea.value === before)
      textarea.setRangeText(edit.insert, edit.from, edit.to, "end");
    textarea.removeEventListener("input", input, true);
    textarea.setSelectionRange(edit.anchor, edit.head, direction);
    textarea.dispatchEvent(
      new textarea.ownerDocument.defaultView.Event("input", {
        bubbles: true,
      }),
    );
  };
  textarea.addEventListener("keydown", keydown);
  textarea.addEventListener("blur", blur);
  return () => {
    textarea.removeEventListener("keydown", keydown);
    textarea.removeEventListener("blur", blur);
  };
}
