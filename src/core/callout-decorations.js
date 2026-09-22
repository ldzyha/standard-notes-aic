import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin } from "@codemirror/view";

export const CALLOUT_CORE_VERSION = "1.0.0";

const warningLine = Decoration.line({
  class: "cm-md-callout-line cm-md-callout-warning",
});
const errorLine = Decoration.line({
  class: "cm-md-callout-line cm-md-callout-error",
});
const marker = Decoration.mark({ class: "cm-md-callout-marker" });
const content = Decoration.mark({ class: "cm-md-quote cm-md-callout-text" });

/** Preserve Markdown source: !> is a warning and !>> is an error. */
export function calloutKind(text) {
  const match = /^ {0,3}(!>>|!>)(?=[ \t]|$)/u.exec(text);
  return match?.[1] === "!>>"
    ? "error"
    : match?.[1] === "!>"
      ? "warning"
      : null;
}

function insideCode(tree, position) {
  for (let node = tree.resolveInner(position, 1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return true;
  }
  return false;
}

function decorations(view) {
  const { state } = view;
  const tree = syntaxTree(state);
  const ranges = [];
  const seen = new Set();
  for (const visible of view.visibleRanges) {
    const first = state.doc.lineAt(visible.from).number;
    const last = state.doc.lineAt(visible.to).number;
    for (let number = first; number <= last; number++) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = state.doc.line(number);
      const kind = calloutKind(line.text);
      if (!kind || insideCode(tree, line.from)) continue;
      const markerStart = line.text.search(/!/u);
      const markerEnd = markerStart + (kind === "error" ? 3 : 2);
      const textStart = line.text.slice(markerEnd).search(/\S/u);
      ranges.push(
        (kind === "error" ? errorLine : warningLine).range(line.from),
      );
      ranges.push(marker.range(line.from + markerStart, line.from + markerEnd));
      if (textStart >= 0) {
        ranges.push(content.range(line.from + markerEnd + textStart, line.to));
      }
    }
  }
  return Decoration.set(ranges, true);
}

export function makeCalloutExtension() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = decorations(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged)
          this.decorations = decorations(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
