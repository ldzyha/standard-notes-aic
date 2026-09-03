import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";
import { createCodeFencePreview } from "./core/code-fence-preview.js";
import {
  selectionRevealsPreview,
  writeTextToClipboard,
} from "./core/structured-preview.js";

type NodeRef = Parameters<
  Parameters<ReturnType<typeof syntaxTree>["iterate"]>[0]["enter"]
>[0];

export type CodeFenceBlock = Readonly<{
  from: number;
  to: number;
  textFrom: number;
  source: string;
  language: string;
}>;

export function fenceInfo(state: EditorState, node: NodeRef): string {
  const info = node.node.getChild("CodeInfo");
  return info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
}

export function codeFences(state: EditorState): readonly CodeFenceBlock[] {
  const blocks: CodeFenceBlock[] = [];
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

function selectionIntersects(
  state: EditorState,
  block: CodeFenceBlock,
): boolean {
  return (
    selectionRevealsPreview(state.selection.ranges, block.from, block.to) ||
    state.selection.ranges.some(
      (range) =>
        range.empty && range.from >= block.from && range.from <= block.to,
    )
  );
}

class CodeFenceWidget extends WidgetType {
  constructor(
    readonly block: CodeFenceBlock,
    readonly document: Document,
    readonly readOnly: boolean,
  ) {
    super();
  }

  override eq(other: CodeFenceWidget): boolean {
    return (
      other.block.from === this.block.from &&
      other.block.to === this.block.to &&
      other.block.language === this.block.language &&
      other.block.source === this.block.source &&
      other.readOnly === this.readOnly
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    return createCodeFencePreview(this.document, {
      ...this.block,
      readOnly: this.readOnly,
      onCopy: (source) => writeTextToClipboard(source, this.document),
      onEdit: () => {
        const anchor = Math.max(
          0,
          Math.min(view.state.doc.length, this.block.textFrom),
        );
        view.dispatch({ selection: { anchor }, scrollIntoView: true });
        view.focus();
      },
    });
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const refreshCodeFences = StateEffect.define<void>();

function codeFenceDecorations(state: EditorState, document: Document) {
  const decorations = [];
  for (const block of codeFences(state)) {
    if (selectionIntersects(state, block)) continue;
    decorations.push(
      Decoration.replace({
        widget: new CodeFenceWidget(block, document, state.readOnly),
        block: true,
      }).range(block.from, block.to),
    );
  }
  return Decoration.set(decorations, true);
}

export function makeCodeFenceExtension(
  document: Document = globalThis.document,
): Extension {
  const field = StateField.define({
    create: (state) => codeFenceDecorations(state, document),
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        transaction.startState.readOnly === transaction.state.readOnly &&
        !transaction.effects.some((effect) => effect.is(refreshCodeFences))
      )
        return value;
      return codeFenceDecorations(transaction.state, document);
    },
    provide: (source) => EditorView.decorations.from(source),
  });

  const viewportRefresh = ViewPlugin.fromClass(
    class {
      private scheduled = false;
      private destroyed = false;

      constructor(private readonly view: EditorView) {}

      update(update: ViewUpdate) {
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

  return [field, viewportRefresh];
}
