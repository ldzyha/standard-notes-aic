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
// - A bare `---` inside a ``` or ~~~ fence is never a break. A bound separator
//   (`--- <target>` after a blank line) always starts a page, fenced or not,
//   and a fence never extends past its page: an unclosed fence ends with the
//   page. Known edge: a fenced diff with a blank line followed by `--- a/file`
//   splits there.
// - The first break with only blank text before it binds page 1 instead of
//   creating an empty first page. Every later break starts its own page, also
//   when the page before it is empty; a break on the last line starts an empty
//   last page.
// Offsets index the given text; CRLF line ends are tolerated. Page 1 always
// starts at 0, so it also holds frontmatter and a leading break line; every
// later page starts after its break line and the last page ends the text.
// `separator` is the offset of the page's own break line (-1 when page 1 has
// none) and `content` the offset just after that line.
//
// A page matches a navigation target only when their normalized forms are
// equal; there is no folder or URL-prefix matching. The first match wins.

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

function scan(source) {
  const pages = [];
  const body = bodyStart(source);
  const page = (to) => ({
    from,
    to,
    target,
    separator,
    content: separator < 0 ? from : content,
  });
  let from = 0;
  let content = body;
  let separator = -1;
  let target = null;
  let blank = true;
  let fence = "";
  for (let start = body; start <= source.length;) {
    const { raw, next } = lineAt(source, start);
    const found = blank ? SEPARATOR.exec(raw) : null;
    // A bound separator starts a page even inside a fence; a bare one does not.
    const match = found && (!fence || found[1] !== undefined) ? found : null;
    if (match) {
      const empty = separator < 0 && !source.slice(content, start).trim();
      if (!empty) pages.push(page(start));
      separator = start;
      content = Math.min(next, source.length);
      if (!empty) from = content;
      target = match[1] ?? null;
      fence = "";
    } else {
      const mark = FENCE.exec(raw);
      if (fence) {
        if (mark?.[1].startsWith(fence) && !mark[2].trim()) fence = "";
      } else if (mark && !(mark[1][0] === "`" && mark[2].includes("`")))
        fence = mark[1];
    }
    blank = !match && !raw.trim();
    start = next;
  }
  pages.push(page(source.length));
  return pages;
}

export function notePages(text) {
  return scan(String(text ?? ""));
}

/** Label form of a target: a URL is shown without its username and password. */
export function displayTarget(raw) {
  const value = String(raw ?? "").trim();
  if (!URL_TARGET.test(value) || !value.includes("@")) return value;
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    url.username = url.password = "";
    return url.href;
  } catch {
    // Not parseable: never echo what may be credentials before the last `@`.
    return value.replace(/^(https?:\/\/)[^/?#]*@/iu, "$1");
  }
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

/** A bound URL without a query ignores the navigated URL's query. */
function targetMatches(bound, target) {
  const owner = normalizeTarget(bound);
  let visited = normalizeTarget(target);
  if (!owner || !visited) return false;
  if (URL_TARGET.test(owner) && !owner.includes("?"))
    visited = visited.split("?")[0];
  return owner === visited;
}

/** Index of the first page bound to exactly `target`, or -1. */
export function pageForTarget(pages, target) {
  return pages.findIndex(
    (page) => page.target !== null && targetMatches(page.target, target),
  );
}

/**
 * Text to insert at the very end of `text` to start a page bound to `target`.
 * It puts a blank line before the separator (none in an empty note) and ends
 * with a line break so that typing continues inside the new page. Returns ""
 * for a target that cannot be bound: an empty one, or one that would not be
 * read back as the last page of `text` plus the returned text.
 */
export function appendPageText(text, target) {
  const source = String(text ?? "");
  const name = String(target ?? "")
    .replace(/\s*[\r\n]+\s*/gu, " ")
    .trim();
  if (!normalizeTarget(name)) return "";
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/u);
  const last = lines.at(-1);
  let lead = eol + eol;
  if (!last.trim())
    lead = last ? eol : source && lines.at(-2).trim() ? eol : "";
  const added = `${lead}--- ${name}${eol}`;
  // A target the parser would not read back (a line break character such as
  // U+2028 inside it) cannot be bound: writing it would never find its page.
  const page = scan(source + added).at(-1);
  return page.target === name && page.content === source.length + added.length
    ? added
    : "";
}
