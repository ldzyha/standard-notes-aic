import type { EditorState, Extension } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import type { DetailsBlock } from "./details-model.js";

export function createDetailsSummary(
  document: Document,
  options: {
    block: DetailsBlock;
    open: boolean;
    readOnly: boolean;
    onToggle: () => void;
    onCheck: () => void;
    onOpen: () => void;
  },
): { row: HTMLDivElement; actions: HTMLDivElement };
export class DetailsEndWidget extends WidgetType {
  eq(): boolean;
  toDOM(view: EditorView): HTMLElement;
}
export function detailsBodyLayout(
  openBlocks: (state: EditorState) => readonly DetailsBlock[],
): Extension;
