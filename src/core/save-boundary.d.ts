import type { AnnotationType } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";

export const saveAction: AnnotationType<boolean>;
export function isSaveAction(update: ViewUpdate): boolean;
export function wireSaveBoundary(
  root: HTMLElement,
  onSave: () => void,
): () => void;
