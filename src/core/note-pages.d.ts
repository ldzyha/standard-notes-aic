export type NotePage = {
  /** 0 for page 1, otherwise the offset just after the page's separator line. */
  from: number;
  /** Offset where the page ends: the next separator line or the text end. */
  to: number;
  /** Navigation target written after the separator, or null when unbound. */
  target: string | null;
  /** Offset of the page's own separator line, or -1 when page 1 has none. */
  separator: number;
  /** Offset just after the separator line; equals `from` without one. */
  content: number;
};

/** Split note text into pages; always returns at least one page. */
export function notePages(text: string): NotePage[];
/** Target as shown in labels: URL credentials are removed. */
export function displayTarget(raw: string | null | undefined): string;
/**
 * Comparison form of a target. URL: `scheme://host/path?query` without a
 * trailing `/`. Path: trimmed, NFC, `\` as `/`, no trailing `/`, lower-case;
 * a leading `/` or `./` is kept, so only full paths written alike match.
 */
export function normalizeTarget(raw: string): string;
/** Index of the first page whose target equals `target` when normalized, or -1. */
export function pageForTarget(
  pages: readonly NotePage[],
  target: string,
): number;
/**
 * Exact text to insert at the end of `text` to start a page for `target`; an
 * open code fence is left as written. Returns "" for a target that cannot be
 * bound: an empty one, or one that would not read back as the last page.
 */
export function appendPageText(text: string, target: string): string;
