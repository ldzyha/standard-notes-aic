import type { EditorView } from "@codemirror/view";
import type { EditorState, Extension } from "@codemirror/state";
import type { StateEffectType, Facet } from "@codemirror/state";

export const SOURCE_MODE_CORE_VERSION: "1.1.0";
export const sourcePreviewExit: StateEffectType<void>;
export const sourcePreviewExitHandlers: Facet<
  (state: EditorState) => { from: number; to: number } | null,
  readonly ((state: EditorState) => { from: number; to: number } | null)[]
>;
export type SourceMode = "preview" | "source";
export type SourceModeController = Readonly<{
  mode: SourceMode;
  extension: (previewExtensions: Extension) => Extension;
  /** Retains but suspends any visual diagram draft while source mode is active. */
  toggle: (view: EditorView | null | undefined) => SourceMode;
  reset: () => void;
  createButton: (
    document: Document,
    getView: () => EditorView | null | undefined,
    className?: string,
  ) => HTMLButtonElement;
}>;
export function createSourceModeController(): SourceModeController;
