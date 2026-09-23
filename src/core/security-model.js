import { blockDiagnostic } from "./block-diagnostic.js";
import { scanFieldLabel, serializeFieldLabel } from "./field-label.js";
import {
  FIELD_PARTS_MAX_COUNT,
  scanFieldParts,
  serializeFieldParts,
} from "./field-parts.js";
import { SECURITY_FIELD_OPTIONS, SECURITY_FENCE_INFO } from "./field-syntax.js";
import { parseCardField } from "./security-card.js";

export const SECURITY_LIMITS = Object.freeze({
  maxSections: 16,
  maxFields: 64,
  maxParts: FIELD_PARTS_MAX_COUNT,
  maxBodyLength: 64 * 1024,
  maxValueLength: 16 * 1024,
});
const MAX_BODY_LENGTH = SECURITY_LIMITS.maxBodyLength;
const MAX_SECTIONS = SECURITY_LIMITS.maxSections;
const MAX_FIELDS = SECURITY_LIMITS.maxFields;
const MAX_VALUE_LENGTH = SECURITY_LIMITS.maxValueLength;
const INVALID = Object.freeze({ ok: false, code: "invalid_security_block" });
export const AIC_EMPTY_DOCUMENT = "```aic\n# Properties\n\n```\n\n";

/** One complete top-level AIC block for shared records; field syntax has one owner. */
export function parseSecurityDocument(markdown) {
  if (typeof markdown !== "string" || markdown.length > MAX_BODY_LENGTH + 1024)
    return INVALID;
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim());
  const opening = /^ {0,3}(`{3,}|~{3,})aic[ \t]*$/u.exec(lines[start] || "");
  if (!opening) return INVALID;
  const closing = lines.findIndex(
    (line, index) =>
      index > start &&
      /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/u.test(line) &&
      closeFence(line, opening[1]),
  );
  if (closing < 0 || lines.slice(closing + 1).some((line) => line.trim()))
    return INVALID;
  return parseSecurityBlock(
    lines.slice(start + 1, closing).join("\n"),
    SECURITY_FIELD_OPTIONS,
  );
}

function exactly(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = value instanceof Map ? [...value.keys()] : Object.keys(value);
  return (
    keys.length === names.length &&
    names.every((name) =>
      value instanceof Map ? value.has(name) : Object.hasOwn(value, name),
    )
  );
}

function get(value, name) {
  return value instanceof Map ? value.get(name) : value[name];
}

function string(value, limit) {
  return typeof value === "string" && value.length <= limit;
}

function name(value) {
  return (
    string(value, 256) &&
    value.length > 0 &&
    value.trim() === value &&
    !/[:*\\\p{C}\u2028\u2029]/u.test(value)
  );
}

function titleText(value) {
  return (
    string(value, 256) &&
    value.trim() === value &&
    !/[\p{C}\u2028\u2029]/u.test(value)
  );
}

function has(value, key) {
  return value instanceof Map ? value.has(key) : Object.hasOwn(value, key);
}

function normalize(model) {
  if (!exactly(model, ["sections"]) && !exactly(model, ["title", "sections"]))
    return null;
  const titled = has(model, "title");
  if (titled && !titleText(get(model, "title"))) return null;
  const sections = get(model, "sections");
  if (
    !Array.isArray(sections) ||
    sections.length < 1 ||
    sections.length > MAX_SECTIONS
  )
    return null;
  const result = [];
  for (const section of sections) {
    if (
      !exactly(section, ["label", "fields"]) ||
      !(get(section, "label") === "" || name(get(section, "label")))
    )
      return null;
    const fields = get(section, "fields");
    if (!Array.isArray(fields) || fields.length > MAX_FIELDS) return null;
    const normalizedFields = [];
    for (const field of fields) {
      if (!exactly(field, ["label", "parts"])) return null;
      const label = get(field, "label");
      const parts = get(field, "parts");
      try {
        serializeFieldLabel({ label }, SECURITY_FIELD_OPTIONS);
        if (
          !Array.isArray(parts) ||
          !parts.length ||
          parts.length > FIELD_PARTS_MAX_COUNT
        )
          return null;
        for (const part of parts) {
          if (
            !exactly(part, ["kind", "value"]) ||
            !["text", "secret", "totp", "card", "one-time", "used"].includes(
              get(part, "kind"),
            ) ||
            !string(get(part, "value"), MAX_VALUE_LENGTH)
          )
            return null;
          if (
            get(part, "kind") === "card" &&
            !parseCardField({ kind: "card", value: get(part, "value") }).ok
          )
            return null;
        }
        const normalizedParts = parts.map((part) => ({
          kind: get(part, "kind"),
          value: get(part, "value"),
        }));
        serializeFieldParts(normalizedParts);
        normalizedFields.push({ label, parts: normalizedParts });
      } catch {
        return null;
      }
    }
    result.push({ label: get(section, "label"), fields: normalizedFields });
  }
  return {
    ...(titled ? { title: get(model, "title") } : {}),
    sections: result,
  };
}

function decodeTitle(encoded, onError = () => {}) {
  let value = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character !== "\\") {
      const codePoint = encoded.codePointAt(index);
      const scalar = String.fromCodePoint(codePoint);
      if (/[\p{C}\u2028\u2029]/u.test(scalar)) {
        onError(index, "control_character");
        return null;
      }
      value += scalar;
      if (codePoint > 0xffff) index += 1;
      if (value.length > MAX_VALUE_LENGTH) {
        onError(index, "value_too_long");
        return null;
      }
      continue;
    }
    const escape = encoded[++index];
    if (escape === "\\") value += "\\";
    else if (escape === "|") value += "|";
    else if (escape === "n") value += "\n";
    else if (escape === "r") value += "\r";
    else if (escape === "t") value += "\t";
    else if (escape === "u") {
      const code = encoded.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/u.test(code)) {
        onError(index - 1, "invalid_escape");
        return null;
      }
      value += String.fromCharCode(Number.parseInt(code, 16));
      index += 4;
    } else {
      onError(index - 1, "invalid_escape");
      return null;
    }
    if (value.length > MAX_VALUE_LENGTH) {
      onError(index, "value_too_long");
      return null;
    }
  }
  return value.length <= MAX_VALUE_LENGTH ? value : null;
}

function encodeTitle(value) {
  return value.replace(/[\\\p{C}\u2028\u2029]/gu, (character) => {
    if (character === "\\") return "\\\\";
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

function lineEntries(body) {
  return [...body.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)]
    .filter((match) => match[0].length)
    .map((match) => ({
      text: match[0].replace(/(?:\r\n|\n|\r)$/u, ""),
      from: match.index,
    }));
}

function parseLines(body, report) {
  const lines = lineEntries(body);
  const sections = [];
  const fieldRanges = [];
  const partRanges = [];
  let title;
  let current = null;
  let sectionHeadingSeen = false;
  const openSection = (label = "") => {
    current = { label, fields: [] };
    sections.push(current);
    fieldRanges.push([]);
    partRanges.push([]);
    sectionHeadingSeen = false;
  };
  for (const { text: line, from } of lines) {
    if (line.trim() === "") continue;
    const end = from + line.length;
    if (!current && (line === "#" || line.startsWith("# "))) {
      // A title is a separate, optional leading heading, never a section.
      if (title !== undefined) {
        report(
          "duplicate_title",
          "Keep one # card title at the start; use --- for another section or a separate fenced block.",
          from,
          end,
        );
        return null;
      }
      if (line !== "#" && line.length === 2) {
        report(
          "invalid_title",
          "Use # for an empty title, or # followed by a title.",
          from,
          end,
        );
        return null;
      }
      title =
        line === "#"
          ? ""
          : decodeTitle(line.slice(2), (index, code) => {
              report(
                code,
                code === "invalid_escape"
                  ? "Fix the title escape sequence."
                  : "Use a printable title of at most 256 characters.",
                from + 2 + index,
                from + 3 + index,
              );
            });
      if (!titleText(title)) {
        report(
          "invalid_title",
          "Use a trimmed printable title of at most 256 characters.",
          from,
          end,
        );
        return null;
      }
      continue;
    }
    if (line === "---") {
      if (!current) openSection();
      if (sections.length >= MAX_SECTIONS) {
        report(
          "too_many_sections",
          "This block exceeds 16 sections. Move some sections into a separate Security block.",
          from,
          end,
        );
        return null;
      }
      openSection();
      continue;
    }
    if (line === "##" || line.startsWith("## ")) {
      const label = line === "##" ? "" : line.slice(3);
      if (line !== "##" && !name(label)) {
        report(
          "invalid_section_label",
          "Use a trimmed ## section title, or omit the title for an untitled section.",
          from,
          end,
        );
        return null;
      }
      if (!current) openSection();
      if (sectionHeadingSeen || current.fields.length) {
        report(
          "misplaced_section_title",
          "Use a standalone --- line before another section title.",
          from,
          end,
        );
        return null;
      }
      current.label = label;
      sectionHeadingSeen = true;
      continue;
    }
    if (
      !line.includes(":") &&
      /^[ \t]*(?:`{3,}|~{3,})(?:aic(?:[ \t].*)?)?$/u.test(line)
    ) {
      report(
        "nested_fence",
        "Remove pasted fence lines and use standalone --- separators, or keep separate fenced blocks.",
        from,
        end,
      );
      return null;
    }
    if ((line === "#" || line.startsWith("# ")) && !line.includes(":")) {
      report(
        "misplaced_title",
        "Move the # card title to the start, use --- for another section, or keep separate fenced blocks.",
        from,
        end,
      );
      return null;
    }
    if (!current) openSection();
    if (current.fields.length >= MAX_FIELDS) {
      report(
        "too_many_fields",
        "This section exceeds 64 fields. Add a standalone --- separator or move fields into another block.",
        from,
        end,
      );
      return null;
    }
    let scannedLabel;
    try {
      scannedLabel = scanFieldLabel(line, SECURITY_FIELD_OPTIONS);
    } catch {
      report(
        "invalid_field_label",
        "Use an optional printable label before the first typed pipe separator; quote labels containing colons or pipes.",
        from,
        end,
      );
      return null;
    }
    if (!scannedLabel) {
      report(
        "missing_field_separator",
        "Write each value after |, *|, #|, _|, 1| or 0|. Colon fields are unsupported.",
        from,
        end,
      );
      return null;
    }
    const { label, separatorFrom } = scannedLabel;
    const raw = line.slice(separatorFrom);
    const valueFrom = from + separatorFrom;
    let ranges;
    try {
      ranges = scanFieldParts(raw);
    } catch (failure) {
      const advice = {
        too_many_parts:
          "Use at most 64 independently typed parts in one field.",
        invalid_escape: "Inside double quotes, use JSON string escapes.",
        unterminated_quote: "Close this double-quoted value.",
        unexpected_after_quote:
          "After a quoted value, use a typed pipe separator or end the field.",
        unexpected_quote: "Enclose the whole value in JSON double quotes.",
        control_character:
          "Encode control characters inside a quoted JSON value.",
        missing_field_separator:
          "Write each value after |, *|, #|, _|, 1| or 0|.",
      };
      report(
        failure.code,
        advice[failure.code] ??
          "Shorten this field to at most 16,384 characters.",
        valueFrom + failure.offset,
        valueFrom + failure.offset + 1,
      );
      return null;
    }
    const parts = ranges.map(({ kind, encoded, quoted }) => ({
      kind,
      value: quoted ? JSON.parse(encoded) : encoded,
    }));
    for (const [index, part] of parts.entries()) {
      if (part.kind === "card" && !parseCardField(part).ok) {
        report(
          "invalid_card_number",
          "Use 12–19 card digits, optionally separated by spaces or hyphens.",
          valueFrom + ranges[index].from,
          valueFrom + ranges[index].to,
        );
        return null;
      }
    }
    current.fields.push({ label, parts });
    partRanges.at(-1).push(
      ranges.map(
        ({ from: start, to, separatorFrom: separatorStart, separatorTo }) => ({
          from: valueFrom + start,
          to: valueFrom + to,
          separatorFrom: valueFrom + separatorStart,
          separatorTo: valueFrom + separatorTo,
        }),
      ),
    );
    fieldRanges.at(-1).push({ from, to: end });
  }
  if (!sections.length) openSection();
  if (!sections.length) {
    report("missing_section", "Add a ## section heading before fields.", 0, 0);
    return null;
  }
  return {
    model: { ...(title !== undefined ? { title } : {}), sections },
    fieldRanges,
    partRanges,
  };
}

/** Failure codes are fixed strings so validation never echoes secret values. */
export function parseSecurityBlock(body, options = {}) {
  const diagnostics = options?.diagnostics === true;
  let diagnostic;
  const report = (code, message, from = 0, to = from) => {
    if (diagnostics && !diagnostic)
      diagnostic = blockDiagnostic(body, code, message, from, to);
  };
  const invalid = () =>
    diagnostics
      ? {
          ...INVALID,
          diagnostic:
            diagnostic ??
            blockDiagnostic(
              body,
              "invalid_security_block",
              "Check the Security block format.",
            ),
        }
      : INVALID;
  if (typeof body !== "string") {
    report("invalid_body", "Use text for the Security block body.");
    return invalid();
  }
  if (body.length > MAX_BODY_LENGTH) {
    report(
      "body_too_long",
      "This Security block exceeds the 65,536-character limit. Split it into separate blocks.",
      MAX_BODY_LENGTH,
      MAX_BODY_LENGTH + 1,
    );
    return invalid();
  }
  if (options?.fieldSyntax !== undefined && options.fieldSyntax !== "pipes") {
    report(
      "unsupported_field_syntax",
      "Use the supported Security field syntax.",
    );
    return invalid();
  }
  if (
    options?.sectionSyntax !== undefined &&
    options.sectionSyntax !== "separators"
  ) {
    report(
      "unsupported_section_syntax",
      "Use the supported Security section syntax.",
    );
    return invalid();
  }
  try {
    const parsed = parseLines(body, report);
    return parsed && normalize(parsed.model)
      ? diagnostics
        ? {
            ok: true,
            model: parsed.model,
            fieldRanges: parsed.fieldRanges,
            partRanges: parsed.partRanges,
          }
        : { ok: true, model: parsed.model }
      : invalid();
  } catch {
    return invalid();
  }
}

const labelOrder = new Intl.Collator("uk", {
  numeric: true,
  sensitivity: "base",
});

/** Sort record lines, retaining section boundaries and every authored field byte. */
export function sortSecurityRecords(body, options = {}) {
  const parsed = parseSecurityBlock(body, { ...options, diagnostics: true });
  if (!parsed.ok) return body;
  const replacements = [];
  parsed.model.sections.forEach((section, sectionIndex) => {
    const ranges = parsed.fieldRanges[sectionIndex];
    const records = section.fields.map((field, index) => ({
      label: field.label,
      source: body.slice(ranges[index].from, ranges[index].to),
    }));
    const sorted = [...records].sort((left, right) => {
      if (!left.label || !right.label)
        return Number(!left.label) - Number(!right.label);
      return labelOrder.compare(left.label, right.label);
    });
    sorted.forEach((record, index) => {
      if (record.source !== records[index].source)
        replacements.push({ ...ranges[index], insert: record.source });
    });
  });
  // Work backwards so the original body-relative ranges remain valid.
  for (const { from, to, insert } of replacements.reverse())
    body = body.slice(0, from) + insert + body.slice(to);
  return body;
}

/** Stable line body. The caller owns the surrounding Markdown fence. */
export function serializeSecurityBlock(model, options = {}) {
  if (
    (options?.fieldSyntax !== undefined && options.fieldSyntax !== "pipes") ||
    (options?.sectionSyntax !== undefined &&
      options.sectionSyntax !== "separators")
  )
    throw new TypeError("invalid security block");
  const normalized = normalize(model);
  if (!normalized) throw new TypeError("invalid security block");
  const lines = [];
  if (has(normalized, "title"))
    lines.push(normalized.title ? `# ${encodeTitle(normalized.title)}` : "#");
  for (const [index, section] of normalized.sections.entries()) {
    if (index) lines.push("---");
    if (section.label) lines.push(`## ${section.label}`);
    for (const field of section.fields) {
      try {
        const label = serializeFieldLabel(field, SECURITY_FIELD_OPTIONS);
        lines.push(
          (label ? label + " " : "") + serializeFieldParts(field.parts),
        );
      } catch {
        throw new TypeError("invalid security block");
      }
    }
  }
  const body = `${lines.join("\n")}\n`;
  if (body.length > MAX_BODY_LENGTH)
    throw new TypeError("invalid security block");
  return body;
}

export function securityTemplate() {
  const body = serializeSecurityBlock(
    {
      sections: [
        {
          label: "",
          fields: [
            { label: "Service", parts: [{ value: "", kind: "text" }] },
            { label: "", parts: [{ value: "", kind: "text" }] },
            { label: "Email", parts: [{ value: "", kind: "text" }] },
            { label: "URL", parts: [{ value: "", kind: "text" }] },
            { label: "TOTP", parts: [{ value: "", kind: "totp" }] },
            { label: "Password", parts: [{ value: "", kind: "secret" }] },
          ],
        },
      ],
    },
    SECURITY_FIELD_OPTIONS,
  );
  return "```" + SECURITY_FENCE_INFO + "\n" + body + "```";
}

/** Every explicitly non-text part is confidential. */
export function isSecretPart(part) {
  return ["secret", "totp", "card", "one-time", "used"].includes(part?.kind);
}

/** Only absolute HTTP(S) destinations can be opened from a security block. */
export function safeSecurityUrl(value) {
  if (typeof value !== "string") return "";
  const source = value.trim();
  if (!/^https?:\/\//iu.test(source) || /\p{Cc}/u.test(source)) return "";
  try {
    const url = new URL(source);
    return ["http:", "https:"].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function sourceLines(source) {
  return source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)?.filter(Boolean) ?? [];
}

function closeFence(line, fence) {
  const match = /^[ \t]*(`{3,}|~{3,})[ \t]*$/u.exec(line);
  return !!match && match[1][0] === fence[0] && match[1].length >= fence.length;
}

function fenceLine(line) {
  let content = line;
  let quotes = 0;
  let listIndent = 0;
  // Markdown permits fences inside nested quotes and list items. Strip only
  // container markers when recognizing fences; retain the original output.
  for (;;) {
    const quote = /^[ \t]*>[ \t]?/u.exec(content);
    if (quote) {
      quotes += 1;
      content = content.slice(quote[0].length);
      continue;
    }
    const list = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+/u.exec(content);
    if (!list) break;
    listIndent += list[0].length;
    content = content.slice(list[0].length);
  }
  return {
    content,
    quotes,
    listIndent,
    indent: /^[ \t]*/u.exec(content)[0].length + listIndent,
  };
}

/** Remove security fence contents before deriving any plain-text preview. */
export function redactSecurityBlocks(markdown) {
  const source = String(markdown ?? "");
  let activeFence = null;
  let securityFence = false;
  let fenceQuotes = 0;
  let fenceListIndent = 0;
  let result = "";
  for (const rawLine of sourceLines(source)) {
    const parsed = fenceLine(rawLine.replace(/(?:\r\n|\n|\r)$/u, ""));
    const line = parsed.content;
    // Leaving a quote/list also ends its ordinary fenced example. Security
    // fences remain redacted until a matching close (including malformed input).
    if (
      activeFence &&
      !securityFence &&
      (parsed.quotes < fenceQuotes ||
        (line.trim() && parsed.indent < fenceListIndent))
    )
      activeFence = null;
    if (activeFence) {
      if (
        parsed.quotes === fenceQuotes &&
        parsed.listIndent === 0 &&
        /^[ ]*/u.exec(line)[0].length <= fenceListIndent + 3 &&
        !/^[ ]*\t/u.test(line) &&
        closeFence(line, activeFence)
      ) {
        activeFence = null;
        if (securityFence) {
          securityFence = false;
          continue;
        }
      }
      if (!securityFence) result += rawLine;
      continue;
    }
    // Quarantine historical fences in summaries even though they are no longer parsed.
    const security =
      /^[ \t]*(`{3,}|~{3,})[ \t]*(?:aic(?:[ \t].*)?|aic-security(?:[ \t].*)?)$/u.exec(
        line,
      );
    if (security) {
      activeFence = security[1];
      securityFence = true;
      fenceQuotes = parsed.quotes;
      fenceListIndent = parsed.listIndent;
      continue;
    }
    const ordinary = /^[ \t]*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (
      ordinary &&
      /^[ ]*/u.exec(line)[0].length <= 3 &&
      !/^[ ]*\t/u.test(line) &&
      !(ordinary[1][0] === "`" && ordinary[2].includes("`"))
    ) {
      activeFence = ordinary[1];
      fenceQuotes = parsed.quotes;
      fenceListIndent = parsed.listIndent;
    }
    result += rawLine;
  }
  return result;
}
