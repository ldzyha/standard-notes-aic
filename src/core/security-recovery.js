import {
  FIELD_PARTS_MAX_COUNT,
  FIELD_PARTS_MAX_LENGTH,
  serializeFieldParts,
} from "./field-parts.js";

const MAX_CODE_LENGTH = 256;
const INVALID = Object.freeze({ ok: false, code: "invalid_recovery_codes" });
const TOO_LARGE = Object.freeze({
  ok: false,
  code: "recovery_codes_too_large",
});
const INVALID_CHARACTERS = /[\p{C}\u2028\u2029]/u;

/** Explicit one-time paste is literal; checklist prefixes have no stored meaning. */
export function parseRecoveryCodesPaste(raw) {
  if (typeof raw !== "string") return INVALID;
  if (raw.length > FIELD_PARTS_MAX_LENGTH) return TOO_LARGE;
  const lines = raw.split(/\r\n|\r|\n/u);
  if (lines.some((value) => INVALID_CHARACTERS.test(value))) return INVALID;
  const values = lines.filter((value) => value.trim().length > 0);
  if (
    values.length > FIELD_PARTS_MAX_COUNT ||
    values.some((value) => value.length > MAX_CODE_LENGTH)
  )
    return TOO_LARGE;
  if (values.length) {
    try {
      serializeFieldParts(values.map((value) => ({ kind: "one-time", value })));
    } catch {
      return TOO_LARGE;
    }
  }
  return { ok: true, codes: values.map((value) => ({ value })) };
}
