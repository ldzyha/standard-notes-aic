import { Document, isAlias, isMap, isScalar, parseDocument, visit } from "yaml";

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

function property(document, key) {
  const value = document.get(key, true);
  return isScalar(value) ? String(value.value ?? "") : "";
}

function hasLegacyGeneratedNoteProperties(document) {
  return (
    ["title", "level", "scope", "status", "agent", "created", "updated"].every(
      (key) => isScalar(document.get(key, true)),
    ) &&
    property(document, "title").trim() !== "" &&
    ["file-note", "folder-note", "project-note"].includes(
      property(document, "level").toLowerCase(),
    ) &&
    document.has("scope") &&
    property(document, "scope") === "" &&
    property(document, "status").toLowerCase() === "live" &&
    property(document, "agent").toLowerCase() === "true" &&
    property(document, "created") !== "" &&
    property(document, "updated") !== ""
  );
}

function astValue(node) {
  if (isMap(node))
    return [
      "map",
      node.items.map((pair) => [astValue(pair.key), astValue(pair.value)]),
    ];
  if (node?.items) return ["seq", node.items.map(astValue)];
  return [
    "scalar",
    typeof node?.value === "bigint"
      ? ["integer", String(node.value)]
      : (node?.value ?? null),
  ];
}

// Save changes only owned tokens. Re-stringifying the whole AST can round an
// authored numeric code or alter scalar spelling, comments and flow-map layout.
function stampYaml(body, document, values, eol) {
  const map = document.contents;
  const edits = [];
  const edit = (from, to, text = "") => {
    if (from !== to || text) edits.push({ from, to, text });
  };
  const removed = hasLegacyGeneratedNoteProperties(document)
    ? new Set(
        map.items.filter((pair) =>
          ["title", "level", "scope", "status", "agent"].includes(
            pair.key.value,
          ),
        ),
      )
    : new Set();
  for (const pair of removed) {
    edit(pair.key.range[0], pair.key.range[1]);
    for (const token of pair.srcToken.sep)
      if (token.type === "map-value-ind")
        edit(token.offset, token.offset + token.source.length);
    const node = pair.value;
    if (node.srcToken?.type === "block-scalar") {
      const token = node.srcToken;
      const header = token.props.find(
        (part) => part.type === "block-scalar-header",
      );
      edit(header.offset, header.offset + header.source.length);
      const start =
        token.props.at(-1).offset + token.props.at(-1).source.length;
      edit(start, start + token.source.length);
    } else edit(node.range[0], node.range[1]);
  }
  if (map?.flow && removed.size) {
    let seen = false;
    for (const pair of map.items) {
      if (removed.has(pair) || !seen)
        for (const token of pair.srcToken.start)
          if (token.type === "comma") edit(token.offset, token.offset + 1);
      if (!removed.has(pair)) seen = true;
    }
  }
  if (map) map.items = map.items.filter((pair) => !removed.has(pair));
  const missing = [];
  for (const [key, value] of values) {
    const node = document.get(key, true);
    if (!node) {
      missing.push([key, value]);
      continue;
    }
    // Creation metadata is immutable once populated, including scalar type.
    if (
      (key === "created" && property(document, key) !== "") ||
      node.value === value
    )
      continue;
    const [from, to] = node.range;
    let text = JSON.stringify(value);
    if (node.srcToken?.type === "block-scalar") {
      const comments = node.srcToken.props
        .filter((token) => token.type === "comment")
        .map((token) => token.source);
      if (comments.length) text += " " + comments.join(" ");
      if (/[\r\n]$/u.test(body.slice(from, to))) text += eol;
    } else if (from === to) {
      if (from > 0 && !/[\s[{,]/u.test(body[from - 1])) text = " " + text;
      if (body[from] === "#") text += " ";
    }
    edit(from, to, text);
    node.value = value;
  }
  if (missing.length) {
    if (map?.flow) {
      const trailing = map.srcToken.items.at(-1);
      if (!trailing?.key)
        for (const token of trailing?.start ?? [])
          if (token.type === "comma") edit(token.offset, token.offset + 1);
      const close = map.srcToken.end.find(
        (token) => token.type === "flow-map-end",
      );
      edit(
        close.offset,
        close.offset,
        (map.items.length ? ", " : "") +
          missing
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join(", "),
      );
      for (const [key, value] of missing)
        map.add(document.createPair(key, value));
    } else {
      const prefix = new Document(Object.fromEntries(missing))
        .toString({ lineWidth: 0 })
        .replaceAll("\n", eol);
      const offset = map?.range[0] ?? body.length;
      edit(
        offset,
        offset,
        (offset > 0 && !/[\r\n]/u.test(body[offset - 1]) ? eol : "") + prefix,
      );
      if (map)
        map.items.unshift(
          ...missing.map(([key, value]) => document.createPair(key, value)),
        );
      else document.contents = document.createNode(Object.fromEntries(missing));
    }
  }
  let result = "",
    offset = 0;
  const ordered = [
    ...new Map(edits.map((entry) => [JSON.stringify(entry), entry])).values(),
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const entry of ordered) {
    if (entry.from < offset) throw new TypeError("Invalid metadata edit");
    result += body.slice(offset, entry.from) + entry.text;
    offset = entry.to;
  }
  result += body.slice(offset);
  const verified = parseDocument(result, {
    uniqueKeys: true,
    intAsBigInt: true,
  });
  if (
    verified.errors.length ||
    verified.warnings.length ||
    JSON.stringify(astValue(verified.contents)) !==
      JSON.stringify(astValue(document.contents))
  )
    throw new TypeError("Invalid metadata edit");
  return !map && missing.length
    ? result.replace(/(?:\r\n|\n|\r)$/u, "")
    : result;
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
    // Earlier versions stamped ordinary Markdown, but this triplet has no
    // provenance marker. It may be authored YAML, so never remove it here.
    return source;
  }

  const eol = lineEnding(source);
  // Invalid/unfinished frontmatter must remain recoverable through source Edit.
  // Never prepend a second header or partially rewrite an ambiguous YAML map.
  if (!match && /^---[ \t]*(?:\r\n|\n|\r)/u.test(source)) return source;
  if (match && match[1].length > 64 * 1024) return source;
  let document;
  let yaml;
  try {
    document = match
      ? parseDocument(match[1], {
          uniqueKeys: true,
          keepSourceTokens: true,
          intAsBigInt: true,
        })
      : new Document();
    if (
      document.errors.length ||
      document.warnings.length ||
      (document.contents !== null && !isMap(document.contents))
    )
      return source;
    let unsupported = false;
    let nodes = 0;
    visit(document, (_key, node, path) => {
      if (++nodes > 1024 || path.length > 32) unsupported = true;
      if (isAlias(node) || node?.anchor || node?.tag) unsupported = true;
      if (
        isMap(node) &&
        node.items.some(
          (pair) =>
            !isScalar(pair.key) ||
            typeof pair.key.value !== "string" ||
            pair.srcToken?.explicitKey,
        )
      )
        unsupported = true;
    });
    for (const key of ["file", "created", "updated"])
      if (document.has(key) && !isScalar(document.get(key, true)))
        unsupported = true;
    if (unsupported) return source;
    const created =
      property(document, "created") ||
      String(createdAt ?? updated).trim() ||
      updated;
    yaml = stampYaml(
      match?.[1] ?? "",
      document,
      [
        ["file", file],
        ["created", created],
        ["updated", updated],
      ],
      eol,
    );
  } catch {
    // Metadata is optional; a save must never destroy authored content or leak
    // parser diagnostics containing secret values into a host notification.
    return source;
  }
  const header = ["---", yaml, "---"].join(eol);

  if (!match)
    return source ? `${header}${eol}${eol}${source}` : `${header}${eol}`;

  const body = source.slice(match[0].length);
  if (!body) return `${header}${eol}`;
  return `${header}${eol}${body.startsWith(eol) ? "" : eol}${body}`;
}
