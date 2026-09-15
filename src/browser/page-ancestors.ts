import type { BrowserNote } from "./library";
import { normalizePageUrl } from "./library";

/** Metadata-only link for a saved page on the current page's URL path. */
export interface PageAncestorLink {
  url: string;
  title: string;
  depth: number;
}

function pathSegments(pathname: string): string[] {
  if (pathname === "/") return [];
  const segments = pathname.slice(1).split("/");
  // Treat the conventional directory spellings /a and /a/ as one hierarchy
  // level. Internal empty segments remain significant: /a//b is not /a/b.
  if (segments.at(-1) === "") segments.pop();
  return segments;
}

function isStrictSegmentAncestor(
  candidate: readonly string[],
  current: readonly string[],
): boolean {
  return (
    candidate.length < current.length &&
    candidate.every((segment, index) => segment === current[index])
  );
}

/**
 * Project saved page notes onto a root-to-leaf ancestor chain for one page.
 *
 * The hierarchy is deliberately conservative: origins must match exactly,
 * query- or fragment-specific notes cannot become shared parents, and only a
 * strict path-segment prefix qualifies. Returned values omit Markdown so a
 * compact relationship view cannot accidentally inherit or copy note content.
 */
export function savedPageAncestors(
  currentUrl: string,
  notes: readonly BrowserNote[],
): PageAncestorLink[] {
  const current = new URL(normalizePageUrl(currentUrl));
  const currentSegments = pathSegments(current.pathname);
  const links: PageAncestorLink[] = [];

  for (const note of notes) {
    let candidate: URL;
    try {
      candidate = new URL(normalizePageUrl(note.url));
    } catch {
      // Library input is validated at the vault boundary. Fail closed if a
      // caller nevertheless supplies an untrusted partial snapshot.
      continue;
    }
    if (
      candidate.origin !== current.origin ||
      candidate.search ||
      candidate.hash
    )
      continue;
    const segments = pathSegments(candidate.pathname);
    if (!isStrictSegmentAncestor(segments, currentSegments)) continue;
    links.push({
      url: candidate.href,
      title: note.title,
      depth: segments.length,
    });
  }

  return links.sort(
    (left, right) =>
      left.depth - right.depth || left.url.localeCompare(right.url),
  );
}
