import type { BrowserNote, DomainNode, PathNode, PageVisit } from "./library";

export type NavigationItem =
  | { kind: "note"; note: BrowserNote }
  | { kind: "group"; label: string; items: NavigationItem[] };

const MAX_TITLE_LENGTH = 72;
const MAX_LOCATION_LENGTH = 88;
const MAX_NAVIGATION_LABEL_LENGTH = 112;
const MAX_GROUP_LABEL_LENGTH = 64;

function bounded(value: string, maximum: number): string {
  const characters = Array.from(value);
  if (characters.length <= maximum) return value;
  return `${characters.slice(0, Math.max(1, maximum - 1)).join("")}…`;
}

function boundedMiddle(value: string, maximum: number): string {
  const characters = Array.from(value);
  if (characters.length <= maximum) return value;
  const available = Math.max(2, maximum - 1);
  const start = Math.ceil(available / 2);
  const end = Math.floor(available / 2);
  return `${characters.slice(0, start).join("")}…${characters.slice(-end).join("")}`;
}

function cleanText(value: string): string {
  return value
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function displaySegment(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  // Encoded query/fragment delimiters are still URL metadata, not path labels.
  return cleanText(decoded.split(/[?#]/u, 1)[0] ?? "");
}

function displaySegments(parsed: URL): string[] {
  return parsed.pathname
    .split("/")
    .filter(Boolean)
    .map(displaySegment)
    .filter(Boolean);
}

function safeLocation(parsed: URL, depth = 2): string {
  const segments = displaySegments(parsed);
  const suffix = segments.slice(-depth).join("/");
  return `${parsed.host}${suffix ? `/${suffix}` : "/"}`;
}

function samePageLocation(left: URL, right: URL): boolean {
  return (
    left.protocol === right.protocol &&
    left.host === right.host &&
    left.pathname === right.pathname
  );
}

function sanitizeCapturedTitle(title: string, pageUrl: URL): string {
  let text = cleanText(title);
  if (!text) return "";

  try {
    const titleUrl = new URL(text);
    if (/^https?:$/u.test(titleUrl.protocol)) return "";
  } catch {
    // Ordinary titles are expected to be non-URLs.
  }

  text = text.replace(/https?:\/\/[^\s<>"']+/giu, (candidate, offset) => {
    try {
      const embedded = new URL(candidate);
      if (!/^https?:$/u.test(embedded.protocol)) return "";
      if (
        samePageLocation(embedded, pageUrl) &&
        cleanText(text.slice(0, offset)).length > 0
      )
        return "";
      return displayPageLocation(embedded.href);
    } catch {
      return "";
    }
  });

  // Old captures could append the active page's raw URL metadata to a useful
  // title. Remove only exact page metadata or unmistakable parameter syntax;
  // ordinary punctuation in legitimate titles remains intact.
  for (const metadata of [pageUrl.search, pageUrl.hash])
    if (metadata) text = text.replaceAll(metadata, "");
  for (const key of new Set(pageUrl.searchParams.keys())) {
    const encodedKey = encodeURIComponent(key);
    const indexes = [text.indexOf(`${key}=`), text.indexOf(`${encodedKey}%3D`)]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right);
    if (indexes[0] !== undefined) text = text.slice(0, indexes[0]);
  }
  const rawParameters = text.search(/[?&][\p{L}\p{N}_.%+-]+\s*=/u);
  if (rawParameters >= 0) text = text.slice(0, rawParameters);
  const encodedParameters = text.search(
    /%(?:25)*3[fF][\p{L}\p{N}_.%+-]+%(?:25)*3[dD]/u,
  );
  if (encodedParameters >= 0) text = text.slice(0, encodedParameters);
  return cleanText(text).replace(/[\s·|—–-]+$/u, "");
}

function descendants(path: PathNode): BrowserNote[] {
  return [
    ...path.notes,
    ...path.children.flatMap((child) => descendants(child)),
  ];
}

function projectPath(path: PathNode, parentPath: string): NavigationItem[] {
  const notes = descendants(path);
  if (notes.length < 2) return notes.map((note) => ({ kind: "note", note }));

  // A unary chain is one grouping location, not a stack of URL breadcrumbs.
  if (path.notes.length === 0 && path.children.length === 1)
    return projectPath(path.children[0]!, parentPath);

  const items: NavigationItem[] = [
    ...path.notes.map((note): NavigationItem => ({ kind: "note", note })),
    ...path.children.flatMap((child) => projectPath(child, path.path)),
  ];
  return [
    {
      kind: "group",
      label: boundedMiddle(
        path.path
          .slice(parentPath.length)
          .replace(/^\//u, "")
          .split("/")
          .map(displaySegment)
          .filter(Boolean)
          .join("/") || "/",
        MAX_GROUP_LABEL_LENGTH,
      ),
      items,
    },
  ];
}

/** Compact, read-only view of the existing storage-oriented domain tree. */
export function projectDomain(domain: DomainNode): NavigationItem[] {
  return [
    ...domain.notes.map((note): NavigationItem => ({ kind: "note", note })),
    ...domain.paths.flatMap((path) => projectPath(path, "")),
  ];
}

export function shortPath(url: string): string {
  const parsed = new URL(url);
  const segments = displaySegments(parsed);
  const last = segments.at(-1);
  if (!last) return "/";
  return bounded(last, 48);
}

type TitledPage = Pick<BrowserNote | PageVisit, "title" | "url">;

/** A bounded page title that never presents URL credentials, query or fragment data. */
export function displayPageTitle(page: TitledPage): string {
  const parsed = new URL(page.url);
  const title = sanitizeCapturedTitle(page.title, parsed);
  if (title) return bounded(title, MAX_TITLE_LENGTH);
  const path = shortPath(page.url);
  return bounded(path === "/" ? parsed.host : path, MAX_TITLE_LENGTH);
}

/** A bounded tooltip/location with domain and path only. */
export function displayPageLocation(url: string): string {
  return bounded(safeLocation(new URL(url)), MAX_LOCATION_LENGTH);
}

function duplicateContext(group: readonly TitledPage[], index: number): string {
  const urls = group.map((item) => new URL(item.url));
  const paths = urls.map(displaySegments);
  const maximumDepth = Math.max(...paths.map((segments) => segments.length), 1);
  let context = safeLocation(urls[index]!, 1);
  for (let depth = 1; depth <= maximumDepth; depth++) {
    const candidates = urls.map((url) => safeLocation(url, depth));
    context = candidates[index]!;
    if (candidates.filter((candidate) => candidate === context).length === 1)
      return context;
  }
  return context;
}

function labelWithContext(
  title: string,
  context: string,
  ordinal?: number,
): string {
  const ordinalLabel = ordinal === undefined ? "" : ` · ${ordinal}`;
  const safeContext = `${boundedMiddle(
    context,
    48 - Array.from(ordinalLabel).length,
  )}${ordinalLabel}`;
  const available = Math.max(
    12,
    MAX_NAVIGATION_LABEL_LENGTH - Array.from(safeContext).length - 3,
  );
  return `${bounded(title, available)} (${safeContext})`;
}

/** Give duplicate titles safe domain/path context, never query or fragment data. */
export function navigationLabels(
  items: readonly TitledPage[],
): Map<string, string> {
  const labels = new Map<string, string>();
  const peers = new Map<string, TitledPage[]>();
  for (const item of items) {
    const base = displayPageTitle(item);
    const key = base.toLocaleLowerCase();
    const group = peers.get(key) ?? [];
    group.push(item);
    peers.set(key, group);
    labels.set(item.url, base);
  }
  for (const group of peers.values()) {
    if (group.length < 2) continue;
    const contexts = group.map((_, index) => duplicateContext(group, index));
    const displayedContexts = contexts.map((context) =>
      boundedMiddle(context, 48),
    );
    for (let index = 0; index < group.length; index++) {
      const item = group[index]!;
      const displayedContext = displayedContexts[index]!;
      const collisions = displayedContexts.filter(
        (candidate) => candidate === displayedContext,
      );
      const ordinal =
        collisions.length > 1
          ? displayedContexts
              .slice(0, index + 1)
              .filter((candidate) => candidate === displayedContext).length
          : undefined;
      labels.set(
        item.url,
        labelWithContext(displayPageTitle(item), contexts[index]!, ordinal),
      );
    }
  }
  return labels;
}
