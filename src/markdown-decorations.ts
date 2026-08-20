import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range as StateRange } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

const marker = Decoration.mark({ class: "cm-md-marker" });
const markerRevealed = Decoration.mark({
  class: "cm-md-marker cm-md-marker-revealed",
});
const bold = Decoration.mark({ class: "cm-md-bold" });
const italic = Decoration.mark({ class: "cm-md-italic" });
const inlineCode = Decoration.mark({ class: "cm-md-code" });
const listMark = Decoration.mark({ class: "cm-md-listmark" });
const localLink = Decoration.mark({ class: "cm-md-link cm-md-link-local" });
const externalLink = Decoration.mark({
  class: "cm-md-link cm-md-link-external",
});
const quote = Decoration.mark({ class: "cm-md-quote" });
const strike = Decoration.mark({ class: "cm-md-strike" });
const horizontalRule = Decoration.mark({ class: "cm-md-hr" });
const horizontalRuleRevealed = Decoration.mark({
  class: "cm-md-marker cm-md-marker-revealed",
});
const horizontalRuleLine = Decoration.line({ class: "cm-md-hr-line" });
const codeLine = Decoration.line({ class: "cm-md-codeblock" });
const headingText = new Map(
  [1, 2, 3, 4, 5, 6].map((level) => [
    level,
    Decoration.mark({ class: `cm-md-h cm-md-h${level}` }),
  ]),
);

type StyledRange = {
  from: number;
  to?: number;
  decoration: Decoration;
  line?: boolean;
};
type NodeRef = Parameters<
  Parameters<ReturnType<typeof syntaxTree>["iterate"]>[0]["enter"]
>[0];

function revealed(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

function lineRevealed(state: EditorState, from: number): boolean {
  const line = state.doc.lineAt(from);
  return state.selection.ranges.some((range) => {
    const first = state.doc.lineAt(
      Math.max(0, Math.min(state.doc.length, range.from)),
    );
    const last = state.doc.lineAt(
      Math.max(0, Math.min(state.doc.length, range.to)),
    );
    return first.number <= line.number && last.number >= line.number;
  });
}

class TaskWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly checked: boolean,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  override eq(other: TaskWidget): boolean {
    return (
      other.from === this.from &&
      other.checked === this.checked &&
      other.readOnly === this.readOnly
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = `cm-md-task${this.checked ? " checked" : ""}`;
    element.setAttribute("role", "checkbox");
    element.setAttribute("aria-checked", String(this.checked));
    element.setAttribute("aria-disabled", String(this.readOnly));
    element.setAttribute(
      "aria-label",
      this.checked ? "Mark task incomplete" : "Mark task complete",
    );
    element.tabIndex = this.readOnly ? -1 : 0;
    const box = document.createElement("span");
    box.className = "cm-md-task-box";
    element.append(box);

    const toggle = () => {
      if (view.state.readOnly) return;
      const markerText = view.state.sliceDoc(this.from, this.from + 3);
      const match = /^\[([ xX])\]$/u.exec(markerText);
      if (!match) return;
      view.dispatch({
        changes: {
          from: this.from + 1,
          to: this.from + 2,
          insert: match[1] === " " ? "x" : " ",
        },
        userEvent: "input",
      });
    };
    element.addEventListener("pointerdown", (event) => event.preventDefault());
    element.addEventListener("click", toggle);
    element.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });
    return element;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function markerRanges(
  node: NodeRef,
  state: EditorState,
  name: string,
): StyledRange[] {
  const active = revealed(state, node.from, node.to);
  return node.node.getChildren(name).map((child) => ({
    from: child.from,
    to: child.to,
    decoration: active ? markerRevealed : marker,
  }));
}

function decorateHeading(node: NodeRef, state: EditorState): StyledRange[] {
  const level = Number(node.name.slice(-1));
  const header = node.node.getChild("HeaderMark");
  if (!header) return [];
  const ranges: StyledRange[] = [
    {
      from: header.from,
      to: header.to,
      decoration:
        lineRevealed(state, node.from) || revealed(state, node.from, node.to)
          ? markerRevealed
          : marker,
    },
  ];
  if (header.to < node.to) {
    let from = header.to;
    let to = node.to;
    const text = state.sliceDoc(from, to);
    from += text.length - text.trimStart().length;
    to -= text.length - text.trimEnd().length;
    const decoration = headingText.get(level);
    if (from < to && decoration) ranges.push({ from, to, decoration });
  }
  return ranges;
}

function decorateEmphasis(
  node: NodeRef,
  state: EditorState,
  content: Decoration,
): StyledRange[] {
  const marks = node.node.getChildren("EmphasisMark");
  const ranges = markerRanges(node, state, "EmphasisMark");
  if (marks.length === 2 && marks[0]!.to < marks[1]!.from) {
    ranges.push({
      from: marks[0]!.to,
      to: marks[1]!.from,
      decoration: content,
    });
  }
  return ranges;
}

function decorateInlineCode(node: NodeRef, state: EditorState): StyledRange[] {
  const marks = node.node.getChildren("CodeMark");
  const ranges = markerRanges(node, state, "CodeMark");
  if (marks.length === 2 && marks[0]!.to < marks[1]!.from) {
    ranges.push({
      from: marks[0]!.to,
      to: marks[1]!.from,
      decoration: inlineCode,
    });
  }
  return ranges;
}

function decorateLink(node: NodeRef, state: EditorState): StyledRange[] {
  const ranges = markerRanges(node, state, "LinkMark");
  const marks = node.node.getChildren("LinkMark");
  const url = node.node.getChild("URL");
  const active = revealed(state, node.from, node.to);
  if (url) {
    ranges.push({
      from: url.from,
      to: url.to,
      decoration: active ? markerRevealed : marker,
    });
  }
  if (marks.length >= 2 && marks[0]!.to < marks[1]!.from) {
    const destination = url ? state.sliceDoc(url.from, url.to).trim() : "";
    const external = /^(?:https?:|mailto:|tel:)/iu.test(destination);
    ranges.push({
      from: marks[0]!.to,
      to: marks[1]!.from,
      decoration: external ? externalLink : localLink,
    });
  }
  return ranges;
}

function decorateStrikethrough(
  node: NodeRef,
  state: EditorState,
): StyledRange[] {
  const marks = node.node.getChildren("StrikethroughMark");
  const ranges = markerRanges(node, state, "StrikethroughMark");
  if (marks.length === 2 && marks[0]!.to < marks[1]!.from) {
    ranges.push({ from: marks[0]!.to, to: marks[1]!.from, decoration: strike });
  }
  return ranges;
}

function decorateFence(node: NodeRef, state: EditorState): StyledRange[] {
  const active = revealed(state, node.from, node.to);
  const ranges: StyledRange[] = node.node
    .getChildren("CodeMark")
    .map((child) => ({
      from: child.from,
      to: child.to,
      decoration: active ? markerRevealed : marker,
    }));
  const info = node.node.getChild("CodeInfo");
  if (info)
    ranges.push({
      from: info.from,
      to: info.to,
      decoration: active ? markerRevealed : marker,
    });
  const first = state.doc.lineAt(node.from).number;
  const last = state.doc.lineAt(node.to).number;
  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    ranges.push({ from: line.from, decoration: codeLine, line: true });
  }
  return ranges;
}

function decorateNode(node: NodeRef, view: EditorView): StyledRange[] {
  const state = view.state;
  if (/^ATXHeading[1-6]$/u.test(node.name)) return decorateHeading(node, state);
  if (node.name === "StrongEmphasis")
    return decorateEmphasis(node, state, bold);
  if (node.name === "Emphasis") return decorateEmphasis(node, state, italic);
  if (node.name === "InlineCode") return decorateInlineCode(node, state);
  if (node.name === "Link") return decorateLink(node, state);
  if (node.name === "Strikethrough") return decorateStrikethrough(node, state);
  if (node.name === "FencedCode") return decorateFence(node, state);
  if (node.name === "TaskMarker") {
    if (revealed(state, node.from, node.to)) {
      return [{ from: node.from, to: node.to, decoration: listMark }];
    }
    const checked = /x/iu.test(state.sliceDoc(node.from, node.to));
    return [
      {
        from: node.from,
        to: node.to,
        decoration: Decoration.replace({
          widget: new TaskWidget(node.from, checked, state.readOnly),
        }),
      },
    ];
  }
  if (node.name === "ListMark") {
    return [{ from: node.from, to: node.to, decoration: listMark }];
  }
  if (node.name === "QuoteMark") {
    const line = state.doc.lineAt(node.from);
    return [
      {
        from: node.from,
        to: node.to,
        decoration: revealed(state, line.from, line.to)
          ? markerRevealed
          : marker,
      },
      ...(node.to < line.to
        ? [{ from: node.to, to: line.to, decoration: quote }]
        : []),
    ];
  }
  if (node.name === "HorizontalRule") {
    const line = state.doc.lineAt(node.from);
    if (lineRevealed(state, node.from) || revealed(state, line.from, line.to)) {
      return [
        { from: node.from, to: node.to, decoration: horizontalRuleRevealed },
      ];
    }
    return [
      { from: line.from, decoration: horizontalRuleLine, line: true },
      { from: node.from, to: node.to, decoration: horizontalRule },
    ];
  }
  return [];
}

function compute(view: EditorView): DecorationSet {
  const ranges: StateRange<Decoration>[] = [];
  const handled = new Set([
    "StrongEmphasis",
    "Emphasis",
    "InlineCode",
    "ListMark",
    "TaskMarker",
    "Link",
    "QuoteMark",
    "HorizontalRule",
    "Strikethrough",
    "FencedCode",
  ]);
  for (let level = 1; level <= 6; level++) handled.add(`ATXHeading${level}`);
  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (!handled.has(node.name)) return;
        for (const range of decorateNode(node, view)) {
          ranges.push(
            range.line
              ? range.decoration.range(range.from)
              : range.decoration.range(range.from, range.to),
          );
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

export const markdownDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = compute(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.readOnly !== update.state.readOnly
      ) {
        this.decorations = compute(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
