export type PreviewReorderItem = Readonly<{
  element: HTMLElement;
  /** Missing handles preserve managed/read-only items' original index slots. */
  handle?: HTMLButtonElement | null;
}>;
export type PreviewReorderOptions = Readonly<{
  root: HTMLElement;
  items: () => readonly PreviewReorderItem[];
  /** Destination is the final index after removing the source item. */
  canMove: (from: number, to: number) => boolean;
  onMove: (from: number, to: number) => void;
  /** Return false to refuse. The caller may capture a document snapshot here. */
  onStart?: () => boolean | void;
}>;
/** Handle-only pointer and Alt+ArrowUp/Down reordering, with idempotent cleanup. */
export function wirePreviewReorder(options: PreviewReorderOptions): () => void;
