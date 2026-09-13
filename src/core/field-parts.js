const MAX_LENGTH = 16 * 1024;
const ERROR = "Invalid field parts";

function fail() {
  throw new TypeError(ERROR);
}

function bounded(value) {
  return typeof value === "string" && value.length <= MAX_LENGTH;
}

/** Split encoded source before a host's own escape decoder runs. */
export function splitFieldParts(raw) {
  if (!bounded(raw)) fail();
  const parts = [];
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "\\") {
      if (index + 1 === raw.length) fail();
      index += 1;
      continue;
    }
    if (raw[index] !== "|") continue;
    let end = index;
    if (end > start && raw[end - 1] === " ") end -= 1;
    parts.push(raw.slice(start, end));
    if (parts.length === 3) fail();
    start = index + 1;
    if (raw[start] === " ") start += 1;
    index = start - 1;
  }
  parts.push(raw.slice(start));
  return parts;
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

/** For decoded YAML scalars; Security uses splitFieldParts before decode. */
export function parseFieldParts(raw) {
  const slots = splitFieldParts(raw).map(unescapePipePart);
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
  return joinFieldParts(slots.map(escapePipePart));
}
