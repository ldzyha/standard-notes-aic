import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { selectionRevealsPreview } from "./core/structured-preview.js";
import { providePreviewRanges } from "./core/preview-ranges.js";
import { sourcePreviewExitHandlers } from "./core/source-mode.js";
import {
  createMermaidPreview,
  type MermaidPreviewController,
  type MermaidTheme,
} from "./mermaid-render";
import {
  scanMermaidCandidates,
  type MermaidCandidate,
  type MermaidScan,
} from "./mermaid-source";

export const refreshMermaidTheme = StateEffect.define<void>();

function selectionIntersects(
  state: EditorState,
  candidate: MermaidCandidate,
): boolean {
  return (
    selectionRevealsPreview(
      state.selection.ranges,
      candidate.from,
      candidate.to,
    ) ||
    state.selection.ranges.some(
      (range) =>
        range.empty &&
        range.from >= candidate.from &&
        range.from < candidate.to,
    )
  );
}

export function makeMermaidExtension({
  theme = () => "default",
  document = globalThis.document,
}: {
  theme?: () => MermaidTheme;
  document?: Document;
} = {}): Extension {
  let cachedDocument: object | null = null;
  let cachedScan: MermaidScan | null = null;
  const mounted = new WeakMap<HTMLElement, MermaidPreviewController>();
  const editingTimers = new WeakMap<
    HTMLElement,
    ReturnType<typeof setTimeout>
  >();

  const scan = (state: EditorState) => {
    if (cachedDocument !== state.doc || !cachedScan) {
      cachedDocument = state.doc;
      cachedScan = scanMermaidCandidates(state.doc.toString());
    }
    return cachedScan;
  };

  class MermaidWidget extends WidgetType {
    constructor(
      readonly candidate: MermaidCandidate,
      readonly themeName: MermaidTheme,
      readonly readOnly: boolean,
    ) {
      super();
    }

    override eq(other: MermaidWidget): boolean {
      return (
        other.readOnly === this.readOnly &&
        other.candidate.from === this.candidate.from &&
        other.candidate.decorationTo === this.candidate.decorationTo &&
        other.candidate.source === this.candidate.source &&
        other.themeName === this.themeName
      );
    }

    override toDOM(view: EditorView): HTMLElement {
      const controller = createMermaidPreview({
        source: this.candidate.source,
        theme: this.themeName,
        document,
        onEdit: () => {
          const anchor = Math.max(
            0,
            Math.min(view.state.doc.length, this.candidate.textFrom),
          );
          view.dispatch({ selection: { anchor }, scrollIntoView: true });
          view.focus();
        },
      });
      controller.element.dataset.aicSourceFrom = String(this.candidate.from);
      controller.element.dataset.aicSourceTo = String(
        this.candidate.decorationTo,
      );
      mounted.set(controller.element, controller);
      return controller.element;
    }

    override destroy(element: HTMLElement): void {
      mounted.get(element)?.destroy();
      mounted.delete(element);
    }

    override ignoreEvent(): boolean {
      return true;
    }
  }

  class EditingMermaidWidget extends WidgetType {
    constructor(
      readonly candidate: MermaidCandidate,
      readonly themeName: MermaidTheme,
    ) {
      super();
    }

    override eq(other: EditingMermaidWidget): boolean {
      return (
        this.candidate.source === other.candidate.source &&
        this.themeName === other.themeName
      );
    }

    override toDOM(): HTMLElement {
      const controller = createMermaidPreview({
        source: this.candidate.source,
        theme: this.themeName,
        document,
      });
      controller.element.classList.add("cm-mermaid-editing");
      mounted.set(controller.element, controller);
      return controller.element;
    }

    override updateDOM(element: HTMLElement): boolean {
      const timer = editingTimers.get(element);
      if (timer) clearTimeout(timer);
      editingTimers.set(
        element,
        setTimeout(() => {
          editingTimers.delete(element);
          void mounted
            .get(element)
            ?.update(this.candidate.source, this.themeName);
        }, 300),
      );
      return true;
    }

    override destroy(element: HTMLElement): void {
      const timer = editingTimers.get(element);
      if (timer) clearTimeout(timer);
      editingTimers.delete(element);
      mounted.get(element)?.destroy();
      mounted.delete(element);
    }

    override ignoreEvent(): boolean {
      return true;
    }
  }

  const decorations = (state: EditorState) => {
    const replacements = [];
    const themeName = theme();
    for (const candidate of scan(state).candidates) {
      if (selectionIntersects(state, candidate)) {
        replacements.push(
          Decoration.widget({
            widget: new EditingMermaidWidget(candidate, themeName),
            block: true,
            side: 1,
          }).range(candidate.decorationTo),
        );
        continue;
      }
      replacements.push(
        Decoration.replace({
          widget: new MermaidWidget(candidate, themeName, state.readOnly),
          block: true,
        }).range(candidate.from, candidate.decorationTo),
      );
    }
    return Decoration.set(replacements, true);
  };

  const field = StateField.define({
    create: decorations,
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        transaction.startState.readOnly === transaction.state.readOnly &&
        !transaction.effects.some((effect) => effect.is(refreshMermaidTheme))
      ) {
        return value;
      }
      return decorations(transaction.state);
    },
    provide: providePreviewRanges,
  });
  return [
    sourcePreviewExitHandlers.of(
      (state) =>
        scan(state).candidates.find((candidate) =>
          state.selection.ranges.some(
            (range) =>
              range.empty &&
              range.head >= candidate.from &&
              range.head < candidate.decorationTo,
          ),
        ) ?? null,
    ),
    field,
  ];
}
