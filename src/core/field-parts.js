export const FIELD_PARTS_MAX_LENGTH = 16 * 1024;
const ERROR = "Invalid field parts";

function fail(code, offset = 0) {
  const error = new TypeError(ERROR);
  throw code ? Object.assign(error, { code, offset }) : error;
}

function bounded(value) {
  return typeof value === "string" && value.length <= FIELD_PARTS_MAX_LENGTH;
}

/** One scanner owns quoting, spaced delimiters, limits and source locations. */
export function scanFieldParts(raw) {
  if (!bounded(raw))
    fail("value_too_long", typeof raw === "string" ? raw.length : 0);
  const parts = [];
  let start = 0;
  const separator = (index) =>
    raw[index] === "|" && raw[index - 1] === " " && raw[index + 1] === " ";
  while (start <= raw.length) {
    let first = start;
    while (raw[first] === " ") first += 1;
    let delimiter = raw.length;
    if (raw[first] === '"') {
      let close = -1;
      for (let index = first + 1; index < raw.length; index += 1) {
        const character = raw[index];
        if (character === '"') {
          close = index;
          break;
        }
        if (character === "\\") {
          const escape = raw[++index];
          if (escape === "u") {
            if (!/^[0-9a-fA-F]{4}$/u.test(raw.slice(index + 1, index + 5)))
              fail("invalid_escape", index - 1);
            index += 4;
          } else if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
            fail("invalid_escape", index - 1);
          }
        } else if (character.charCodeAt(0) < 32) {
          fail("control_character", index);
        }
      }
      if (close < 0) fail("unterminated_quote", first);
      delimiter = close + 1;
      while (raw[delimiter] === " ") delimiter += 1;
      if (delimiter < raw.length && !separator(delimiter))
        fail("unexpected_after_quote", delimiter);
      parts.push({
        encoded: raw.slice(first, close + 1),
        from: first,
        to: close + 1,
        quoted: true,
      });
    } else {
      for (let index = start; index < raw.length; index += 1) {
        if (raw[index] === "\\") {
          if (index + 1 === raw.length) fail("invalid_escape", index);
          index += 1;
        } else if (separator(index)) {
          delimiter = index;
          break;
        }
      }
      const end =
        delimiter < raw.length ? Math.max(start, delimiter - 1) : raw.length;
      parts.push({
        encoded: raw.slice(start, end),
        from: start,
        to: end,
        quoted: false,
      });
    }
    if (delimiter === raw.length) break;
    if (parts.length === 3) fail("too_many_parts", delimiter);
    start = delimiter + 2;
  }
  return parts;
}

/** Keep encoded strings intact; the scanner identifies quoted slots separately. */
export function splitFieldParts(raw) {
  return scanFieldParts(raw).map((part) => part.encoded);
}

/** Use a JSON string for values whose literal pipes or quotes need protection. */
export function quoteFieldPart(value) {
  if (!bounded(value)) fail();
  if (!/[|"]/u.test(value)) return null;
  const encoded = JSON.stringify(value);
  if (!bounded(encoded)) fail();
  return encoded;
}

/** Join slots already encoded for the host's source format. */
export function joinFieldParts(encodedSlots) {
  if (
    !Array.isArray(encodedSlots) ||
    encodedSlots.length < 1 ||
    encodedSlots.length > 3 ||
    !encodedSlots.every(bounded)
  )
    fail();
  const joined = encodedSlots.join(" | ");
  if (!bounded(joined)) fail();
  return joined;
}

/** The pipe layer escapes only its two syntax characters. */
export function escapePipePart(value) {
  if (!bounded(value)) fail();
  const escaped = value.replace(/[\\|]/gu, (character) => "\\" + character);
  if (!bounded(escaped)) fail();
  return escaped;
}

export function unescapePipePart(raw) {
  if (!bounded(raw)) fail();
  let value = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "\\") {
      value += raw[index];
      continue;
    }
    const next = raw[++index];
    if (next !== "\\" && next !== "|") fail();
    value += next;
  }
  return value;
}

/** For decoded YAML scalars; Security uses scanFieldParts before host decoding. */
export function parseFieldParts(raw) {
  const slots = scanFieldParts(raw).map((part) =>
    part.quoted ? JSON.parse(part.encoded) : unescapePipePart(part.encoded),
  );
  return {
    value: slots[0],
    ...(slots.length > 1 ? { description: slots[1] } : {}),
    ...(slots.length > 2 ? { additionalSecret: slots[2] } : {}),
  };
}

/** Preserve absent and explicitly empty slots as distinct source forms. */
export function serializeFieldParts(field) {
  if (!field || typeof field !== "object" || !bounded(field.value)) fail();
  const hasDescription = Object.hasOwn(field, "description");
  const hasSecret = Object.hasOwn(field, "additionalSecret");
  if (
    (hasDescription && !bounded(field.description)) ||
    (hasSecret && !bounded(field.additionalSecret))
  )
    fail();
  const slots = [field.value];
  if (hasDescription || hasSecret)
    slots.push(hasDescription ? field.description : "");
  if (hasSecret) slots.push(field.additionalSecret);
  return joinFieldParts(
    slots.map((slot) => quoteFieldPart(slot) ?? escapePipePart(slot)),
  );
}
