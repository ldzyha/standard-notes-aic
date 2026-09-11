import { parser as markdownParser } from "@lezer/markdown";
import { isAlias, isMap, parseDocument, visit } from "yaml";

export const AGENTIC_NOTES_START = "<!-- aic:agentic-notes:start -->";
export const AGENTIC_NOTES_END = "<!-- aic:agentic-notes:end -->";
export const AGENTIC_NOTES_HEADING = "## Agentic Notes";

const fail = (code, path) => ({ ok: false, code, ...(path ? { path } : {}) });
const lineEndingOf = (source) => /\r\n|\n|\r/.exec(source)?.[0] ?? "\n";

function sourceLines(source) {
  const lines = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match;
  while ((match = pattern.exec(source)) && match[0]) {
    lines.push({
      text: match[1],
      from: match.index,
      to: match.index + match[1].length,
      end: match.index + match[0].length,
    });
  }
  return lines;
}

// The presentation frontmatter parser deliberately supports only a subset of
// YAML. Exposure decisions instead require complete, validated YAML semantics.
function frontmatter(source) {
  const lines = sourceLines(source);
  if (lines[0]?.text.replace(/^\uFEFF/, "").trimEnd() !== "---")
    return { ok: true, bodyFrom: 0, visible: true };
  const end = lines.findIndex(
    (line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line.text),
  );
  if (end < 0) return fail("invalid_frontmatter");
  try {
    const document = parseDocument(
      source.slice(lines[0].end, lines[end].from),
      { strict: true, uniqueKeys: true, merge: true },
    );
    if (document.errors.length || document.warnings.length)
      return fail("invalid_frontmatter");
    if (document.contents !== null && !isMap(document.contents))
      return fail("invalid_frontmatter");
    let hasAlias = false;
    visit(document, (_key, node) => {
      if (isAlias(node)) hasAlias = true;
    });
    if (hasAlias) return fail("invalid_frontmatter");
    const metadata = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
    const agent = metadata?.get("agent");
    const privateFlag = metadata?.get("private");
    const visibility = metadata?.get("visibility");
    if (
      (agent !== undefined && typeof agent !== "boolean") ||
      (privateFlag !== undefined && typeof privateFlag !== "boolean") ||
      (visibility !== undefined && typeof visibility !== "string")
    )
      return fail("invalid_visibility");
    return {
      ok: true,
      bodyFrom: lines[end].end,
      visible:
        agent !== false &&
        privateFlag !== true &&
        visibility?.trim().toLowerCase() !== "private",
    };
  } catch {
    return fail("invalid_frontmatter");
  }
}

export function agenticNoteVisibility(source) {
  if (typeof source !== "string") return fail("invalid_source");
  const result = frontmatter(source);
  return result.ok ? { ok: true, visible: result.visible } : result;
}

function sectionIn(source, bodyFrom) {
  const document = source.slice(bodyFrom);
  const root = markdownParser.parse(document).topNode;
  const markers = [];
  const headings = [];
  for (let node = root.firstChild; node; node = node.nextSibling) {
    const raw = document.slice(node.from, node.to);
    if (node.name === "CommentBlock" && raw.includes("aic:agentic-notes")) {
      if (![AGENTIC_NOTES_START, AGENTIC_NOTES_END].includes(raw.trim()))
        return fail("malformed_section");
      markers.push({
        kind: raw.trim() === AGENTIC_NOTES_START ? "start" : "end",
        from: bodyFrom + node.from,
        to: bodyFrom + node.to,
      });
    }
    if (
      (/^ATXHeading\d$/.test(node.name) &&
        /^#+\s+Agentic Notes\s*#*\s*$/i.test(raw)) ||
      (/^SetextHeading[12]$/.test(node.name) &&
        /^Agentic Notes\s*$/i.test(raw.split(/\r\n|\n|\r/)[0].trim()))
    )
      headings.push({ from: bodyFrom + node.from, to: bodyFrom + node.to });
  }
  if (!markers.length)
    return headings.length
      ? fail("unmanaged_section")
      : { ok: true, section: null };
  if (
    markers.length !== 2 ||
    markers[0].kind !== "start" ||
    markers[1].kind !== "end" ||
    headings.length !== 1
  )
    return fail("malformed_section");
  const [start, end] = markers;
  const lines = sourceLines(source.slice(start.from, end.from));
  if (
    lines[0]?.text.trim() !== AGENTIC_NOTES_START ||
    lines[1]?.text !== AGENTIC_NOTES_HEADING ||
    lines[2]?.text !== "" ||
    headings[0].from !== start.from + lines[1].from ||
    lines[2].end === lines[2].from
  )
    return fail("malformed_section");
  const contentFrom = start.from + lines[2].end;
  const rawBody = source.slice(contentFrom, end.from);
  const finalBreak = /(\r\n|\n|\r)$/.exec(rawBody);
  if (!finalBreak) return fail("malformed_section");
  const contentTo = end.from - finalBreak[0].length;
  return {
    ok: true,
    section: {
      from: start.from,
      to: end.to,
      bodyFrom: contentFrom,
      bodyTo: contentTo,
      body: source.slice(contentFrom, contentTo),
    },
  };
}

export function inspectAgenticNotes(source) {
  if (typeof source !== "string") return fail("invalid_source");
  const metadata = frontmatter(source);
  if (!metadata.ok) return metadata;
  if (!metadata.visible) return fail("private_note");
  return sectionIn(source, metadata.bodyFrom);
}

// This is a pure optimistic comparison, NOT a filesystem transaction or lock.
// A host must also guard live drafts, document identity and its write authority.
export function patchAgenticNotes({ source, expectedSource, body } = {}) {
  if (typeof source !== "string" || typeof body !== "string")
    return fail("invalid_source");
  if (typeof expectedSource !== "string" || source !== expectedSource)
    return fail("source_changed");
  const existing = inspectAgenticNotes(source);
  if (!existing.ok) return existing;
  const lineEnding = lineEndingOf(source);
  const normalizedBody = body.replace(/\r\n|\n|\r/g, lineEnding);
  let nextSource;
  if (existing.section) {
    nextSource =
      source.slice(0, existing.section.bodyFrom) +
      normalizedBody +
      source.slice(existing.section.bodyTo);
  } else {
    const separator =
      !source || source.replace(/\r\n|\r/g, "\n").endsWith("\n\n")
        ? ""
        : /(?:\r\n|\n|\r)$/.test(source)
          ? lineEnding
          : lineEnding + lineEnding;
    nextSource =
      source +
      separator +
      [
        AGENTIC_NOTES_START,
        AGENTIC_NOTES_HEADING,
        "",
        normalizedBody,
        AGENTIC_NOTES_END,
        "",
      ].join(lineEnding);
  }
  const validated = inspectAgenticNotes(nextSource);
  if (
    !validated.ok ||
    !validated.section ||
    validated.section.body !== normalizedBody
  )
    return fail("invalid_section_body");
  return { ok: true, source: nextSource, changed: nextSource !== source };
}

function validPath(path, allowRoot = false) {
  return (
    typeof path === "string" &&
    ((allowRoot && path === "") ||
      (path.length > 0 &&
        !/[\\:<>"|?*]/.test(path) &&
        [...path].every(
          (character) =>
            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ) &&
        path
          .split("/")
          .every(
            (part) =>
              part &&
              part !== "." &&
              part !== ".." &&
              !/[. ]$/.test(part) &&
              !/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
                part,
              ),
          )))
  );
}

function validTarget(target) {
  return (
    target &&
    ["file", "folder"].includes(target.kind) &&
    validPath(target.path, target.kind === "folder")
  );
}

// Same forward conventions as the local notes adapter. No reverse resolution:
// a stripped extension does not prove which file owns an existing note.
export function agenticNotePathFor(target) {
  if (!validTarget(target)) return null;
  if (!target.path || target.path.endsWith(".note.md")) return null;
  return (
    (target.kind === "folder"
      ? target.path
      : target.path.replace(/(?<=[^/.])\.[^./]+$/, "")) + ".note.md"
  );
}

function parentPaths(path) {
  const parts = path.split("/");
  const paths = [""];
  for (let index = 1; index < parts.length; index++)
    paths.push(parts.slice(0, index).join("/"));
  return paths;
}

export function resolveAgenticContext({
  target,
  projectNotePath,
  notes,
  targets,
  currentNotePath,
  caseSensitive = false,
} = {}) {
  if (!validTarget(target)) return fail("invalid_target");
  if (
    !validPath(projectNotePath) ||
    projectNotePath.includes("/") ||
    !projectNotePath.endsWith(".note.md")
  )
    return fail("invalid_project_note");
  if (!Array.isArray(notes) || !Array.isArray(targets))
    return fail("catalog_required");
  if (typeof caseSensitive !== "boolean") return fail("invalid_case_policy");
  const key = (path) => (caseSensitive ? path : path.toLowerCase());
  const noteCatalog = new Map();
  for (const note of notes) {
    if (
      !validPath(note?.path) ||
      !note.path.endsWith(".note.md") ||
      typeof note.source !== "string"
    )
      return fail("invalid_note");
    if (noteCatalog.has(key(note.path)))
      return fail("ambiguous_note", note.path);
    noteCatalog.set(key(note.path), note);
  }
  const targetCatalog = new Map();
  for (const entry of targets) {
    if (!validTarget(entry)) return fail("invalid_catalog_target");
    if (targetCatalog.has(key(entry.path)))
      return fail("ambiguous_target", entry.path);
    targetCatalog.set(key(entry.path), entry);
  }
  const suppliedTarget = targetCatalog.get(key(target.path));
  if (!suppliedTarget || suppliedTarget.kind !== target.kind)
    return fail("target_not_in_catalog", target.path);
  // Paths of existing children prove their ancestor directories exist, too.
  for (const entry of [...targetCatalog.values()]) {
    for (const path of parentPaths(entry.path)) {
      const previous = targetCatalog.get(key(path));
      if (previous && previous.kind !== "folder")
        return fail("ambiguous_target", path);
      if (!previous) targetCatalog.set(key(path), { path, kind: "folder" });
    }
  }
  const associations = new Map();
  for (const entry of targetCatalog.values()) {
    const notePath = agenticNotePathFor(entry);
    if (!notePath) continue;
    const owners = associations.get(key(notePath)) ?? [];
    owners.push(entry);
    associations.set(key(notePath), owners);
  }
  if (
    currentNotePath !== undefined &&
    (!validPath(currentNotePath) || !currentNotePath.endsWith(".note.md"))
  )
    return fail("invalid_current_binding");
  const canonicalCurrent =
    target.path === "" ? projectNotePath : agenticNotePathFor(target);
  if (
    currentNotePath !== undefined &&
    key(currentNotePath) !== key(canonicalCurrent ?? target.path)
  )
    return fail("invalid_current_binding");
  if (!canonicalCurrent && currentNotePath === undefined)
    return fail("current_binding_required");
  const scopes = parentPaths(target.path).map((path) => ({
    path,
    kind: "folder",
  }));
  if (target.path === "") scopes.length = 0;
  scopes.push(target);
  const selected = [];
  const excluded = [];
  const selectedKeys = new Set();
  for (let index = 0; index < scopes.length; index++) {
    const scope = scopes[index];
    const current = index === scopes.length - 1;
    const notePath =
      scope.path === ""
        ? projectNotePath
        : current && currentNotePath !== undefined
          ? currentNotePath
          : agenticNotePathFor(scope);
    if (!notePath) continue;
    const note = noteCatalog.get(key(notePath));
    if (!note) continue; // Existing notes only; never synthesize placeholders.
    if (
      scope.path !== "" &&
      !(current && currentNotePath !== undefined) &&
      (associations.get(key(notePath))?.length ?? 0) > 1
    )
      return fail("ambiguous_binding", note.path);
    if (selectedKeys.has(key(note.path)))
      return fail("ambiguous_binding", note.path);
    selectedKeys.add(key(note.path));
    const inspected = inspectAgenticNotes(note.source);
    if (!inspected.ok) {
      excluded.push({ path: note.path, code: inspected.code });
      continue;
    }
    selected.push({
      path: note.path,
      scope: { ...scope },
      role: current ? "current" : scope.path === "" ? "project" : "ancestor",
      source: note.source,
      agenticBody: inspected.section?.body ?? null,
    });
  }
  return { ok: true, notes: selected, excluded };
}
