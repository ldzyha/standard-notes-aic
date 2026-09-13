import { blockDiagnostic } from "./block-diagnostic.js";
import { parseFieldLabel, serializeFieldLabel } from "./field-label.js";
import { joinFieldParts, splitFieldParts } from "./field-parts.js";
import { SECURITY_FIELD_OPTIONS, SECURITY_FENCE_INFO } from "./field-syntax.js";
import { normalizeCardPart, parseCardField } from "./security-card.js";

export const SECURITY_LIMITS = Object.freeze({
  maxSections: 16,
  maxFields: 64,
  maxBodyLength: 64 * 1024,
  maxValueLength: 16 * 1024,
});
const MAX_BODY_LENGTH = SECURITY_LIMITS.maxBodyLength;
const MAX_SECTIONS = SECURITY_LIMITS.maxSections;
const MAX_FIELDS = SECURITY_LIMITS.maxFields;
const MAX_VALUE_LENGTH = SECURITY_LIMITS.maxValueLength;
const INVALID = Object.freeze({ ok: false, code: "invalid_security_block" });

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

function fieldName(value) {
  return value === "" || name(value);
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
      const allowed = new Set([
        "label",
        "value",
        "hide",
        "kind",
        "description",
        "additionalSecret",
      ]);
      if (
        !field ||
        typeof field !== "object" ||
        Array.isArray(field) ||
        Object.keys(field).some((key) => !allowed.has(key)) ||
        !["label", "value", "hide"].every((key) => has(field, key)) ||
        !fieldName(get(field, "label")) ||
        !string(get(field, "value"), MAX_VALUE_LENGTH) ||
        typeof get(field, "hide") !== "boolean"
      )
        return null;
      const description = get(field, "description");
      const additionalSecret = get(field, "additionalSecret");
      const kind = get(field, "kind");
      if (
        (has(field, "description") && !string(description, MAX_VALUE_LENGTH)) ||
        (has(field, "additionalSecret") &&
          !string(additionalSecret, MAX_VALUE_LENGTH)) ||
        (has(field, "kind") && !["totp", "card"].includes(kind)) ||
        (kind === "card" && get(field, "hide"))
      )
        return null;
      if (kind === "card" && !parseCardField(field).ok) return null;
      try {
        serializeFieldLabel(
          {
            label: get(field, "label"),
            hide: get(field, "hide"),
            ...(kind === undefined ? {} : { kind }),
          },
          SECURITY_FIELD_OPTIONS,
        );
      } catch {
        return null;
      }
      normalizedFields.push({
        label: get(field, "label"),
        value: get(field, "value"),
        hide: get(field, "hide"),
        ...(has(field, "kind") ? { kind } : {}),
        ...(has(field, "description") ? { description } : {}),
        ...(has(field, "additionalSecret") ? { additionalSecret } : {}),
      });
    }
    result.push({ label: get(section, "label"), fields: normalizedFields });
  }
  return {
    ...(titled ? { title: get(model, "title") } : {}),
    sections: result,
  };
}

function decode(encoded, onError = () => {}) {
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

function encode(value) {
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

/** Positions only; splitFieldParts remains the component grammar. */
function partRanges(raw) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "\\") {
      index += 1;
      continue;
    }
    if (raw[index] !== "|") continue;
    let end = index;
    if (end > start && raw[end - 1] === " ") end -= 1;
    ranges.push({ from: start, to: end });
    start = index + 1 + Number(raw[index + 1] === " ");
    index = start - 1;
  }
  ranges.push({ from: start, to: raw.length });
  return ranges;
}

function pipeFailureOffset(raw) {
  let pipes = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "\\") {
      if (index + 1 === raw.length) return { code: "invalid_escape", index };
      index += 1;
    } else if (raw[index] === "|" && ++pipes === 3) {
      return { code: "too_many_parts", index };
    }
  }
  return { code: "value_too_long", index: raw.length };
}

function parseLines(body, report) {
  const lines = lineEntries(body);
  const sections = [];
  const fieldRanges = [];
  let title;
  let current = null;
  let sectionHeadingSeen = false;
  const openSection = (label = "") => {
    current = { label, fields: [] };
    sections.push(current);
    fieldRanges.push([]);
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
          : decode(line.slice(2), (index, code) => {
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
    const colon = line.indexOf(":");
    if (colon < 0) {
      report(
        "missing_field_colon",
        "Write each field as Label: value.",
        from,
        end,
      );
      return null;
    }
    const marked = line.slice(0, colon);
    let field;
    try {
      field = parseFieldLabel(marked, SECURITY_FIELD_OPTIONS);
    } catch {
      report(
        "invalid_field_label",
        "Use a trimmed printable field label before the colon.",
        from,
        from + colon,
      );
      return null;
    }
    const source = line.slice(colon + 1);
    if (!fieldName(field.label)) {
      report(
        "invalid_field_label",
        "Use a trimmed printable field label before the colon.",
        from,
        from + colon,
      );
      return null;
    }
    if (source && !source.startsWith(" ")) {
      report(
        "missing_value_space",
        "Add a space after the field colon.",
        from + colon,
        from + colon + 1,
      );
      return null;
    }
    const raw = source ? source.slice(1) : "";
    const valueFrom = from + colon + 1 + Number(Boolean(source));
    let slots;
    try {
      slots = splitFieldParts(raw);
    } catch {
      const failure = pipeFailureOffset(raw);
      report(
        failure.code,
        failure.code === "too_many_parts"
          ? "Use at most three pipe-separated field parts."
          : failure.code === "invalid_escape"
            ? "Complete the escape sequence."
            : "Shorten this field value.",
        valueFrom + failure.index,
        valueFrom + failure.index + 1,
      );
      return null;
    }
    const ranges = partRanges(raw);
    const values = slots.map((slot, index) =>
      decode(slot, (offset, code) => {
        report(
          code,
          code === "invalid_escape"
            ? "Fix the escape sequence; use a supported backslash escape."
            : code === "control_character"
              ? "Escape control characters in the field value."
              : "Shorten this field value.",
          valueFrom + ranges[index].from + offset,
          valueFrom + ranges[index].from + offset + 1,
        );
      }),
    );
    if (values.some((value) => value === null)) return null;
    const parsed = {
      ...field,
      value: values[0],
      ...(values.length > 1 ? { description: values[1] } : {}),
      ...(values.length > 2 ? { additionalSecret: values[2] } : {}),
    };
    if (field.kind === "card" && !parseCardField(parsed).ok) {
      for (const [index, part] of ["number", "date", "cvv"].entries()) {
        try {
          const normalized = normalizeCardPart(part, values[index] ?? "");
          if (normalized !== (values[index] ?? "")) {
            const range = ranges[index] ?? ranges[0];
            report(
              `invalid_card_${part}`,
              "Remove extra spaces around this card part.",
              valueFrom + range.from,
              valueFrom + range.to,
            );
            return null;
          }
        } catch {
          const range = ranges[index] ?? ranges[0];
          report(
            `invalid_card_${part}`,
            part === "number"
              ? "Use 12–19 card digits, optionally separated by spaces or hyphens."
              : part === "date"
                ? "Use an expiry date in MM/YY or MM/YYYY format."
                : "Use a 3- or 4-digit CVV.",
            valueFrom + range.from,
            valueFrom + range.to,
          );
          return null;
        }
      }
      report(
        "card_too_long",
        "Keep the combined card parts within 128 characters.",
        valueFrom,
        end,
      );
      return null;
    }
    current.fields.push(parsed);
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
        ? { ok: true, model: parsed.model, fieldRanges: parsed.fieldRanges }
        : { ok: true, model: parsed.model }
      : invalid();
  } catch {
    return invalid();
  }
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
    lines.push(normalized.title ? `# ${encode(normalized.title)}` : "#");
  for (const [index, section] of normalized.sections.entries()) {
    if (index) lines.push("---");
    if (section.label) lines.push(`## ${section.label}`);
    for (const field of section.fields) {
      const slots = [field.value];
      if (
        Object.hasOwn(field, "description") ||
        Object.hasOwn(field, "additionalSecret")
      )
        slots.push(field.description ?? "");
      if (Object.hasOwn(field, "additionalSecret"))
        slots.push(field.additionalSecret);
      let value;
      try {
        value = joinFieldParts(
          slots.map((slot) => encode(slot).replaceAll("|", "\\|")),
        );
      } catch {
        throw new TypeError("invalid security block");
      }
      lines.push(
        `${serializeFieldLabel(field, SECURITY_FIELD_OPTIONS)}:${value ? ` ${value}` : ""}`,
      );
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
            { label: "Service", value: "", hide: false },
            { label: "Account", value: "", hide: false },
            { label: "Email", value: "", hide: false },
            { label: "URL", value: "", hide: false },
            { label: "TOTP", value: "", hide: true, kind: "totp" },
            { label: "Password", value: "", hide: true },
          ],
        },
      ],
    },
    SECURITY_FIELD_OPTIONS,
  );
  return "```" + SECURITY_FENCE_INFO + "\n" + body + "```";
}

/** Masking is explicit in the field marker. */
export function isSecretField(field) {
  return field?.hide === true;
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
