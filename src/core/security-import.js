import { parseDocument } from "yaml";
import {
  parseSecurityBlock,
  safeSecurityUrl,
  SECURITY_LIMITS,
  serializeSecurityBlock,
} from "./security-model.js";
import { SECURITY_FIELD_OPTIONS, SECURITY_FENCE_INFO } from "./field-syntax.js";

const MAX_SOURCE_LENGTH = 1024 * 1024;
const MAX_ENTRIES = 256;
const STANDARD_KEYS = new Set([
  "service",
  "account",
  "secret",
  "password",
  "notes",
]);
const PROTOTYPE_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
const INVALID_JSON = Object.freeze({ ok: false, code: "invalid_json" });
const UNSUPPORTED = Object.freeze({
  ok: false,
  code: "unsupported_authenticator",
});
const TOO_LARGE = Object.freeze({ ok: false, code: "too_large" });

function securityLabel(value) {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[:*\\\p{C}\u2028\u2029]/u.test(value)
  );
}

// Typed Security syntax reserves terminal suffixes as field types/visibility. Keep imported keys
// recognizable without silently turning an authored name into another type.
function importedLabel(value) {
  return /[#_]$/u.test(value) ? `${value} (imported)` : value;
}

function unfence(source) {
  const trimmed = source.replace(/^\uFEFF/u, "").trim();
  if (!/^[ \t]*(?:`{3,}|~{3,})[ \t]*json[ \t]*(?:\r\n|\n|\r)/iu.test(trimmed))
    return trimmed;
  const lines = trimmed.split(/\r\n|\n|\r/u);
  const opener = /^[ \t]*(`{3,}|~{3,})[ \t]*json[ \t]*$/iu.exec(lines[0]);
  const closer = /^[ \t]*(`{3,}|~{3,})[ \t]*$/u.exec(lines.at(-1));
  if (
    !opener ||
    !closer ||
    opener[1][0] !== closer[1][0] ||
    closer[1].length < opener[1].length
  )
    return null;
  return lines.slice(1, -1).join("\n");
}

function serviceUrl(value) {
  const direct = safeSecurityUrl(value);
  if (direct) return direct;
  const markdown = /^\[[^\]\r\n]+\]\(([^()\r\n]+)\)$/u.exec(value);
  return markdown ? safeSecurityUrl(markdown[1]) : "";
}

function convertEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    return UNSUPPORTED;
  for (const key of ["service", "account", "secret"])
    if (!Object.hasOwn(entry, key) || typeof entry[key] !== "string")
      return UNSUPPORTED;

  const fields = [
    { label: "Service", value: entry.service, hide: false },
    { label: "Account", value: entry.account, hide: false },
    { label: "TOTP", value: entry.secret, hide: true, kind: "totp" },
  ];
  const url = serviceUrl(entry.service);
  if (url) fields.push({ label: "URL", value: url, hide: false });
  if (Object.hasOwn(entry, "password"))
    fields.push({ label: "Password", value: entry.password, hide: true });
  if (Object.hasOwn(entry, "notes"))
    fields.push({ label: "Notes", value: entry.notes, hide: false });

  for (const [key, value] of Object.entries(entry)) {
    if (PROTOTYPE_KEYS.has(key)) return UNSUPPORTED;
    if (!STANDARD_KEYS.has(key)) {
      if (!securityLabel(key) || typeof value !== "string") return UNSUPPORTED;
      fields.push({ label: importedLabel(key), value, hide: true });
    }
  }
  for (const field of fields) {
    if (typeof field.value !== "string") return UNSUPPORTED;
    if (field.value.length > SECURITY_LIMITS.maxValueLength) return TOO_LARGE;
  }
  return { ok: true, section: { label: "", fields } };
}

function checkedBody(sections) {
  let body;
  try {
    body = serializeSecurityBlock({ sections }, SECURITY_FIELD_OPTIONS);
  } catch {
    return TOO_LARGE;
  }
  const parsed = parseSecurityBlock(body, SECURITY_FIELD_OPTIONS);
  if (
    !parsed.ok ||
    parsed.model.sections.length !== sections.length ||
    parsed.model.sections.some(
      (section, sectionIndex) =>
        section.label !== sections[sectionIndex].label ||
        section.fields.length !== sections[sectionIndex].fields.length ||
        section.fields.some((field, fieldIndex) => {
          const original = sections[sectionIndex].fields[fieldIndex];
          return (
            field.label !== original.label ||
            field.value !== original.value ||
            field.hide !== original.hide ||
            field.kind !== original.kind ||
            field.description !== original.description ||
            field.additionalSecret !== original.additionalSecret
          );
        }),
    )
  )
    return UNSUPPORTED;
  return { ok: true, body };
}

// A record normally stays one section. Only a section that cannot fit the
// canonical limits is divided, at field boundaries, without dropping values.
function splitEntry(section) {
  const sections = [];
  for (let offset = 0; offset < section.fields.length;) {
    let low = 1;
    let high = Math.min(
      SECURITY_LIMITS.maxFields,
      section.fields.length - offset,
    );
    let best = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const part = {
        label: section.label,
        fields: section.fields.slice(offset, offset + middle),
      };
      const checked = checkedBody([part]);
      if (!checked.ok && checked.code === UNSUPPORTED.code) return UNSUPPORTED;
      if (checked.ok) {
        best = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (!best) return TOO_LARGE;
    sections.push({
      label: section.label,
      fields: section.fields.slice(offset, offset + best),
    });
    offset += best;
  }
  return { ok: true, sections };
}

/** Convert only a bounded, strict Authenticator JSON array; never echo failures. */
export function convertAuthenticatorJson(source) {
  if (typeof source !== "string") return INVALID_JSON;
  if (
    source.length > MAX_SOURCE_LENGTH ||
    new TextEncoder().encode(source).length > MAX_SOURCE_LENGTH
  )
    return TOO_LARGE;
  const json = unfence(source);
  if (json === null) return INVALID_JSON;
  let entries;
  try {
    entries = JSON.parse(json);
    const document = parseDocument(json, {
      strict: true,
      uniqueKeys: true,
      merge: false,
      prettyErrors: false,
    });
    if (document.errors.length || document.warnings.length) return INVALID_JSON;
  } catch {
    return INVALID_JSON;
  }
  if (!Array.isArray(entries) || entries.length === 0) return UNSUPPORTED;
  if (entries.length > MAX_ENTRIES) return TOO_LARGE;

  const sections = [];
  for (const entry of entries) {
    const converted = convertEntry(entry);
    if (!converted.ok) return converted;
    const split = splitEntry(converted.section);
    if (!split.ok) return split;
    sections.push(...split.sections);
  }
  const bodies = [];
  let pending = [];
  let pendingBody = "";
  for (const section of sections) {
    const candidate =
      pending.length < SECURITY_LIMITS.maxSections
        ? checkedBody([...pending, section])
        : TOO_LARGE;
    if (candidate.ok) {
      pending.push(section);
      pendingBody = candidate.body;
      continue;
    }
    if (candidate.code === UNSUPPORTED.code) return UNSUPPORTED;
    if (pending.length) bodies.push(pendingBody);
    const next = checkedBody([section]);
    if (!next.ok) return next;
    pending = [section];
    pendingBody = next.body;
  }
  if (pending.length) bodies.push(pendingBody);
  return {
    ok: true,
    markdown: bodies
      .map((body) => `\`\`\`${SECURITY_FENCE_INFO}\n${body}\`\`\``)
      .join("\n\n"),
    count: bodies.length,
    accountCount: entries.length,
    blockCount: bodies.length,
  };
}
