// One note as a notebook: pages are a read-only view over the note text.
//
// A page break is a line that is exactly `---`, optionally followed by
// whitespace and a navigation target (`--- /src/app/editor.ts`,
// `--- https://example.com/docs`). The target binds the page that follows.
// - Four or more dashes, `- - -`, `***`, `___` and indented rules are ordinary
//   thematic breaks, never page breaks.
// - The line must start the body or follow a blank line, so `---` directly
//   under a paragraph remains a setext heading.
// - Leading frontmatter (a bare `---` first line up to the next bare `---`
//   line) belongs to page 1 and is never a break.
// - Nothing inside a ``` or ~~~ fence counts; an unclosed fence runs to the end.
// - A break with only blank text before it binds page 1 instead of creating an
//   empty first page; a break on the last line starts an empty last page.
// Offsets index the given text; CRLF line ends are tolerated.

const SEPARATOR = /^---(?:[ \t]+(\S.*?))?[ \t]*$/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const URL_TARGET = /^https?:\/\//iu;

function lineAt(text, start) {
  const end = text.indexOf("\n", start);
  const to = end < 0 ? text.length : end;
  return {
    raw: text.slice(start, to).replace(/\r$/u, ""),
    next: end < 0 ? text.length + 1 : end + 1,
  };
}

function bodyStart(text) {
  let line = lineAt(text, 0);
  if (line.raw.trim() !== "---") return 0;
  while (line.next <= text.length) {
    const start = line.next;
    line = lineAt(text, start);
    if (line.raw.trim() === "---") return Math.min(line.next, text.length);
  }
  return 0;
}

export function notePages(text) {
  const source = String(text ?? "");
  const pages = [];
  const body = bodyStart(source);
  let from = 0;
  let content = body;
  let target = null;
  let blank = true;
  let fence = "";
  for (let start = body; start <= source.length;) {
    const { raw, next } = lineAt(source, start);
    const mark = FENCE.exec(raw);
    const match = !fence && blank ? SEPARATOR.exec(raw) : null;
    if (fence) {
      if (mark?.[1].startsWith(fence) && !mark[2].trim()) fence = "";
    } else if (mark && !(mark[1][0] === "`" && mark[2].includes("`")))
      fence = mark[1];
    else if (match) {
      if (pages.length || source.slice(content, start).trim())
        pages.push({ from, to: start, target });
      from = content = Math.min(next, source.length);
      target = match[1] ?? null;
    }
    blank = !match && !raw.trim();
    start = next;
  }
  pages.push({ from, to: source.length, target });
  return pages;
}

/** Canonical comparison form: `scheme://host/path?query` or a lower-case path. */
export function normalizeTarget(raw) {
  const value = String(raw ?? "").trim();
  if (URL_TARGET.test(value)) {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/u, "")}${url.search}`;
    } catch {
      // Not a usable URL: compare it as a path so it can only match itself.
    }
  }
  return value
    .normalize("NFC")
    .replaceAll("\\", "/")
    .replace(/^(?:\.?\/)+/u, "")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

/**
 * 0 when `bound` does not cover `target`, otherwise the length of the
 * normalized bound target (longer is more specific). A bound URL without a
 * query ignores the navigated query; one with a query needs an exact match.
 * URLs and folders also cover everything below them at a segment boundary.
 */
export function targetSpecificity(bound, target) {
  const owner = normalizeTarget(bound);
  let visited = normalizeTarget(target);
  const url = URL_TARGET.test(owner);
  if (!owner || !visited || url !== URL_TARGET.test(visited)) return 0;
  const exact = url && owner.includes("?");
  if (url && !exact) visited = visited.split("?")[0];
  return visited === owner || (!exact && visited.startsWith(`${owner}/`))
    ? owner.length
    : 0;
}

/** Index of the most specific page bound to `target`; ties keep the first. */
export function pageForTarget(pages, target) {
  let best = -1;
  let score = 0;
  pages.forEach((page, index) => {
    const next = page.target ? targetSpecificity(page.target, target) : 0;
    if (next > score) [best, score] = [index, next];
  });
  return best;
}
