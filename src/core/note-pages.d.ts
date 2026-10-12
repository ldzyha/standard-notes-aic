export type NotePage = {
  /** Offset of the first character of the page content. */
  from: number;
  /** Offset where the page ends: the next separator line or the text end. */
  to: number;
  /** Navigation target written after the separator, or null when unbound. */
  target: string | null;
};

/** Split note text into pages; always returns at least one page. */
export function notePages(text: string): NotePage[];
export function normalizeTarget(raw: string): string;
export function targetSpecificity(bound: string, target: string): number;
export function pageForTarget(
  pages: readonly NotePage[],
  target: string,
): number;
