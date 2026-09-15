const INVALID = Object.freeze({ ok: false, code: "invalid_card_field" });
const NUMBER = /^[0-9][0-9 -]*[0-9]$/u;
const NUMBER_DIGITS = /^[0-9]{12,19}$/u;
const MAX_VALUE_LENGTH = 128;
const ERROR = "Invalid card field";

function validPart(part, value) {
  if (value === "") return true;
  if (part === "number")
    return (
      NUMBER.test(value) && NUMBER_DIGITS.test(value.replace(/[ -]/gu, ""))
    );
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
  if (number.length > MAX_VALUE_LENGTH || !validPart("number", number))
    return INVALID;
  return { ok: true, card: { number } };
}

/** A card part owns only its number; adjacent text/secrets have independent types. */
export function normalizeCardPart(part, value) {
  if (
    part !== "number" ||
    typeof value !== "string" ||
    value.length > MAX_VALUE_LENGTH
  )
    throw new TypeError(ERROR);
  const normalized = value.trim();
  if (!validPart(part, normalized)) throw new TypeError(ERROR);
  return normalized;
}
