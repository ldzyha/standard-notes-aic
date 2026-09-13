import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
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
const LEGACY_SECRET_LABEL =
  /(?:^|[^\p{L}\p{N}])(?:pass(?:word|phrase|code)?|pwd|security[\s_-]*key|api[\s_-]*key|client[\s_-]*secret|secret|token|credential|private[\s_-]*key|recovery[\s_-]*(?:code|key)|(?:2fa|mfa|totp|otp)(?:[\s_-]*code)?)(?=$|[^\p{L}\p{N}])/iu;
const LEGACY_TYPES = new Set(["text", "url", "password", "secret", "totp"]);

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

function normalize(model, options) {
  const pipes = options?.fieldSyntax === "pipes";
  const separators = options?.sectionSyntax === "separators";
  if (options?.fieldSyntax !== undefined && !pipes) return null;
  if (options?.sectionSyntax !== undefined && (!separators || !pipes))
    return null;
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
      const allowed = new Set(
        pipes
          ? [
              "label",
              "value",
              "hide",
              "kind",
              "description",
              "additionalSecret",
            ]
          : ["label", "value", "hide"],
      );
      if (
        !field ||
        typeof field !== "object" ||
        Array.isArray(field) ||
        Object.keys(field).some((key) => !allowed.has(key)) ||
        !["label", "value", "hide"].every((key) => has(field, key)) ||
        !name(get(field, "label")) ||
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
          options,
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

function decode(encoded, pipes = false, onError = () => {}) {
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
    else if (pipes && escape === "|") value += "|";
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

function parseLines(body, options, report) {
  const pipes = options?.fieldSyntax === "pipes";
  const separators = options?.sectionSyntax === "separators";
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
          separators
            ? "Keep one # card title at the start; use --- for another section or a separate fenced block."
            : "Keep one # card title before the first ## section; use another ## section or a separate fenced block.",
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
          : decode(line.slice(2), false, (index, code) => {
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
    if (separators && line === "---") {
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
          separators
            ? "Use a trimmed ## section title, or omit the title for an untitled section."
            : "Use ## for an empty section, or ## followed by a trimmed section name.",
          from,
          end,
        );
        return null;
      }
      if (separators) {
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
      if (sections.length >= MAX_SECTIONS) {
        report(
          "too_many_sections",
          "This block exceeds 16 sections. Move some ## sections into a separate Security block.",
          from,
          end,
        );
        return null;
      }
      openSection(label);
      continue;
    }
    if (
      !line.includes(":") &&
      /^[ \t]*(?:`{3,}|~{3,})(?:aic-security(?:[ \t].*)?)?$/u.test(line)
    ) {
      report(
        "nested_fence",
        separators
          ? "Remove pasted fence lines and use standalone --- separators, or keep separate fenced blocks."
          : "Remove pasted fence lines and use ## sections, or keep the cards in separate fenced blocks.",
        from,
        end,
      );
      return null;
    }
    if ((line === "#" || line.startsWith("# ")) && !line.includes(":")) {
      report(
        "misplaced_title",
        separators
          ? "Move the # card title to the start, use --- for another section, or keep separate fenced blocks."
          : "Move the # title above every ## section, use another ## section, or keep separate fenced blocks.",
        from,
        end,
      );
      return null;
    }
    if (!current) {
      if (separators) openSection();
    }
    if (!current) {
      report(
        "missing_section",
        "Add a ## section heading before fields.",
        from,
        end,
      );
      return null;
    }
    if (current.fields.length >= MAX_FIELDS) {
      report(
        "too_many_fields",
        separators
          ? "This section exceeds 64 fields. Add a standalone --- separator or move fields into another block."
          : "This section exceeds 64 fields. Add a ## section or move some fields into another block.",
        from,
        end,
      );
      return null;
    }
    const colon = line.indexOf(":");
    if (colon < 1) {
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
      field = parseFieldLabel(marked, options);
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
    if (!name(field.label)) {
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
      slots = pipes ? splitFieldParts(raw) : [raw];
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
    const ranges = pipes ? partRanges(raw) : [{ from: 0, to: raw.length }];
    const values = slots.map((slot, index) =>
      decode(slot, pipes, (offset, code) => {
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
  if (separators && !sections.length) openSection();
  if (!sections.length) {
    report("missing_section", "Add a ## section heading before fields.", 0, 0);
    return null;
  }
  return {
    model: { ...(title !== undefined ? { title } : {}), sections },
    fieldRanges,
  };
}

function oldField(field) {
  if (!exactly(field, ["label", "type", "value"])) return null;
  const label = get(field, "label");
  const type = get(field, "type");
  const value = get(field, "value");
  if (
    !string(label, 256) ||
    !LEGACY_TYPES.has(type) ||
    !string(value, MAX_VALUE_LENGTH)
  )
    return null;
  const readable = name(label);
  return {
    label: readable ? label : "Field",
    value,
    hide:
      type === "password" ||
      type === "secret" ||
      type === "totp" ||
      LEGACY_SECRET_LABEL.test(label),
  };
}

function oldSection(section) {
  if (
    !exactly(section, [
      "label",
      "service",
      "account",
      "email",
      "url",
      "annotation",
      "fields",
    ])
  )
    return null;
  const label = get(section, "label");
  const oldFields = get(section, "fields");
  if (
    !string(label, 256) ||
    !Array.isArray(oldFields) ||
    oldFields.length > MAX_FIELDS
  )
    return null;
  const result = { label: name(label) ? label : "Main", fields: [] };
  for (const key of ["service", "account", "email", "url", "annotation"]) {
    const value = get(section, key);
    const limit = key === "annotation" ? 4096 : key === "url" ? 2048 : 512;
    if (!string(value, limit)) return null;
    if (value)
      result.fields.push({
        label: key === "url" ? "URL" : key[0].toUpperCase() + key.slice(1),
        value,
        hide: false,
      });
  }
  for (const field of oldFields) {
    const converted = oldField(field);
    if (!converted) return null;
    result.fields.push(converted);
  }
  return result.fields.length <= MAX_FIELDS ? result : null;
}

function migrateYaml(value) {
  const titled = has(value, "title");
  const title = titled ? get(value, "title") : undefined;
  if (titled && !titleText(title)) return null;
  if (titled) {
    value = new Map(value instanceof Map ? value : Object.entries(value));
    value.delete("title");
  }
  const complete = (sections) => ({ ...(titled ? { title } : {}), sections });
  if (exactly(value, ["sections"])) {
    const sections = get(value, "sections");
    if (
      !Array.isArray(sections) ||
      sections.length < 1 ||
      sections.length > MAX_SECTIONS
    )
      return null;
    const migrated = sections.map(oldSection);
    return migrated.every(Boolean) ? complete(migrated) : null;
  }
  const oldest = exactly(value, ["service", "login", "annotation", "fields"]);
  if (
    !oldest &&
    !exactly(value, [
      "service",
      "account",
      "email",
      "url",
      "annotation",
      "fields",
    ])
  )
    return null;
  const section = oldSection({
    label: "Main",
    service: get(value, "service"),
    account: get(value, oldest ? "login" : "account"),
    email: oldest ? "" : get(value, "email"),
    url: oldest ? "" : get(value, "url"),
    annotation: get(value, "annotation"),
    fields: get(value, "fields"),
  });
  return section ? complete([section]) : null;
}

function nodeRange(node) {
  return isScalar(node) && Array.isArray(node.range)
    ? { from: node.range[0], to: node.range[1] }
    : null;
}

function mapValueNode(map, key) {
  return isMap(map)
    ? map.items.find((pair) => pair.key?.value === key)?.value
    : undefined;
}

function legacyFieldRanges(document, model) {
  const root = document.contents;
  const sectionNodes = mapValueNode(root, "sections");
  const sections = isSeq(sectionNodes) ? sectionNodes.items : [root];
  return model.sections.map((section, sectionIndex) => {
    const source = sections[sectionIndex];
    if (!isMap(source)) return section.fields.map(() => null);
    const ranges = [];
    const keys = isSeq(sectionNodes)
      ? ["service", "account", "email", "url", "annotation"]
      : [
          "service",
          mapValueNode(source, "login") ? "login" : "account",
          "email",
          "url",
          "annotation",
        ];
    for (const key of keys) {
      const node = mapValueNode(source, key);
      if (isScalar(node) && node.value) ranges.push(nodeRange(node));
    }
    const fieldNodes = mapValueNode(source, "fields");
    if (isSeq(fieldNodes))
      for (const fieldNode of fieldNodes.items)
        ranges.push(nodeRange(mapValueNode(fieldNode, "value")));
    return ranges.length === section.fields.length
      ? ranges
      : section.fields.map(() => null);
  });
}

function parseLegacy(body, report) {
  const document = parseDocument(body, {
    strict: true,
    uniqueKeys: true,
    merge: false,
    prettyErrors: false,
  });
  if (document.errors.length || document.warnings.length) {
    const issue = document.errors[0] ?? document.warnings[0];
    report(
      "invalid_yaml",
      "Fix the legacy Security YAML syntax, or add a ## section heading for line-format fields.",
      issue?.pos?.[0] ?? 0,
      issue?.pos?.[1] ?? issue?.pos?.[0] ?? 0,
    );
    return null;
  }
  if (!isMap(document.contents)) {
    report(
      "invalid_legacy_security",
      "Use a ## section heading before line-format fields, or a supported legacy YAML map.",
      0,
      0,
    );
    return null;
  }
  let unsupported = false;
  let count = 0;
  visit(document, (_key, node) => {
    count += 1;
    if (count > 2048 || isAlias(node) || node?.anchor || node?.tag) {
      unsupported = true;
      report(
        "unsupported_yaml",
        "Remove YAML aliases, anchors, tags, or excessive nesting.",
        node?.range?.[0] ?? 0,
        node?.range?.[1] ?? node?.range?.[0] ?? 0,
      );
    }
  });
  if (unsupported) return null;
  const model = migrateYaml(
    document.toJS({ mapAsMap: true, maxAliasCount: 0 }),
  );
  if (!model) {
    const first = lineEntries(body).find(
      ({ text }) => text.trim() && !text.trimStart().startsWith("#"),
    );
    const missingSection =
      first &&
      /:\s*/u.test(first.text) &&
      !/^(?:title|sections|service|login|account|email|url|annotation|fields):/u.test(
        first.text,
      );
    report(
      missingSection ? "missing_section" : "invalid_legacy_security",
      missingSection
        ? "Add a ## section heading before line-format fields."
        : "Use a supported legacy Security YAML shape or the ## section format.",
      first?.from ?? 0,
      first ? first.from + first.text.length : 0,
    );
    return null;
  }
  return { model, fieldRanges: legacyFieldRanges(document, model) };
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
    (options.sectionSyntax !== "separators" || options.fieldSyntax !== "pipes")
  ) {
    report(
      "unsupported_section_syntax",
      "Use the supported Security section syntax.",
    );
    return invalid();
  }
  try {
    const separators = options?.sectionSyntax === "separators";
    const first = body.trimStart().split(/\r\n|\n|\r/u, 1)[0];
    const heading = first === "##" || first.startsWith("## ");
    // YAML comments historically accepted before legacy keys must not become
    // titles. A title belongs to line syntax only when followed by ## sections.
    // A malformed heading never falls back to YAML when a section is present.
    const lines = body.split(/\r\n|\n|\r/u);
    const legacyComment =
      first.startsWith("#") &&
      !lines.some((line) => line === "##" || line.startsWith("## "));
    const lineFormat =
      separators || heading || (first.startsWith("#") && !legacyComment);
    const parsed = lineFormat
      ? parseLines(body, options, report)
      : parseLegacy(body, report);
    return parsed && normalize(parsed.model, lineFormat ? options : {})
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
  const normalized = normalize(model, options);
  if (!normalized) throw new TypeError("invalid security block");
  const separators = options?.sectionSyntax === "separators";
  const lines = [];
  if (has(normalized, "title"))
    lines.push(normalized.title ? `# ${encode(normalized.title)}` : "#");
  for (const [index, section] of normalized.sections.entries()) {
    if (separators && index) lines.push("---");
    if (!separators || section.label)
      lines.push(section.label ? `## ${section.label}` : "##");
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
        value =
          options.fieldSyntax === "pipes"
            ? joinFieldParts(
                slots.map((slot) => encode(slot).replaceAll("|", "\\|")),
              )
            : encode(field.value);
      } catch {
        throw new TypeError("invalid security block");
      }
      lines.push(
        `${serializeFieldLabel(field, options)}:${value ? ` ${value}` : ""}`,
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

/** New-format masking is explicit; legacy inference happens during YAML migration. */
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
    const security =
      /^[ \t]*(`{3,}|~{3,})[ \t]*aic-security(?:[ \t].*)?$/iu.exec(line);
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
