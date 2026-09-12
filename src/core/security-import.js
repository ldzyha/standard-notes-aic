import { parseDocument } from "yaml";
import {
  parseSecurityBlock,
  safeSecurityUrl,
  serializeSecurityBlock,
} from "./security-model.js";

const MAX_SOURCE_LENGTH = 1024 * 1024;
const MAX_ENTRIES = 256;
const MAX_FIELDS = 64;
const MAX_VALUE_LENGTH = 16 * 1024;
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
    { label: "TOTP", value: entry.secret, hide: true },
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
      fields.push({ label: key, value, hide: true });
    }
  }
  if (fields.length > MAX_FIELDS) return TOO_LARGE;
  for (const field of fields) {
    if (typeof field.value !== "string") return UNSUPPORTED;
    if (field.value.length > MAX_VALUE_LENGTH) return TOO_LARGE;
  }
  try {
    const model = { sections: [{ label: "Main", fields }] };
    const body = serializeSecurityBlock(model);
    const parsed = parseSecurityBlock(body);
    if (
      !parsed.ok ||
      parsed.model.sections.length !== 1 ||
      parsed.model.sections[0].label !== "Main" ||
      parsed.model.sections[0].fields.length !== fields.length ||
      parsed.model.sections[0].fields.some(
        (field, index) =>
          field.label !== fields[index].label ||
          field.value !== fields[index].value ||
          field.hide !== fields[index].hide,
      )
    )
      return UNSUPPORTED;
    return {
      ok: true,
      block: `\`\`\`aic-security\n${body}\`\`\``,
    };
  } catch {
    return TOO_LARGE;
  }
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

  const blocks = [];
  for (const entry of entries) {
    const converted = convertEntry(entry);
    if (!converted.ok) return converted;
    blocks.push(converted.block);
  }
  return { ok: true, markdown: blocks.join("\n\n"), count: blocks.length };
}
