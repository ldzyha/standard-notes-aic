const FRONTMATTER =
  /^---[ \t]*(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)(?:---|\.\.\.)[ \t]*(?:(?:\r\n|\n|\r)|$)/u;

function lineEnding(source) {
  if (source.includes("\r\n")) return "\r\n";
  if (source.includes("\r")) return "\r";
  return "\n";
}

function baseName(value) {
  return (
    String(value ?? "")
      .replaceAll("\\", "/")
      .split("/")
      .pop()
      ?.trim() ?? ""
  );
}

function scalar(value) {
  const text = String(value ?? "").trim();
  const unsafeCharacter = [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 0x1f || code === 0x7f || "#[]{},&*!|>'\"%@`".includes(character)
    );
  });
  if (
    text &&
    !/^(?:null|~|true|false|yes|no|on|off)$/iu.test(text) &&
    !unsafeCharacter &&
    !/:(?:[ \t]|$)/u.test(text) &&
    !/^[-?][ \t]/u.test(text)
  )
    return text;
  return JSON.stringify(text);
}

function decodedScalar(value) {
  const text = String(value ?? "").trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const decoded = JSON.parse(text);
      if (typeof decoded === "string") return decoded;
    } catch {
      // Keep malformed or manually-authored YAML intact as a plain value.
    }
  }
  if (text.startsWith("'") && text.endsWith("'"))
    return text.slice(1, -1).replaceAll("''", "'");
  return text;
}

function property(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^${escaped}:[ \\t]*(.*?)[ \\t]*$`, "mu").exec(body);
  return match ? decodedScalar(match[1]) : "";
}

export function isMarkdownDocumentName(value) {
  const name = baseName(value).toLowerCase();
  return name.endsWith(".md") && !name.endsWith(".note.md");
}

export function stampFileProperties(
  markdown,
  { fileName, createdAt, updatedAt } = {},
) {
  const source = String(markdown ?? "");
  const file = baseName(fileName);
  const updated = String(updatedAt ?? "").trim();
  if (!isMarkdownDocumentName(file) || !updated) return source;

  const match = FRONTMATTER.exec(source);
  const created =
    (match ? property(match[1], "created") : "") ||
    String(createdAt ?? updated).trim() ||
    updated;
  const eol = lineEnding(source);
  const header = [
    "---",
    `file: ${scalar(file)}`,
    `created: ${scalar(created)}`,
    `updated: ${scalar(updated)}`,
    "---",
  ].join(eol);

  if (!match)
    return source ? `${header}${eol}${eol}${source}` : `${header}${eol}`;

  const body = source.slice(match[0].length);
  if (!body) return `${header}${eol}`;
  return `${header}${eol}${body.startsWith(eol) ? "" : eol}${body}`;
}
