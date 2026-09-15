export const FIELD_PARTS_MAX_LENGTH = 16 * 1024;
export const FIELD_PARTS_MAX_COUNT = 64;
const KINDS = Object.freeze({
  "": "text",
  "*": "secret",
  "#": "totp",
  _: "card",
  1: "one-time",
  0: "used",
});
const MARKERS = Object.freeze({
  text: "",
  secret: "*",
  totp: "#",
  card: "_",
  "one-time": "1",
  used: "0",
});

function fail(code = "invalid_field_parts", offset = 0) {
  throw Object.assign(new TypeError("Invalid field parts"), { code, offset });
}

function bounded(value) {
  return typeof value === "string" && value.length <= FIELD_PARTS_MAX_LENGTH;
}

function separatorAt(raw, index) {
  if (raw[index] === "|") return { kind: "text", end: index + 1 };
  if (Object.hasOwn(KINDS, raw[index]) && raw[index + 1] === "|")
    return { kind: KINDS[raw[index]], end: index + 2 };
  return null;
}

/** Scan separator-first parts. Only JSON quotes protect literal pipes. */
export function scanFieldParts(raw) {
  if (!bounded(raw)) fail("value_too_long");
  const parts = [];
  let cursor = 0;
  while (/[ \t]/u.test(raw[cursor] ?? "") && cursor < raw.length) cursor += 1;
  while (cursor < raw.length) {
    const separatorFrom = cursor;
    const separator = separatorAt(raw, cursor);
    if (!separator) fail("missing_field_separator", cursor);
    if (parts.length >= FIELD_PARTS_MAX_COUNT) fail("too_many_parts", cursor);
    cursor = separator.end;
    while (raw[cursor] === " " || raw[cursor] === "\t") cursor += 1;
    const from = cursor;
    let to;
    let quoted = false;
    if (raw[cursor] === '"') {
      quoted = true;
      cursor += 1;
      let closed = false;
      while (cursor < raw.length) {
        if (raw[cursor] === '"') {
          cursor += 1;
          closed = true;
          break;
        }
        if (raw[cursor] === "\\") {
          const escapeFrom = cursor;
          const escape = raw[++cursor];
          if (escape === "u") {
            if (!/^[0-9a-fA-F]{4}$/u.test(raw.slice(cursor + 1, cursor + 5)))
              fail("invalid_escape", escapeFrom);
            cursor += 4;
          } else if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
            fail("invalid_escape", escapeFrom);
          }
        } else if (raw.charCodeAt(cursor) < 32)
          fail("control_character", cursor);
        cursor += 1;
      }
      if (!closed) fail("unterminated_quote", from);
      to = cursor;
      while (raw[cursor] === " " || raw[cursor] === "\t") cursor += 1;
      if (cursor < raw.length && !separatorAt(raw, cursor))
        fail("unexpected_after_quote", cursor);
    } else {
      const pipe = raw.indexOf("|", cursor);
      let end = pipe < 0 ? raw.length : pipe;
      if (pipe >= 0 && "*#_10".includes(raw[pipe - 1] ?? "") && pipe > cursor)
        end -= 1;
      cursor = end;
      to = end;
      while (to > from && (raw[to - 1] === " " || raw[to - 1] === "\t"))
        to -= 1;
      const value = raw.slice(from, to);
      const control = /[\p{C}\u2028\u2029]/u.exec(value);
      if (control) fail("control_character", from + control.index);
      if (value.includes('"'))
        fail("unexpected_quote", from + value.indexOf('"'));
    }
    parts.push({
      kind: separator.kind,
      encoded: raw.slice(from, to),
      quoted,
      from,
      to,
      separatorFrom,
      separatorTo: separator.end,
    });
  }
  if (!parts.length) fail("missing_field_separator");
  return parts;
}

export function parseFieldParts(raw) {
  return scanFieldParts(raw).map(({ kind, encoded, quoted }) => ({
    kind,
    value: quoted ? JSON.parse(encoded) : encoded,
  }));
}

/** JSON is the sole escape syntax and preserves significant boundary whitespace. */
export function quoteFieldPart(value) {
  if (!bounded(value)) fail();
  if (value.trim() === value && !/[|"\\\p{C}\u2028\u2029]/u.test(value))
    return null;
  const encoded = JSON.stringify(value).replace(
    /[\u2028\u2029]/gu,
    (character) =>
      "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  if (!bounded(encoded)) fail("value_too_long");
  return encoded;
}

export function serializeFieldParts(parts) {
  if (
    !Array.isArray(parts) ||
    !parts.length ||
    parts.length > FIELD_PARTS_MAX_COUNT
  )
    fail();
  const result = parts
    .map((part) => {
      if (
        !part ||
        Object.keys(part).length !== 2 ||
        !Object.hasOwn(part, "kind") ||
        !Object.hasOwn(part, "value") ||
        !Object.hasOwn(MARKERS, part.kind) ||
        !bounded(part.value)
      )
        fail();
      const value = quoteFieldPart(part.value) ?? part.value;
      return MARKERS[part.kind] + "|" + (value ? " " + value : "");
    })
    .join(" ");
  if (!bounded(result)) fail("value_too_long");
  return result;
}
