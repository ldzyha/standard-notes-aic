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

function hasProperty(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped}:[ \\t]*(.*?)[ \\t]*$`, "mu").test(body);
}

function hasLegacyGeneratedNoteProperties(body) {
  return (
    property(body, "title").trim() !== "" &&
    ["file-note", "folder-note", "project-note"].includes(
      property(body, "level").toLowerCase(),
    ) &&
    hasProperty(body, "scope") &&
    property(body, "scope") === "" &&
    property(body, "status").toLowerCase() === "live" &&
    property(body, "agent").toLowerCase() === "true" &&
    property(body, "created") !== "" &&
    property(body, "updated") !== ""
  );
}

export function isManagedNoteName(value) {
  const name = baseName(value).toLowerCase();
  return name.endsWith(".note.md");
}

// Kept as a compatibility alias for clients released before managed metadata
// moved from ordinary Markdown documents to note sidecars.
export const isMarkdownDocumentName = isManagedNoteName;

export function stampFileProperties(
  markdown,
  { fileName, createdAt, updatedAt } = {},
) {
  const source = String(markdown ?? "");
  const file = baseName(fileName);
  const updated = String(updatedAt ?? "").trim();
  if (!file || !updated) return source;

  const match = FRONTMATTER.exec(source);
  if (!isManagedNoteName(file)) {
    // v16.2 briefly stamped ordinary Markdown files. Remove only that exact
    // managed signature, and never treat arbitrary authored dates as ours.
    if (
      !match ||
      baseName(property(match[1], "file")).toLowerCase() !==
        file.toLowerCase() ||
      !property(match[1], "created") ||
      !property(match[1], "updated")
    )
      return source;
    const eol = lineEnding(source);
    const authored = match[1]
      .split(/\r\n|\n|\r/u)
      .filter((line) => !/^(?:file|created|updated):[ \t]*/u.test(line));
    while (authored[0] === "") authored.shift();
    while (authored.at(-1) === "") authored.pop();
    const body = source.slice(match[0].length);
    if (authored.length) {
      const header = ["---", ...authored, "---"].join(eol);
      if (!body) return `${header}${eol}`;
      return `${header}${eol}${body.startsWith(eol) ? "" : eol}${body}`;
    }
    return body.startsWith(eol) ? body.slice(eol.length) : body;
  }

  const created =
    (match ? property(match[1], "created") : "") ||
    String(createdAt ?? updated).trim() ||
    updated;
  const eol = lineEnding(source);
  const managed = [
    `file: ${scalar(file)}`,
    `created: ${scalar(created)}`,
    `updated: ${scalar(updated)}`,
  ];

  // Notes can already contain authored frontmatter. Replace only the three
  // root-level fields owned by this module. Releases before Core 2.7 also
  // generated a complete title/level/scope/status/agent signature; remove
  // those five keys only when the entire exact legacy signature is present.
  const legacyGenerated = match
    ? hasLegacyGeneratedNoteProperties(match[1])
    : false;
  const authored = match
    ? match[1]
        .split(/\r\n|\n|\r/u)
        .filter(
          (line) =>
            !(
              /^(?:file|created|updated):[ \t]*/u.test(line) ||
              (legacyGenerated &&
                /^(?:title|level|scope|status|agent):[ \t]*/u.test(line))
            ),
        )
    : [];
  while (authored[0] === "") authored.shift();
  while (authored.at(-1) === "") authored.pop();
  const header = ["---", ...managed, ...authored, "---"].join(eol);

  if (!match)
    return source ? `${header}${eol}${eol}${source}` : `${header}${eol}`;

  const body = source.slice(match[0].length);
  if (!body) return `${header}${eol}`;
  return `${header}${eol}${body.startsWith(eol) ? "" : eol}${body}`;
}
