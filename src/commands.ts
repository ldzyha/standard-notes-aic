import type { KeyBinding } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { parseListLine } from "./core/formatting.js";

export { parseListLine, setBlockKind, toggleList } from "./core/formatting.js";
export type { BlockKind, ListKind } from "./core/formatting.js";

export type AicCommand = (view: EditorView) => boolean;

function writable(view: EditorView): boolean {
  return !view.state.readOnly;
}

export function toggleWrap(view: EditorView, marker: string): boolean {
  if (!writable(view)) return false;
  let { from, to } = view.state.selection.main;
  if (from === to) {
    const line = view.state.doc.lineAt(from);
    let start = from - line.from;
    let end = start;
    const stop = (value: string | undefined) =>
      value == null ||
      !/\S/u.test(value) ||
      marker.includes(value) ||
      /[.,;:!?)\]]/u.test(value);
    while (start > 0 && !stop(line.text[start - 1])) start--;
    while (end < line.text.length && !stop(line.text[end])) end++;
    if (end > start) {
      from = line.from + start;
      to = line.from + end;
    }
  }
  const size = marker.length;
  const before = view.state.sliceDoc(Math.max(0, from - size), from);
  const after = view.state.sliceDoc(
    to,
    Math.min(view.state.doc.length, to + size),
  );
  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: from - size, to: from },
        { from: to, to: to + size },
      ],
      userEvent: "input",
    });
  } else {
    view.dispatch({
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      selection: { anchor: from + size, head: to + size },
      userEvent: "input",
    });
  }
  view.focus();
  return true;
}

export const toggleBold: AicCommand = (view) => toggleWrap(view, "**");
export const toggleItalic: AicCommand = (view) => toggleWrap(view, "*");
export const toggleStrike: AicCommand = (view) => toggleWrap(view, "~~");
export const toggleInlineCode: AicCommand = (view) => toggleWrap(view, "`");

function renumberAfter(
  view: EditorView,
  lineNumber: number,
  sequence: number,
  indent: string,
) {
  const changes = [];
  for (let number = lineNumber + 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    const match = /^(\s*)(\d+)([.)])\s/u.exec(line.text);
    if (!match || match[1] !== indent) break;
    const digits = match[2]!;
    if (Number.parseInt(digits, 10) !== sequence) {
      changes.push({
        from: line.from + indent.length,
        to: line.from + indent.length + digits.length,
        insert: String(sequence),
      });
    }
    sequence++;
  }
  return changes;
}

export function continueList(view: EditorView): boolean {
  if (!writable(view)) return false;
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const line = view.state.doc.lineAt(selection.head);
  const parsed = parseListLine(line.text);
  if (!parsed.marker) return false;
  const contentStart = line.from + line.text.length - parsed.content.length;
  if (selection.head < contentStart) return false;
  if (!parsed.content.trim()) {
    view.dispatch({
      changes: { from: line.from + parsed.indent.length, to: line.to },
      userEvent: "delete",
    });
    return true;
  }
  const ordered = /^\d/u.test(parsed.marker);
  let nextMarker = `${parsed.indent}${parsed.marker}${parsed.space}`;
  let sequence = 0;
  if (ordered) {
    sequence = Number.parseInt(parsed.marker, 10) + 1;
    nextMarker = `${parsed.indent}${sequence}${parsed.marker.endsWith(")") ? ")" : "."}${parsed.space}`;
  }
  if (parsed.task) nextMarker += "[ ] ";
  const insert = `\n${nextMarker}`;
  const changes = [{ from: selection.head, insert }];
  if (ordered)
    changes.push(
      ...renumberAfter(view, line.number, sequence + 1, parsed.indent),
    );
  view.dispatch({
    changes,
    selection: { anchor: selection.head + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

export const insertLink: AicCommand = (view) => {
  if (!writable(view)) return false;
  const { from, to } = view.state.selection.main;
  const selection = view.state.sliceDoc(from, to);
  const replacement = `[${selection || "link"}]()`;
  view.dispatch({
    changes: { from, to, insert: replacement },
    selection: { anchor: from + replacement.length - 1 },
    userEvent: "input",
  });
  view.focus();
  return true;
};

export const aicKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-k", run: insertLink },
  { key: "Enter", run: continueList },
];
