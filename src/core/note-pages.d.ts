export type NotePage = {
  /** 0 for page 1, otherwise the offset just after the page's separator line. */
  from: number;
  /** Offset where the page ends: the next separator line or the text end. */
  to: number;
  /** Navigation target written after the separator, or null when unbound. */
  target: string | null;
};

/** Split note text into pages; always returns at least one page. */
export function notePages(text: string): NotePage[];
/** Target as shown in labels: URL credentials are removed. */
export function displayTarget(raw: string | null | undefined): string;
export function normalizeTarget(raw: string): string;
export function targetSpecificity(bound: string, target: string): number;
export function pageForTarget(
  pages: readonly NotePage[],
  target: string,
): number;
