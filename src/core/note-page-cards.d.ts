import type { AnnotationType, EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export const PAGE_PLACEHOLDER: string;

/** Add `pageExternalChange.of(true)` to a host update of the whole document. */
export const pageExternalChange: AnnotationType<boolean>;

export type NotePageCardsOptions = {
  /** Host navigation for "Open target"; without it the action is not shown. */
  onOpenTarget?: (target: string) => void;
};

export type FocusedPage = {
  target: string;
  /** Editable range of the page in document offsets. */
  from: number;
  to: number;
  /** False while the page is an empty card not yet written to the note. */
  exists: boolean;
};

/** Focus state, hiding and edit confinement; install outside source mode. */
export function notePageCards(options?: NotePageCardsOptions): Extension;
/** Card headers for the whole note; install with the preview extensions. */
export function notePageCardsPreview(): Extension;
/** Show only the page bound to `target`; null shows the whole note. */
export function focusPageTarget(
  view: EditorView,
  target: string | null,
): boolean;
export function focusedPage(state: EditorState): FocusedPage | null;
