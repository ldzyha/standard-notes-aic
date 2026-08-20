import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
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
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.from >= candidate.from && range.from < candidate.to
      : range.from < candidate.to && range.to > candidate.from,
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
    ) {
      super();
    }

    override eq(other: MermaidWidget): boolean {
      return (
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

  const decorations = (state: EditorState) => {
    const replacements = [];
    const themeName = theme();
    for (const candidate of scan(state).candidates) {
      if (selectionIntersects(state, candidate)) continue;
      replacements.push(
        Decoration.replace({
          widget: new MermaidWidget(candidate, themeName),
          block: true,
        }).range(candidate.from, candidate.decorationTo),
      );
    }
    return Decoration.set(replacements, true);
  };

  return StateField.define({
    create: decorations,
    update(value, transaction) {
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        !transaction.effects.some((effect) => effect.is(refreshMermaidTheme))
      ) {
        return value;
      }
      return decorations(transaction.state);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
