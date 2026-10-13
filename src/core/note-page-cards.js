import {
  Annotation,
  EditorSelection,
  EditorState,
  Facet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  appendPageText,
  displayTarget,
  notePages,
  pageForTarget,
} from "./note-pages.js";
import { providePreviewRanges } from "./preview-ranges.js";
import {
  createIconButton,
  selectionStaysInSource,
} from "./structured-preview.js";
import { applyUiComponent } from "./ui-system.js";

// Pages of one note shown as cards. Each separator line becomes a card header
// naming the bound target; "Open target" is the only card action and belongs
// to the host. A side panel focuses one target: every other page is hidden and
// user edits are confined to the focused page. Nothing here stores a page:
// the note text stays the only source.

export const PAGE_PLACEHOLDER = "Write a note for this target…";

/** Marks a host update of the whole document (external file change). */
export const pageExternalChange = Annotation.define();

const focusEffect = StateEffect.define();
const openTarget = Facet.define({
  combine: (handlers) => handlers.find(Boolean) ?? null,
});

function cleanTarget(target) {
  return String(target ?? "")
    .replace(/\s*[\r\n]+\s*/gu, " ")
    .trim();
}

// The editable range of the focused page. It excludes the blank line that
// keeps the next separator a separator. `prefix`/`suffix` are written around
// the first typed text when the page (or its line structure) does not exist.
function resolveFocus(doc, target) {
  const text = doc.toString();
  const length = text.length;
  const pages = notePages(text);
  const page = pages[pageForTarget(pages, target)];
  const focus = { target, prefix: "", suffix: "", exists: Boolean(page) };
  if (!page)
    return {
      ...focus,
      from: length,
      to: length,
      prefix: appendPageText(text, target),
    };
  const from = page.content;
  if (page.to === length)
    return {
      ...focus,
      from,
      to: length,
      // A separator on the last line has no line of its own to type on yet.
      prefix: from === length && text[length - 1] !== "\n" ? "\n" : "",
    };
  const blank = text.lastIndexOf("\n", page.to - 2) + 1;
  return blank > from
    ? { ...focus, from, to: blank - 1 }
    : { ...focus, from, to: from, suffix: "\n" };
}

function changesStayInside(transaction, focus) {
  let inside = true;
  transaction.changes.iterChangedRanges((from, to) => {
    if (from < focus.from || to > focus.to) inside = false;
  });
  return inside;
}

// User edits move the range with the text, so a half-typed fence or separator
// inside the page cannot expose hidden pages. Everything else reads the text.
function nextFocus(value, transaction) {
  let target = value ? value.target : null;
  let focused = false;
  for (const effect of transaction.effects)
    if (effect.is(focusEffect)) [target, focused] = [effect.value, true];
  if (target === null) return null;
  if (!focused && !transaction.docChanged) return value;
  if (
    !focused &&
    value.exists &&
    !value.prefix &&
    !value.suffix &&
    !transaction.annotation(pageExternalChange) &&
    changesStayInside(transaction, value)
  ) {
    const from = transaction.changes.mapPos(value.from, -1);
    const to = transaction.changes.mapPos(value.to, 1);
    if (from < to) return { ...value, from, to };
  }
  return resolveFocus(transaction.newDoc, target);
}

const focusField = StateField.define({
  create: () => null,
  update: nextFocus,
});

function clampSelection(selection, focus) {
  const clamp = (position) =>
    Math.min(focus.to, Math.max(focus.from, position));
  if (
    selection.ranges.every(
      (range) => range.from >= focus.from && range.to <= focus.to,
    )
  )
    return null;
  return EditorSelection.create(
    selection.ranges.map((range) =>
      EditorSelection.range(clamp(range.anchor), clamp(range.head)),
    ),
    selection.mainIndex,
  );
}

function isHistory(transaction) {
  return transaction.isUserEvent("undo") || transaction.isUserEvent("redo");
}

const confinement = EditorState.transactionFilter.of((transaction) => {
  const focus = transaction.startState.field(focusField, false);
  if (
    focus &&
    transaction.docChanged &&
    !transaction.annotation(pageExternalChange) &&
    !isHistory(transaction)
  ) {
    // A change reaching another page is dropped whole; effects (source mode,
    // preview state) still apply so their owners stay consistent.
    if (
      !changesStayInside(transaction, focus) ||
      ((focus.prefix || focus.suffix) && transaction.startState.readOnly)
    )
      return { effects: transaction.effects };
    if (focus.prefix || focus.suffix) {
      // The range is empty here, so every change is an insertion at its start.
      const at = focus.from;
      const typed =
        transaction.newDoc.length - transaction.startState.doc.length;
      const shift = (position) =>
        Math.min(at + typed, Math.max(at, position)) + focus.prefix.length;
      return [
        transaction,
        {
          changes: [
            { from: at, insert: focus.prefix },
            { from: at + typed, insert: focus.suffix },
          ],
          selection: EditorSelection.create(
            transaction.newSelection.ranges.map((range) =>
              EditorSelection.range(shift(range.anchor), shift(range.head)),
            ),
            transaction.newSelection.mainIndex,
          ),
          sequential: true,
        },
      ];
    }
  }
  const next = nextFocus(focus ?? null, transaction);
  const selection = next && clampSelection(transaction.newSelection, next);
  return selection
    ? [transaction, { selection, sequential: true }]
    : transaction;
});

class PageHeaderWidget extends WidgetType {
  constructor(target, focused) {
    super();
    this.target = target;
    this.focused = focused;
  }

  eq(other) {
    return other.target === this.target && other.focused === this.focused;
  }

  ignoreEvent() {
    return true;
  }

  toDOM(view) {
    const document = view.dom.ownerDocument;
    const card = applyUiComponent(document.createElement("div"), "card", [
      "page",
    ]);
    const header = applyUiComponent(
      document.createElement("div"),
      "card",
      [],
      "header",
    );
    card.append(header);
    if (this.target === null) {
      header.setAttribute("role", "separator");
      return card;
    }
    const title = applyUiComponent(
      document.createElement("span"),
      "card",
      [],
      "title",
    );
    title.textContent = title.title = displayTarget(this.target);
    header.append(title);
    if (!this.focused)
      // The label is the way back to the raw `--- target` line.
      title.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const line = view.state.doc.lineAt(view.posAtDOM(card));
        view.dispatch({ selection: { anchor: line.to } });
        view.focus();
      });
    const open = view.state.facet(openTarget);
    if (open) {
      const actions = applyUiComponent(
        document.createElement("span"),
        "card",
        [],
        "actions",
      );
      actions.append(
        createIconButton(document, {
          label: "Open target",
          icon: "open",
          onActivate: () => open(this.target),
        }),
      );
      header.append(actions);
    }
    return card;
  }
}

class PlaceholderWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM(view) {
    const hint = view.dom.ownerDocument.createElement("span");
    hint.className = "cm-placeholder";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = PAGE_PLACEHOLDER;
    return hint;
  }
}

// Focused: the header replaces everything before the page and one block
// replaces everything after it; both are atomic so the caret cannot enter.
function focusDecorations(state) {
  const focus = state.field(focusField);
  if (!focus) return Decoration.none;
  const doc = state.doc;
  const ranges = [];
  const widget = new PageHeaderWidget(focus.target, true);
  const first = doc.lineAt(focus.from);
  ranges.push(
    first.from > 1
      ? Decoration.replace({ block: true, widget }).range(0, first.from - 1)
      : Decoration.widget({ block: true, side: -1, widget }).range(0),
  );
  if (focus.from > first.from)
    ranges.push(Decoration.replace({}).range(first.from, focus.from));
  if (focus.from === focus.to && doc.length && !state.readOnly)
    ranges.push(
      Decoration.widget({ side: 1, widget: new PlaceholderWidget() }).range(
        focus.from,
      ),
    );
  const last = doc.lineAt(focus.to);
  if (focus.to < last.to)
    ranges.push(Decoration.replace({}).range(focus.to, last.to));
  if (last.to + 1 < doc.length)
    ranges.push(
      Decoration.replace({ block: true }).range(last.to + 1, doc.length),
    );
  return Decoration.set(ranges, true);
}

const focusDecorationField = StateField.define({
  create: focusDecorations,
  update: (value, transaction) =>
    transaction.docChanged ||
    transaction.startState.field(focusField) !==
      transaction.state.field(focusField) ||
    transaction.startState.readOnly !== transaction.state.readOnly
      ? focusDecorations(transaction.state)
      : value,
  provide: providePreviewRanges,
});

// Unfocused preview: one header per separator line. A selection touching the
// line shows its source, as in other previews.
function headerDecorations(state) {
  if (state.field(focusField, false)) return Decoration.none;
  const ranges = [];
  for (const page of notePages(state.doc.toString())) {
    if (page.separator < 0) continue;
    const line = state.doc.lineAt(page.separator);
    if (selectionStaysInSource(state.selection.ranges, line.from, line.to))
      continue;
    ranges.push(
      Decoration.replace({
        block: true,
        widget: new PageHeaderWidget(page.target, false),
      }).range(line.from, line.to),
    );
  }
  return Decoration.set(ranges, true);
}

const headerField = StateField.define({
  create: headerDecorations,
  update: (value, transaction) =>
    transaction.docChanged ||
    transaction.selection ||
    transaction.startState.field(focusField, false) !==
      transaction.state.field(focusField, false)
      ? headerDecorations(transaction.state)
      : value,
  provide: providePreviewRanges,
});

/** Focus state, hiding and edit confinement; install outside source mode. */
export function notePageCards({ onOpenTarget } = {}) {
  return [
    focusField,
    confinement,
    focusDecorationField,
    openTarget.of(typeof onOpenTarget === "function" ? onOpenTarget : null),
  ];
}

/** Card headers for the whole note; install with the preview extensions. */
export function notePageCardsPreview() {
  return headerField;
}

/**
 * Show only the page bound to `target`, or the whole note for null. Returns
 * false, changing nothing, for a target that cannot be written as a page.
 */
export function focusPageTarget(view, target) {
  const next = target === null ? null : cleanTarget(target);
  if (next !== null && !appendPageText("", next)) return false;
  if (view.state.field(focusField, false) === undefined) return false;
  view.dispatch({ effects: focusEffect.of(next), scrollIntoView: true });
  return true;
}

/** The focused target and its editable range, or null when unfocused. */
export function focusedPage(state) {
  const focus = state.field(focusField, false);
  return focus
    ? {
        target: focus.target,
        from: focus.from,
        to: focus.to,
        exists: focus.exists,
      }
    : null;
}
