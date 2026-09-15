import { redactSecurityBlocks } from "./core/security-model.js";
import { GFM, parser } from "@lezer/markdown";

export const NOTE_PREVIEW_LIMIT = 240;

const PREVIEW_INPUT_LIMIT = 50_000;
const previewParser = parser.configure(GFM);

/** Keep labels only for complete parsed links; destinations can contain parentheses. */
function inlineLinkLabels(source: string): string {
  const removed: { from: number; to: number }[] = [];
  previewParser.parse(source).iterate({
    enter(node) {
      if (node.name !== "Link" && node.name !== "Image") return;
      const [opening, closing, destination, end] =
        node.node.getChildren("LinkMark");
      if (
        !opening ||
        !closing ||
        !destination ||
        !end ||
        source.slice(opening.from, opening.to) !==
          (node.name === "Image" ? "![" : "[") ||
        source.slice(closing.from, destination.to) !== "](" ||
        source.slice(end.from, end.to) !== ")"
      )
        return;
      // Removing the delimiters separately also preserves labels of linked images.
      removed.push(
        { from: node.from, to: opening.to },
        { from: closing.from, to: node.to },
      );
    },
  });
  removed.sort((left, right) => left.from - right.from);
  let cursor = 0;
  const parts: string[] = [];
  for (const range of removed) {
    parts.push(source.slice(cursor, range.from));
    cursor = range.to;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

function withoutFrontmatter(source: string): string {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") return source;
  const closing = lines.findIndex(
    (line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line),
  );
  if (closing >= 0) return lines.slice(closing + 1).join("\n");
  // A truncated preview or unfinished frontmatter can still contain secrets.
  // Do not publish masked Properties keys or card-value pieces merely because
  // the closing marker is missing. Ordinary thematic breaks with prose remain.
  return lines.some((line) => {
    const marker = line.indexOf("*");
    const colon = line.indexOf(":");
    if (colon < 0) return false;
    const key = line.slice(0, colon).trim().replace(/["']$/u, "");
    return (
      /[#_]$/u.test(key) ||
      (marker >= 0 && (marker > colon || line.indexOf(":", marker + 1) >= 0))
    );
  })
    ? ""
    : source;
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = line
    .trim()
    .replace(/^\||\|$/gu, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function truncate(value: string): string {
  const characters = [...value];
  if (characters.length <= NOTE_PREVIEW_LIMIT) return value;
  return `${characters
    .slice(0, NOTE_PREVIEW_LIMIT - 1)
    .join("")
    .trimEnd()}…`;
}

export function markdownPlainPreview(markdown: string): string {
  const source = withoutFrontmatter(
    redactSecurityBlocks(String(markdown ?? "").slice(0, PREVIEW_INPUT_LIMIT))
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n"),
  );
  const meaningfulLines = source
    .split("\n")
    .filter((line) => !/^\s*(?:`{3,}|~{3,})/u.test(line))
    .filter((line) => !isTableSeparator(line))
    .filter(
      (line) => !/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u.test(line),
    )
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/gu, "")
        .replace(/^\s{0,3}#{1,6}\s+/u, "")
        .replace(/^\s*>+\s?/u, "")
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+/u, "")
        .replace(/^\s*\[[ xX]\]\s*/u, ""),
    );

  const preview = inlineLinkLabels(meaningfulLines.join(" "))
    .replace(/<(https?:\/\/[^>]+)>/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/(?:\*\*|__|~~|`)/gu, "")
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/gu, "$1")
    .replace(/\s*\|\s*/gu, " · ")
    .replace(/\\([\\`*{}[\]()#+\-.!_>])/gu, "$1")
    .replace(/&(?:nbsp|#160);/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();

  return truncate(preview);
}
