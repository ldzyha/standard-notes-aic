import type { KeyBinding } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { planMermaidFenceInsertion } from "./mermaid-source";

export type AicCommand = (view: EditorView) => boolean;
export type ListKind = "bullet" | "ordered" | "task";
export type BlockKind = "paragraph" | "quote" | 1 | 2 | 3 | 4 | 5 | 6;

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

export function setBlockKind(view: EditorView, kind: BlockKind): boolean {
  if (!writable(view)) return false;
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  const changes = [];
  for (let number = first.number; number <= last.number; number++) {
    const line = view.state.doc.line(number);
    const existing = /^(\s{0,3})(?:(#{1,6})|>)\s+/u.exec(line.text);
    const indent = existing?.[1] ?? "";
    const removeTo = line.from + (existing?.[0].length ?? indent.length);
    const prefix =
      kind === "paragraph"
        ? indent
        : kind === "quote"
          ? `${indent}> `
          : `${indent}${"#".repeat(kind)} `;
    changes.push({ from: line.from, to: removeTo, insert: prefix });
  }
  view.dispatch({ changes, userEvent: "input" });
  view.focus();
  return true;
}

type ParsedListLine = {
  indent: string;
  marker: string | null;
  space: string;
  task: string | null;
  content: string;
};

export function parseListLine(text: string): ParsedListLine {
  const match = /^(\s*)(?:([-*+]|\d+[.)])(\s+))?(\[[ xX]\]\s+)?(.*)$/u.exec(
    text,
  );
  if (!match)
    return { indent: "", marker: null, space: " ", task: null, content: text };
  const marker = match[2] ?? null;
  const checkbox = marker ? (match[4] ?? null) : null;
  return {
    indent: match[1] ?? "",
    marker,
    space: match[3] ?? " ",
    task: checkbox,
    content: marker ? (match[5] ?? "") : (match[4] ?? "") + (match[5] ?? ""),
  };
}

function listKind(parsed: ParsedListLine): ListKind | null {
  if (!parsed.marker) return null;
  if (parsed.task) return "task";
  return /^\d/u.test(parsed.marker) ? "ordered" : "bullet";
}

export function toggleList(view: EditorView, kind: ListKind): boolean {
  if (!writable(view)) return false;
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  const lines = [];
  for (let number = first.number; number <= last.number; number++) {
    const line = view.state.doc.line(number);
    if (line.text.trim()) lines.push(line);
  }
  const blankStart = lines.length === 0;
  if (blankStart) lines.push(first);
  const remove = lines.every(
    (line) => listKind(parseListLine(line.text)) === kind,
  );
  let sequence = 1;
  const changes = lines.map((line) => {
    const parsed = parseListLine(line.text);
    const headLength = line.text.length - parsed.content.length;
    const insert = remove
      ? parsed.indent
      : kind === "bullet"
        ? `${parsed.indent}- `
        : kind === "ordered"
          ? `${parsed.indent}${sequence++}. `
          : `${parsed.indent}- ${parsed.task ?? "[ ] "}`;
    return { from: line.from, to: line.from + headLength, insert };
  });
  view.dispatch({
    changes,
    ...(blankStart && !remove
      ? { selection: { anchor: changes[0]!.from + changes[0]!.insert.length } }
      : {}),
    userEvent: "input",
  });
  view.focus();
  return true;
}

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

export function spaceToggleTask(view: EditorView): boolean {
  if (!writable(view)) return false;
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const line = view.state.doc.lineAt(selection.head);
  const match = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/u.exec(line.text);
  if (!match) return false;
  const markerFrom = line.from + match[1]!.length;
  if (selection.head < markerFrom || selection.head > markerFrom + 3)
    return false;
  view.dispatch({
    changes: {
      from: markerFrom + 1,
      to: markerFrom + 2,
      insert: match[2] === " " ? "x" : " ",
    },
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

function blockSpacing(document: string, from: number, to: number) {
  return {
    before: from > 0 && document[from - 1] !== "\n" ? "\n" : "",
    after: to < document.length && document[to] !== "\n" ? "\n" : "",
  };
}

function insertBlock(
  view: EditorView,
  body: string,
  cursorOffset: number,
): boolean {
  if (!writable(view)) return false;
  const { from, to } = view.state.selection.main;
  const document = view.state.doc.toString();
  const { before, after } = blockSpacing(document, from, to);
  const insert = `${before}${body}${after}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + before.length + cursorOffset },
    userEvent: "input",
  });
  view.focus();
  return true;
}

export const insertTable: AicCommand = (view) => {
  const body = "| Column 1 | Column 2 |\n| --- | --- |\n| value | value |";
  return insertBlock(view, body, body.indexOf("Column 1"));
};

export const insertProperties: AicCommand = (view) => {
  if (!writable(view)) return false;
  const document = view.state.doc.toString();
  if (document.startsWith("---\n")) {
    const closing = document.indexOf("\n---", 4);
    if (closing >= 0) {
      view.dispatch({ selection: { anchor: 4 }, scrollIntoView: true });
      view.focus();
      return true;
    }
  }
  const body = "---\nstatus: idea\ntags: \n---\n\n";
  view.dispatch({
    changes: { from: 0, insert: body },
    selection: { anchor: body.indexOf("idea") },
    userEvent: "input",
  });
  view.focus();
  return true;
};

export const insertCodeFence: AicCommand = (view) => {
  if (!writable(view)) return false;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  let longest = 0;
  for (const line of selected.split("\n")) {
    const match = line.match(/^[ \t]*(`+)/u);
    if (match?.[1]) longest = Math.max(longest, match[1].length);
  }
  const fence = "`".repeat(Math.max(3, longest + 1));
  const source = selected || "code";
  const body = `${fence}text\n${source}${source.endsWith("\n") ? "" : "\n"}${fence}`;
  return insertBlock(view, body, body.indexOf("text"));
};

export const insertMermaid: AicCommand = (view) => {
  if (!writable(view)) return false;
  const selection = view.state.selection.main;
  const plan = planMermaidFenceInsertion({
    doc: view.state.doc.toString(),
    from: selection.from,
    to: selection.to,
  });
  view.dispatch({
    changes: plan.changes,
    selection: plan.selection,
    userEvent: "input",
  });
  view.focus();
  return true;
};

export const insertHorizontalRule: AicCommand = (view) =>
  insertBlock(view, "---", 3);

export const aicKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-Shift-7", run: (view) => toggleList(view, "ordered") },
  { key: "Mod-Shift-8", run: (view) => toggleList(view, "bullet") },
  { key: "Mod-Shift-9", run: (view) => toggleList(view, "task") },
  { key: "Enter", run: continueList },
  { key: " ", run: spaceToggleTask },
];
