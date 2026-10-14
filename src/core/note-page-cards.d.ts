import type {
  Annotation,
  AnnotationType,
  EditorState,
  Extension,
  Transaction,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export const PAGE_PLACEHOLDER: string;

/** Add `pageExternalChange.of(true)` to a host update of the whole document. */
export const pageExternalChange: AnnotationType<boolean>;

/**
 * Annotations for a host update of the document: `pageExternalChange` plus
 * `Transaction.addToHistory.of(false)`, so the update is never an undo step.
 */
export function pageExternalAnnotations(): Annotation<unknown>[];

export type NotePageCardsOptions = {
  /** Host navigation for "Open target"; without it the action is not shown. */
  onOpenTarget?: (target: string) => void;
  /** Targets that get "Open target"; all of them when omitted. */
  canOpenTarget?: (target: string) => boolean;
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
/**
 * Undo history owned by the page cards; install it instead of CodeMirror's
 * `history()` and pass the same config. `focusPageTarget` empties it whenever
 * the focused target changes, so undo never reaches another focus's edits.
 */
export function notePageHistory(config?: {
  minDepth?: number;
  newGroupDelay?: number;
  joinToEvent?: (transaction: Transaction, isAdjacent: boolean) => boolean;
}): Extension;
/** Card headers for the whole note; install with the preview extensions. */
export function notePageCardsPreview(): Extension;
/**
 * Show only the page bound to `target`; null shows the whole note. A change
 * of target empties the `notePageHistory` undo history.
 */
export function focusPageTarget(
  view: EditorView,
  target: string | null,
): boolean;
export function focusedPage(state: EditorState): FocusedPage | null;
