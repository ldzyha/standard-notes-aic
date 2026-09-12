import { isAlias, isMap, parseDocument, visit } from "yaml";

const MAX_BODY_LENGTH = 64 * 1024;
const MAX_SECTIONS = 16;
const MAX_FIELDS = 64;
const MAX_VALUE_LENGTH = 16 * 1024;
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

function normalize(model) {
  if (!exactly(model, ["sections"])) return null;
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
      if (
        !exactly(field, ["label", "value", "hide"]) ||
        !name(get(field, "label")) ||
        !string(get(field, "value"), MAX_VALUE_LENGTH) ||
        typeof get(field, "hide") !== "boolean"
      )
        return null;
      normalizedFields.push({
        label: get(field, "label"),
        value: get(field, "value"),
        hide: get(field, "hide"),
      });
    }
    result.push({ label: get(section, "label"), fields: normalizedFields });
  }
  return { sections: result };
}

function decode(encoded) {
  let value = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character !== "\\") {
      const codePoint = encoded.codePointAt(index);
      const scalar = String.fromCodePoint(codePoint);
      if (/[\p{C}\u2028\u2029]/u.test(scalar)) return null;
      value += scalar;
      if (codePoint > 0xffff) index += 1;
      if (value.length > MAX_VALUE_LENGTH) return null;
      continue;
    }
    const escape = encoded[++index];
    if (escape === "\\") value += "\\";
    else if (escape === "n") value += "\n";
    else if (escape === "r") value += "\r";
    else if (escape === "t") value += "\t";
    else if (escape === "u") {
      const code = encoded.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/u.test(code)) return null;
      value += String.fromCharCode(Number.parseInt(code, 16));
      index += 4;
    } else return null;
    if (value.length > MAX_VALUE_LENGTH) return null;
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

function parseLines(body) {
  const lines = body.split(/\r\n|\n|\r/u);
  if (lines.at(-1) === "") lines.pop();
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (line === "##" || line.startsWith("## ")) {
      const label = line === "##" ? "" : line.slice(3);
      if ((line !== "##" && !name(label)) || sections.length >= MAX_SECTIONS)
        return null;
      current = { label, fields: [] };
      sections.push(current);
      continue;
    }
    if (!current || current.fields.length >= MAX_FIELDS) return null;
    const colon = line.indexOf(":");
    if (colon < 1) return null;
    const marked = line.slice(0, colon);
    const hide = marked.endsWith("*");
    const label = hide ? marked.slice(0, -1) : marked;
    const source = line.slice(colon + 1);
    if (!name(label) || (source && !source.startsWith(" "))) return null;
    const value = decode(source ? source.slice(1) : "");
    if (value === null) return null;
    current.fields.push({ label, value, hide });
  }
  return sections.length ? { sections } : null;
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
  return {
    label: name(label) ? label : "Field",
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
  if (exactly(value, ["sections"])) {
    const sections = get(value, "sections");
    if (
      !Array.isArray(sections) ||
      sections.length < 1 ||
      sections.length > MAX_SECTIONS
    )
      return null;
    const migrated = sections.map(oldSection);
    return migrated.every(Boolean) ? { sections: migrated } : null;
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
  return section ? { sections: [section] } : null;
}

function parseLegacy(body) {
  const document = parseDocument(body, {
    strict: true,
    uniqueKeys: true,
    merge: false,
    prettyErrors: false,
  });
  if (
    document.errors.length ||
    document.warnings.length ||
    !isMap(document.contents)
  )
    return null;
  let unsupported = false;
  let count = 0;
  visit(document, (_key, node) => {
    count += 1;
    if (count > 2048 || isAlias(node) || node?.anchor || node?.tag)
      unsupported = true;
  });
  return unsupported
    ? null
    : migrateYaml(document.toJS({ mapAsMap: true, maxAliasCount: 0 }));
}

/** Failure codes are fixed strings so validation never echoes secret values. */
export function parseSecurityBlock(body) {
  if (typeof body !== "string" || body.length > MAX_BODY_LENGTH) return INVALID;
  try {
    const first = body.trimStart().split(/\r\n|\n|\r/u, 1)[0];
    const model =
      first === "##" || first.startsWith("## ")
        ? parseLines(body)
        : parseLegacy(body);
    return model ? { ok: true, model } : INVALID;
  } catch {
    return INVALID;
  }
}

/** Stable line body. The caller owns the surrounding Markdown fence. */
export function serializeSecurityBlock(model) {
  const normalized = normalize(model);
  if (!normalized) throw new TypeError("invalid security block");
  const lines = [];
  for (const section of normalized.sections) {
    lines.push(section.label ? `## ${section.label}` : "##");
    for (const field of section.fields) {
      const value = encode(field.value);
      lines.push(
        `${field.label}${field.hide ? "*" : ""}:${value ? ` ${value}` : ""}`,
      );
    }
  }
  const body = `${lines.join("\n")}\n`;
  if (body.length > MAX_BODY_LENGTH)
    throw new TypeError("invalid security block");
  return body;
}

export function securityTemplate() {
  const body = serializeSecurityBlock({
    sections: [
      {
        label: "",
        fields: [
          { label: "Service", value: "", hide: false },
          { label: "Account", value: "", hide: false },
          { label: "Email", value: "", hide: false },
          { label: "URL", value: "", hide: false },
          { label: "TOTP", value: "", hide: true },
          { label: "Password", value: "", hide: true },
        ],
      },
    ],
  });
  return "```aic-security\n" + body + "```";
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
