import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { createCodeFencePreview } from "./code-fence-preview.js";
import { providePreviewRanges } from "./preview-ranges.js";
import {
  selectionRevealsPreview,
  selectionStaysInSource,
  writeTextToClipboard,
} from "./structured-preview.js";
import { sourcePreviewExit, sourcePreviewExitHandlers } from "./source-mode.js";

export const CODE_FENCE_EXTENSION_CORE_VERSION = "1.2.0";

const editCodeFenceSource = StateEffect.define({
  map: (value, mapping) => mapping.mapPos(value, -1),
});
const blurCodeFenceSource = StateEffect.define();

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
      // An opening ``` is still being authored. Keep it editable until a
      // closing fence exists, even when focus leaves the line.
      if (node.node.getChildren("CodeMark").length < 2) return;
      const language = fenceInfo(state, node).split(/\s+/u)[0] ?? "";
      if (["mermaid", "aic", "aic-security"].includes(language)) return;
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
      if (effect.is(sourcePreviewExit)) next = null;
      if (effect.is(blurCodeFenceSource)) next = null;
    }
    if (transaction.docChanged && next == null) {
      const cursor = transaction.state.selection.main;
      if (cursor.empty) {
        const edited = codeFences(transaction.state).find(
          (block) => cursor.from > block.from && cursor.from <= block.to,
        );
        if (edited) next = edited.from;
      }
    }
    if (next == null) return null;
    const block = codeFences(transaction.state).find(
      (candidate) => candidate.from === next,
    );
    if (!block) return null;
    return selectionStaysInSource(
      transaction.state.selection.ranges,
      block.from,
      block.to,
    )
      ? next
      : null;
  },
});

// Decoration descriptors may be reused, but a removed DOM's callbacks must
// never become live again after a mode or document-identity change.
const liveCodePreviews = new WeakSet();

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
    const current = () =>
      liveCodePreviews.has(wrapper) &&
      wrapper.isConnected &&
      view.dom.contains(wrapper) &&
      codeFences(view.state).some(
        (block) =>
          block.from === this.block.from &&
          block.to === this.block.to &&
          block.source === this.block.source &&
          block.language === this.block.language,
      );
    const wrapper = createCodeFencePreview(this.document, {
      ...this.block,
      readOnly: this.readOnly,
      onCopy: async (source) => {
        if (!current()) return false;
        try {
          const copied = this.onCopy
            ? await this.onCopy(source, this.block.language)
            : await writeTextToClipboard(source, this.document);
          return current() ? copied : false;
        } catch {
          return false;
        }
      },
      onEdit: () => {
        if (!current()) return;
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
      onCut: this.readOnly
        ? undefined
        : async () => {
            if (!current() || view.state.readOnly) return false;
            const markdown = view.state.sliceDoc(
              this.block.from,
              this.block.to,
            );
            let copied;
            try {
              copied = this.onCopy
                ? await this.onCopy(markdown, this.block.language)
                : await writeTextToClipboard(markdown, this.document);
            } catch {
              copied = false;
            }
            if (copied === false || !current() || view.state.readOnly)
              return false;
            view.dispatch({
              changes: { from: this.block.from, to: this.block.to },
              userEvent: "input.cut",
            });
            view.focus();
            return true;
          },
    });
    liveCodePreviews.add(wrapper);
    return wrapper;
  }

  destroy(element) {
    liveCodePreviews.delete(element);
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
        !transaction.effects.some(
          (effect) =>
            effect.is(refreshCodeFences) ||
            effect.is(sourcePreviewExit) ||
            effect.is(blurCodeFenceSource),
        )
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

  return [
    codeFenceSource,
    EditorView.domEventHandlers({
      blur(_event, view) {
        if (view.state.field(codeFenceSource) != null)
          view.dispatch({ effects: blurCodeFenceSource.of() });
      },
    }),
    sourcePreviewExitHandlers.of((state) => {
      const from = state.field(codeFenceSource);
      return from == null
        ? null
        : (codeFences(state).find((block) => block.from === from) ?? null);
    }),
    field,
    viewportRefresh,
  ];
}
