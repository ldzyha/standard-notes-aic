export const NOTE_PREVIEW_LIMIT = 240;

const PREVIEW_INPUT_LIMIT = 50_000;

function withoutFrontmatter(source: string): string {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") return source;
  const closing = lines.findIndex(
    (line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line),
  );
  return closing < 0 ? source : lines.slice(closing + 1).join("\n");
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
    String(markdown ?? "")
      .slice(0, PREVIEW_INPUT_LIMIT)
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

  const preview = meaningfulLines
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
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
