// Shared recovery-code codec. No storage, DOM, clipboard or account access.
const MAX_VALUE_LENGTH = 16 * 1024;
const MAX_CODES = 256;
const MAX_CODE_LENGTH = 256;
const INVALID = Object.freeze({ ok: false, code: "invalid_recovery_codes" });
const TOO_LARGE = Object.freeze({
  ok: false,
  code: "recovery_codes_too_large",
});
const INVALID_CHARACTERS = /[\p{C}\u2028\u2029]/u;
const CHECKLIST = /^- \[([ x])\] (.*)$/u;
const CHECKLIST_MARKER = /^\s*-\s*\[/u;

export function isRecoveryField(field) {
  return (
    field?.hide === true &&
    typeof field.label === "string" &&
    /^(?:Recovery codes|Backup codes)$/iu.test(field.label)
  );
}

function lines(raw) {
  if (typeof raw !== "string") return INVALID;
  if (raw.length > MAX_VALUE_LENGTH) return TOO_LARGE;
  const values = raw.split(/\r\n|\r|\n/u);
  if (values.some((value) => INVALID_CHARACTERS.test(value))) return INVALID;
  return {
    ok: true,
    values: values.filter((value) => value.trim().length > 0),
  };
}

function validate(codes) {
  if (!Array.isArray(codes)) return INVALID;
  if (codes.length > MAX_CODES) return TOO_LARGE;
  let length = Math.max(0, codes.length - 1);
  for (const entry of codes) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.value !== "string" ||
      typeof entry.used !== "boolean" ||
      !entry.value.trim().length ||
      INVALID_CHARACTERS.test(entry.value)
    )
      return INVALID;
    if (entry.value.length > MAX_CODE_LENGTH) return TOO_LARGE;
    length += 6 + entry.value.length;
  }
  return length > MAX_VALUE_LENGTH ? TOO_LARGE : { ok: true, codes };
}

/** Bulk input is always literal: checklist-like text is itself a new code. */
export function parseRecoveryCodesPaste(raw) {
  const parsed = lines(raw);
  if (!parsed.ok) return parsed;
  return validate(parsed.values.map((value) => ({ value, used: false })));
}

/** Stored values are either a complete canonical checklist or an unused batch. */
export function parseRecoveryCodes(value) {
  const parsed = lines(value);
  if (!parsed.ok) return parsed;
  if (!parsed.values.some((line) => CHECKLIST_MARKER.test(line)))
    return validate(parsed.values.map((value) => ({ value, used: false })));
  const codes = [];
  for (const line of parsed.values) {
    const match = CHECKLIST.exec(line);
    if (!match) return INVALID;
    codes.push({ value: match[2], used: match[1] === "x" });
  }
  return validate(codes);
}

export function serializeRecoveryCodes(codes) {
  const result = validate(codes);
  if (!result.ok) {
    if (result.code === "recovery_codes_too_large")
      throw new RangeError("Recovery codes exceed supported limits");
    throw new TypeError("Invalid recovery codes");
  }
  return codes
    .map(({ value, used }) => `- [${used ? "x" : " "}] ${value}`)
    .join("\n");
}
