import type { BrowserNote, DomainNode, PathNode, PageVisit } from "./library";

export type NavigationItem =
  | { kind: "note"; note: BrowserNote }
  | { kind: "group"; label: string; items: NavigationItem[] };

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
      label: path.path.slice(parentPath.length).replace(/^\//u, "") || "/",
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
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (!last) return "/";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

type TitledPage = Pick<BrowserNote | PageVisit, "title" | "url">;

/** Give duplicate titles just enough path/query context to identify a destination. */
export function navigationLabels(
  items: readonly TitledPage[],
): Map<string, string> {
  const labels = new Map<string, string>();
  const peers = new Map<string, TitledPage[]>();
  for (const item of items) {
    const parsed = new URL(item.url);
    const base = item.title.trim() || shortPath(item.url);
    const key = `${parsed.host}\0${base}`;
    const group = peers.get(key) ?? [];
    group.push(item);
    peers.set(key, group);
    labels.set(item.url, base);
  }
  for (const group of peers.values()) {
    if (group.length < 2) continue;
    const urls = group.map((item) => new URL(item.url));
    const segments = urls.map((url) => url.pathname.split("/").filter(Boolean));
    const maxDepth = Math.max(...segments.map((path) => path.length), 1);
    for (let index = 0; index < group.length; index++) {
      let suffix = "";
      for (let depth = 1; depth <= maxDepth; depth++) {
        const candidates = segments.map(
          (path) => path.slice(-depth).join("/") || "/",
        );
        suffix = candidates[index]!;
        if (candidates.filter((candidate) => candidate === suffix).length === 1)
          break;
      }
      const url = urls[index]!;
      const samePath = urls.filter((other) => other.pathname === url.pathname);
      if (samePath.length > 1) suffix += url.search + url.hash;
      if (samePath.some((other) => other !== url && other.href === url.href))
        suffix += ` (${index + 1})`;
      labels.set(
        group[index]!.url,
        `${labels.get(group[index]!.url)} (${suffix})`,
      );
    }
  }
  return labels;
}
