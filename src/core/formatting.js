import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { GFM, parser } from "@lezer/markdown";

const markdownParser = parser.configure(GFM);
const protectedBlocks = new Set([
  "FencedCode",
  "CodeBlock",
  "Table",
  "HTMLBlock",
  "LinkReference",
  "HorizontalRule",
  "SetextHeading1",
  "SetextHeading2",
]);

export const FORMATTING_SHORTCUTS = Object.freeze([
  ...[1, 2, 3, 4, 5, 6].map((kind) =>
    Object.freeze({ key: `Mod-Alt-${kind}`, kind }),
  ),
  Object.freeze({ key: "Mod-Alt-0", kind: "paragraph" }),
  Object.freeze({ key: "Mod-Shift-7", kind: "ordered" }),
  Object.freeze({ key: "Mod-Shift-8", kind: "bullet" }),
  Object.freeze({ key: "Mod-Shift-9", kind: "task" }),
]);

export function parseListLine(text) {
  const match =
    /^([\t ]*)(?:([-*+]|\d+[.)])([\t ]+))?(\[[ xX]\][\t ]+)?(.*)$/su.exec(text);
  const marker = match[2] ?? null;
  return {
    indent: match[1],
    marker,
    space: match[3] ?? " ",
    task: marker ? (match[4] ?? null) : null,
    content: marker ? match[5] : (match[4] ?? "") + match[5],
  };
}

function selectedLines(state) {
  const numbers = new Set();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.empty ? range.to : range.to - 1).number;
    for (let number = first; number <= last; number++) numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b).map((n) => state.doc.line(n));
}

/** Formatting is an explicit edit, so parse the current source synchronously.
 * Never depend on a viewport's possibly incomplete asynchronous syntax tree. */
function sourceStructure(state) {
  const source = state.doc.toString();
  const ranges = [];
  const listItems = [];
  const quotes = [];
  markdownParser.parse(source).iterate({
    enter(node) {
      if (node.name === "ListItem")
        listItems.push({
          from: node.from,
          to: node.to,
          markerFrom: node.node.getChild("ListMark")?.from ?? node.from,
          parentType: node.node.parent?.name,
          parentItemMarkerFrom:
            node.node.parent?.parent?.name === "ListItem"
              ? node.node.parent.parent.getChild("ListMark")?.from
              : undefined,
          firstInList: node.node.prevSibling == null,
          nextMarkerFrom: node.node.nextSibling?.getChild("ListMark")?.from,
        });
      if (node.name === "Blockquote")
        quotes.push({ from: node.from, to: node.to });
      if (!protectedBlocks.has(node.name)) return;
      ranges.push({
        from: node.from,
        to: node.to,
        includeEnd:
          node.name === "FencedCode" &&
          node.node.getChildren("CodeMark").length < 2,
      });
      return false;
    },
  });
  if (/^\uFEFF?---[\t ]*(?:\n|$)/u.test(source)) {
    let end = source.length;
    let closed = false;
    for (let number = 2; number <= state.doc.lines; number++) {
      const line = state.doc.line(number);
      if (/^(?:---|\.\.\.)[\t ]*$/u.test(line.text)) {
        end = line.to;
        closed = true;
        break;
      }
    }
    ranges.push({ from: 0, to: end, includeEnd: !closed });
  }
  return { ranges, listItems, quotes };
}

function intersectsLine(line, range) {
  return (
    (line.from < range.to || (range.includeEnd && line.from === range.to)) &&
    line.to >= range.from
  );
}

function quotedPrefix(text) {
  return /^(?:[\t ]{0,3}>[\t ]?)+/u.exec(text)?.[0] ?? "";
}

function headingLine(text) {
  const outerQuote = quotedPrefix(text);
  const list = parseListLine(text.slice(outerQuote.length));
  const innerQuote = quotedPrefix(list.content);
  const body = list.content.slice(innerQuote.length);
  const container = text.slice(0, text.length - body.length);
  return { outerQuote, innerQuote, body, container };
}

function safeLines(lines, structure, kind) {
  return !lines.some(
    (line) =>
      // Also protect incomplete AIC accordion delimiters. GFM considers these
      // ordinary quotes/text; formatting their boundaries breaks the block.
      /^(?:>>>(?:\|open\|)?(?:[\t ]|$)|<<<[\t ]*$)/u.test(line.text) ||
      structure.ranges.some((range) => intersectsLine(line, range)) ||
      structure.quotes.some(
        (range) =>
          intersectsLine(line, range) &&
          // List width changes through mixed quote/list containers need their
          // own container transform. Do not partially rewrite quoted lists.
          (isList(kind) || !headingLine(line.text).container.includes(">")),
      ),
  );
}

function columns(prefix) {
  let width = 0;
  for (const character of prefix)
    width += character === "\t" ? 4 - (width % 4) : 1;
  return width;
}

/** A wider list marker changes the required indentation of its complete
 * continuation, including unselected child lists and fenced blocks. Keep the
 * parsed parent/child relationship, not merely the old number of spaces. */
function preserveListIndentation(state, changes, markerChanges, structure) {
  const deltas = new Map();
  const itemsByMarker = new Map(
    structure.listItems.map((item) => [item.markerFrom, item]),
  );
  const orderedChildren = new Map();
  for (const item of structure.listItems) {
    if (
      item.parentType !== "OrderedList" ||
      !item.firstInList ||
      item.parentItemMarkerFrom == null
    )
      continue;
    const children = orderedChildren.get(item.parentItemMarkerFrom) ?? [];
    children.push(item);
    orderedChildren.set(item.parentItemMarkerFrom, children);
  }
  const changedMarkers = new Set(
    markerChanges.map(({ line, item }) => line.from + item.indent.length),
  );
  const separators = new Set();
  const prefixChanges = new Map(changes.map((change) => [change.from, change]));
  for (const { line, item, markerWidth } of markerChanges) {
    if (!item.marker) continue;
    const owner = itemsByMarker.get(line.from + item.indent.length);
    if (!owner) continue;
    const prefix = prefixChanges.get(line.from)?.insert;
    const nextKind =
      prefix == null ? lineKind(item) : lineKind(parseListLine(prefix));
    if (owner.parentType === "OrderedList" && nextKind !== "ordered") {
      for (const child of orderedChildren.get(owner.markerFrom) ?? []) {
        if (changedMarkers.has(child.markerFrom)) continue;
        const firstChild = state.doc.lineAt(child.markerFrom);
        if (
          firstChild.number > line.number &&
          state.doc.line(firstChild.number - 1).text.trim()
        )
          separators.add(firstChild.from);
      }
    }
    // A non-1 ordered sibling cannot interrupt the new bullet/paragraph that
    // now precedes it. Keep that untouched sibling a list by separating the
    // changed list kind at its original boundary.
    if (
      owner.parentType === "OrderedList" &&
      nextKind !== "ordered" &&
      owner.nextMarkerFrom != null &&
      !changedMarkers.has(owner.nextMarkerFrom)
    ) {
      const next = state.doc.lineAt(owner.nextMarkerFrom);
      if (next.number > 1 && state.doc.line(next.number - 1).text.trim())
        separators.add(next.from);
    }
    const contentColumn = columns(item.indent + item.marker + item.space);
    const delta = markerWidth - (contentColumn - columns(item.indent));
    if (!delta) continue;
    const last = state.doc.lineAt(Math.max(owner.from, owner.to - 1)).number;
    for (let number = line.number + 1; number <= last; number++) {
      const continuation = state.doc.line(number);
      const indent = /^[\t ]*/u.exec(continuation.text)[0];
      // Lazy paragraph continuation may start at column zero. It does not
      // participate in the list's indentation and must remain unchanged.
      if (!continuation.text.trim() || columns(indent) < contentColumn)
        continue;
      deltas.set(number, (deltas.get(number) ?? 0) + delta);
    }
  }
  for (const [number, delta] of deltas) {
    if (!delta) continue;
    const line = state.doc.line(number);
    const indent = /^[\t ]*/u.exec(line.text)[0];
    const replacement = " ".repeat(Math.max(0, columns(indent) + delta));
    const existing = prefixChanges.get(line.from);
    if (existing)
      existing.insert = replacement + existing.insert.slice(indent.length);
    else {
      const change = {
        from: line.from,
        to: line.from + indent.length,
        insert: replacement,
      };
      changes.push(change);
      prefixChanges.set(line.from, change);
    }
  }
  for (const from of separators) {
    const existing = prefixChanges.get(from);
    if (existing) existing.insert = "\n" + existing.insert;
    else changes.push({ from, insert: "\n" });
  }
  return changes.sort((left, right) => left.from - right.from);
}

function lineKind(parsed) {
  if (!parsed.marker) return null;
  if (parsed.task) return "task";
  return /^\d/u.test(parsed.marker) ? "ordered" : "bullet";
}

function isList(kind) {
  return kind === "bullet" || kind === "ordered" || kind === "task";
}

function validKind(kind) {
  return (
    isList(kind) ||
    kind === "paragraph" ||
    kind === "quote" ||
    (Number.isInteger(kind) && kind >= 1 && kind <= 6)
  );
}

/** One pure plan for toolbar, keyboard and host command adapters. Returning
 * null is deliberate: a mixed selection containing structured source is not
 * partially formatted, and read-only content never produces mutations. */
export function formattingChanges(state, kind, { toggle = false } = {}) {
  if (state.readOnly || !validKind(kind)) return null;
  const selected = selectedLines(state);
  const structure = sourceStructure(state);
  if (!safeLines(selected, structure, kind)) return null;
  const selectedNumbers = new Set(selected.map((line) => line.number));
  const itemCounts = new Map();
  for (const item of structure.listItems) {
    const number = state.doc.lineAt(item.markerFrom).number;
    itemCounts.set(number, (itemCounts.get(number) ?? 0) + 1);
  }
  // Multiple nested list markers on one physical line require a full
  // container transform; never flatten one into heading text accidentally.
  if (selected.some((line) => (itemCounts.get(line.number) ?? 0) > 1))
    return null;
  const nonempty = selected.filter((line) => line.text.trim());
  const firstLines = new Set(
    state.selection.ranges.map((range) => state.doc.lineAt(range.from).number),
  );
  const lines = nonempty.length
    ? nonempty
    : selected.filter((line) => firstLines.has(line.number));
  const parsed = lines.map((line) => parseListLine(line.text));
  const headings = lines.map((line) => headingLine(line.text));
  const removeList =
    isList(kind) && parsed.every((line) => lineKind(line) === kind);
  const sequence = new Map();
  const removeHeading =
    toggle &&
    typeof kind === "number" &&
    headings.every((line) =>
      new RegExp(`^#{${kind}}(?:[\\t ]+|$)`, "u").test(line.body),
    );
  const changes = [];
  const markerChanges = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const item = parsed[index];
    if (isList(kind)) {
      const heading = removeList
        ? null
        : /^(#{1,6})(?:[\t ]+|$)/u.exec(item.content);
      const headLength =
        line.text.length - item.content.length + (heading?.[0].length ?? 0);
      let prefix = item.indent;
      if (!removeList) {
        if (kind === "ordered") {
          // Disjoint selections are separate list runs. A non-1 marker would
          // otherwise become lazy paragraph text after an untouched list kind.
          if (index > 0) {
            for (
              let number = lines[index - 1].number + 1;
              number < line.number;
              number++
            )
              if (!selectedNumbers.has(number)) {
                sequence.clear();
                break;
              }
          }
          // A nested list numbers independently; returning to its parent
          // starts any following child list afresh.
          const width = columns(item.indent);
          for (const depth of sequence.keys()) {
            if (depth > width) sequence.delete(depth);
          }
          const next = (sequence.get(width) ?? 0) + 1;
          sequence.set(width, next);
          prefix += `${next}. `;
        } else {
          prefix += kind === "bullet" ? "- " : `- ${item.task ?? "[ ] "}`;
        }
      }
      if (prefix !== line.text.slice(0, headLength))
        changes.push({
          from: line.from,
          to: line.from + headLength,
          insert: prefix,
        });
      const nextMarker = parseListLine(prefix);
      markerChanges.push({
        line,
        item,
        markerWidth: removeList ? 0 : nextMarker.marker.length + 1,
      });
      const closing = heading && /[\t ]+#+[\t ]*$/u.exec(item.content);
      if (closing)
        changes.push({
          from: Math.max(line.from + headLength, line.to - closing[0].length),
          to: line.to,
        });
      continue;
    }
    // A heading can live inside a list item: keep its list/checkbox container.
    const { container, body, outerQuote, innerQuote } = headings[index];
    const marker = /^#{1,6}(?:[\t ]+|$)/u.exec(body);
    const hasQuote = Boolean(outerQuote || innerQuote);
    const prefix =
      kind === "paragraph" || removeHeading
        ? ""
        : kind === "quote"
          ? hasQuote
            ? ""
            : "> "
          : `${"#".repeat(kind)} `;
    const from = line.from + container.length;
    const to = from + (marker?.[0].length ?? 0);
    if (kind === "paragraph" && hasQuote && !marker) {
      const withoutQuote = outerQuote
        ? /^[\t ]*/u.exec(outerQuote)[0] + container.slice(outerQuote.length)
        : container.slice(0, container.length - innerQuote.length);
      changes.push({ from: line.from, to: from, insert: withoutQuote });
    } else if (prefix !== state.sliceDoc(from, to))
      changes.push({ from, to, insert: prefix });
    const closing =
      marker?.[0].startsWith("#") &&
      (kind === "paragraph" || kind === "quote" || removeHeading) &&
      /[\t ]+#+[\t ]*$/u.exec(body);
    if (closing)
      changes.push({
        from: Math.max(to, line.to - closing[0].length),
        to: line.to,
      });
  }
  return preserveListIndentation(state, changes, markerChanges, structure);
}

function applyFormatting(view, kind, toggle) {
  const changes = formattingChanges(view.state, kind, { toggle });
  if (changes == null) return false;
  if (changes.length) {
    const set = view.state.changes(changes);
    const selection = EditorSelection.create(
      view.state.selection.ranges.map((range) =>
        EditorSelection.range(
          set.mapPos(range.anchor, 1),
          set.mapPos(range.head, 1),
        ),
      ),
      view.state.selection.mainIndex,
    );
    view.dispatch({
      changes: set,
      selection,
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
      userEvent: "input.format",
    });
  }
  view.focus();
  return true;
}

export const toggleList = (view, kind) => applyFormatting(view, kind, true);
export const setBlockKind = (view, kind) => applyFormatting(view, kind, false);
export const toggleHeading = (view, level) =>
  applyFormatting(view, level, true);

export function formattingShortcut(event, apple = false) {
  if (
    event.isComposing ||
    event.getModifierState?.("AltGraph") ||
    !(apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  )
    return null;
  const physical = /^Digit([0-9])$/u.exec(event.code ?? "")?.[1];
  const digit =
    physical ??
    (/^[0-9]$/u.test(event.key)
      ? event.key
      : { "&": "7", "*": "8", "(": "9" }[event.key]);
  if (event.altKey && !event.shiftKey && /^[0-6]$/u.test(digit ?? ""))
    return digit === "0" ? "paragraph" : Number(digit);
  if (event.shiftKey && !event.altKey)
    return { 7: "ordered", 8: "bullet", 9: "task" }[digit] ?? null;
  return null;
}

function runFormattingShortcut(view, event) {
  const target = event.target;
  if (
    !target ||
    !view.contentDOM.contains(target) ||
    target.closest?.(
      "input, textarea, select, button, [contenteditable=false]",
    ) ||
    view.composing
  )
    return false;
  const apple = /Mac|iPhone|iPad|iPod/u.test(
    view.dom.ownerDocument.defaultView?.navigator.platform ?? "",
  );
  const kind = formattingShortcut(event, apple);
  if (kind == null) return false;
  applyFormatting(view, kind, true);
  // A recognized formatting intent in protected/read-only source is a no-op,
  // not a chance for browser or extension-host commands to steal the key.
  return true;
}

/** Physical Digit codes keep the same shortcuts on shifted/non-Latin layouts.
 * One keymap owns both hosts, and ignores native property/diagram edit fields. */
export const formattingKeymap = Object.freeze([{ any: runFormattingShortcut }]);
export const markdownFormatting = () => Prec.high(keymap.of(formattingKeymap));
