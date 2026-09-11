import type { Extension } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
export function insertIndentedNewline(
  view: EditorView,
  continueList?: Command,
): boolean;
export function editorIndentation(options?: {
  continueList?: Command;
}): Extension;
export function codeSourceIndentationEdit(
  text: string,
  from: number,
  to: number,
  key: string,
  shift?: boolean,
  unit?: string,
): {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
} | null;
export function wireCodeSourceIndentation(
  textarea: HTMLTextAreaElement,
  options?: { indentUnit?: string },
): () => void;
