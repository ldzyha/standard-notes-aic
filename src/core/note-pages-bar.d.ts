import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export function notePagesBar(): Extension;
export function currentNotePage(state: EditorState): number;
export function showNotePage(view: EditorView, index: number): boolean;
