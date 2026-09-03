import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { createCodeFencePreview } from "./code-fence-preview.js";
import { providePreviewRanges } from "./preview-ranges.js";
import {
  selectionRevealsPreview,
  writeTextToClipboard,
} from "./structured-preview.js";

export const CODE_FENCE_EXTENSION_CORE_VERSION = "1.1.0";

const editCodeFenceSource = StateEffect.define({
  map: (value, mapping) => mapping.mapPos(value, -1),
});

export function fenceInfo(state, node) {
  const info = node.node.getChild("CodeInfo");
  return info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
}

export function codeFences(state) {
  const blocks = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const language = fenceInfo(state, node).split(/\s+/u)[0] ?? "";
      if (language === "mermaid") return;
      const text = node.node.getChild("CodeText");
      const afterOpen = Math.min(state.doc.lineAt(node.from).to + 1, node.to);
      blocks.push(
        Object.freeze({
          from: node.from,
          to: node.to,
          textFrom: text?.from ?? afterOpen,
          source: text ? state.sliceDoc(text.from, text.to) : "",
          language,
        }),
      );
    },
  });
  return Object.freeze(blocks);
}

function selectionIntersects(state, block) {
  return (
    state.field(codeFenceSource) === block.from ||
    selectionRevealsPreview(state.selection.ranges, block.from, block.to) ||
    state.selection.ranges.some(
      (range) =>
        range.empty && range.from > block.from && range.from < block.to,
    )
  );
}

const codeFenceSource = StateField.define({
  create: () => null,
  update(value, transaction) {
    let next = value == null ? null : transaction.changes.mapPos(value, -1);
    for (const effect of transaction.effects) {
      if (effect.is(editCodeFenceSource)) next = effect.value;
    }
    if (next == null) return null;
    const block = codeFences(transaction.state).find(
      (candidate) => candidate.from === next,
    );
    if (!block) return null;
    return transaction.state.selection.ranges.some((range) =>
      range.empty
        ? range.from >= block.from && range.from <= block.to
        : range.from < block.to && range.to > block.from,
    )
      ? next
      : null;
  },
});

class CodeFenceWidget extends WidgetType {
  constructor(block, document, readOnly, onCopy) {
    super();
    this.block = block;
    this.document = document;
    this.readOnly = readOnly;
    this.onCopy = onCopy;
  }

  eq(other) {
    return (
      other.block.from === this.block.from &&
      other.block.to === this.block.to &&
      other.block.language === this.block.language &&
      other.block.source === this.block.source &&
      other.readOnly === this.readOnly &&
      other.onCopy === this.onCopy
    );
  }

  toDOM(view) {
    return createCodeFencePreview(this.document, {
      ...this.block,
      readOnly: this.readOnly,
      onCopy: (source) =>
        this.onCopy
          ? this.onCopy(source, this.block.language)
          : writeTextToClipboard(source, this.document),
      onEdit: () => {
        const anchor = Math.max(
          0,
          Math.min(view.state.doc.length, this.block.textFrom),
        );
        view.dispatch({
          selection: { anchor },
          effects: editCodeFenceSource.of(this.block.from),
          scrollIntoView: true,
        });
        view.focus();
      },
    });
  }

  ignoreEvent() {
    return true;
  }
}

const refreshCodeFences = StateEffect.define();

function codeFenceDecorations(state, document, onCopy) {
  const decorations = [];
  for (const block of codeFences(state)) {
    if (selectionIntersects(state, block)) continue;
    decorations.push(
      Decoration.replace({
        widget: new CodeFenceWidget(block, document, state.readOnly, onCopy),
        block: true,
      }).range(block.from, block.to),
    );
  }
  return Decoration.set(decorations, true);
}

export function makeCodeFenceExtension({
  document = globalThis.document,
  onCopy,
} = {}) {
  if (!document?.createElement)
    throw new TypeError("makeCodeFenceExtension requires a document");

  const field = StateField.define({
    create: (state) => codeFenceDecorations(state, document, onCopy),
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        transaction.startState.readOnly === transaction.state.readOnly &&
        !transaction.effects.some((effect) => effect.is(refreshCodeFences))
      )
        return value;
      return codeFenceDecorations(transaction.state, document, onCopy);
    },
    provide: providePreviewRanges,
  });

  const viewportRefresh = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.scheduled = false;
        this.destroyed = false;
      }

      update(update) {
        if (
          !update.viewportChanged ||
          update.docChanged ||
          update.selectionSet ||
          this.scheduled
        )
          return;
        this.scheduled = true;
        queueMicrotask(() => {
          this.scheduled = false;
          if (!this.destroyed)
            this.view.dispatch({ effects: refreshCodeFences.of() });
        });
      }

      destroy() {
        this.destroyed = true;
      }
    },
  );

  return [codeFenceSource, field, viewportRefresh];
}
