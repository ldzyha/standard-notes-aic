const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const INVALID = "Invalid field label";

function fail() {
  throw new TypeError(INVALID);
}

function printable(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[\p{C}\u2028\u2029]/u.test(value)
  );
}

/** Marker interpretation is selected by callers; Security alone allows empty labels. */
export function parseFieldLabel(rawKey, options = {}) {
  if (typeof rawKey !== "string") fail();
  let source = rawKey;
  const pipes = options?.fieldSyntax === "pipes";
  if (options?.fieldSyntax !== undefined && !pipes) fail();
  const marker = pipes ? source.at(-1) : source.endsWith("*") ? "*" : "";
  const marked =
    marker === "*" || (pipes && (marker === "#" || marker === "_"));
  if (marked) {
    source = source.slice(0, -1);
  }
  if (
    !(
      printable(source) ||
      (options?.allowEmptyLabel === true && source === "")
    ) ||
    (pipes && RESERVED.has(source)) ||
    (pipes && /[*#_]$/u.test(source))
  )
    fail();
  return {
    label: source,
    hide: marker === "*" || marker === "#",
    ...(marker === "#" ? { kind: "totp" } : {}),
    ...(marker === "_" ? { kind: "card" } : {}),
  };
}

/** Serialize the marker without interpreting value components. */
export function serializeFieldLabel(field, options = {}) {
  const pipes = options?.fieldSyntax === "pipes";
  if (
    (options?.fieldSyntax !== undefined && !pipes) ||
    !field ||
    typeof field !== "object" ||
    Array.isArray(field) ||
    !(
      printable(field.label) ||
      (options?.allowEmptyLabel === true && field.label === "")
    ) ||
    (pipes && RESERVED.has(field.label)) ||
    typeof field.hide !== "boolean" ||
    (!pipes && field.kind !== undefined) ||
    (field.kind !== undefined && !["totp", "card"].includes(field.kind)) ||
    (field.kind === "totp" && !field.hide) ||
    (pipes ? /[*#_]$/u : /\*$/u).test(field.label)
  )
    fail();
  const marker =
    pipes && field.kind === "totp"
      ? "#"
      : pipes && field.kind === "card"
        ? "_"
        : field.hide
          ? "*"
          : "";
  const raw = `${field.label}${marker}`;
  const parsed = parseFieldLabel(raw, options);
  if (
    parsed.label !== field.label ||
    (field.kind !== "card" && parsed.hide !== field.hide) ||
    parsed.kind !== field.kind
  )
    fail();
  return raw;
}
