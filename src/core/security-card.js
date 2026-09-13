const INVALID = Object.freeze({ ok: false, code: "invalid_card_field" });
const NUMBER = /^[0-9][0-9 -]*[0-9]$/u;
const NUMBER_DIGITS = /^[0-9]{12,19}$/u;
const CVV = /^[0-9]{3,4}$/u;
const DATE = /^(?:0[1-9]|1[0-2])\/(?:[0-9]{2}|[0-9]{4})$/u;
const MAX_VALUE_LENGTH = 128;
const ERROR = "Invalid card field";

function validPart(part, value) {
  if (value === "") return true;
  if (part === "number")
    return (
      NUMBER.test(value) && NUMBER_DIGITS.test(value.replace(/[ -]/gu, ""))
    );
  if (part === "cvv") return CVV.test(value);
  if (part === "date") return DATE.test(value);
  return false;
}

/** The explicit underscore marker, never a guess from a label or value. */
export function isCardField(field) {
  return field?.kind === "card";
}

/** A malformed typed card is repaired in source, never shown as raw fallback. */
export function parseCardField(field) {
  if (!isCardField(field) || typeof field.value !== "string") return INVALID;
  const number = field.value;
  const date = Object.hasOwn(field, "description") ? field.description : "";
  const cvv = Object.hasOwn(field, "additionalSecret")
    ? field.additionalSecret
    : "";
  if (
    typeof date !== "string" ||
    typeof cvv !== "string" ||
    number.length + date.length + cvv.length > MAX_VALUE_LENGTH ||
    !validPart("number", number) ||
    !validPart("date", date) ||
    !validPart("cvv", cvv)
  )
    return INVALID;
  return { ok: true, card: { number, date, cvv } };
}

/** Clipboard data is raw digits/date; CVV remains masked by the renderer. */
export function normalizeCardPart(part, value) {
  if (
    !["number", "cvv", "date"].includes(part) ||
    typeof value !== "string" ||
    value.length > MAX_VALUE_LENGTH
  )
    throw new TypeError(ERROR);
  const normalized = value.trim();
  if (!validPart(part, normalized)) throw new TypeError(ERROR);
  return normalized;
}
