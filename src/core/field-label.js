function valid(label) {
  return (
    typeof label === "string" &&
    label.length <= 256 &&
    label.trim() === label &&
    !/[\p{C}\u2028\u2029]/u.test(label)
  );
}
function fail() {
  throw new TypeError("Invalid field label");
}
/** Labels never carry type; JSON quoting protects punctuation and heading syntax. */
export function parseFieldLabel(raw, options = {}) {
  let label = raw;
  if (typeof raw !== "string") fail();
  if (raw.startsWith('"')) {
    try {
      label = JSON.parse(raw);
    } catch {
      fail();
    }
  } else if (/[:|"\\]/u.test(raw)) fail();
  if (!valid(label) || (!label && options.allowEmptyLabel !== true)) fail();
  return { label };
}
export function serializeFieldLabel(field, options = {}) {
  const label = field?.label;
  if (!valid(label) || (!label && options.allowEmptyLabel !== true)) fail();
  return /[:|"\\]/u.test(label) || /^[#\u0060~]/u.test(label) || label === "---"
    ? JSON.stringify(label)
    : label;
}
/** Locate the first separator without confusing a pipe in a quoted label. */
export function scanFieldLabel(line, options = {}) {
  let end;
  if (line.trimStart().startsWith('"')) {
    const first = line.indexOf('"');
    let cursor = first + 1;
    for (; cursor < line.length; cursor += 1) {
      if (line[cursor] === "\\") cursor += 1;
      else if (line[cursor] === '"') break;
    }
    if (cursor >= line.length) fail();
    end = cursor + 1;
    while (line[end] === " " || line[end] === "\t") end += 1;
    const separatorFrom = end;
    if ("*#_10".includes(line[end] ?? "") && end < line.length) end += 1;
    if (line[end] !== "|") fail();
    return {
      ...parseFieldLabel(line.slice(first, cursor + 1), options),
      separatorFrom,
    };
  }
  const pipe = line.indexOf("|");
  if (pipe < 0) return null;
  const separatorFrom =
    pipe > 0 && "*#_10".includes(line[pipe - 1]) ? pipe - 1 : pipe;
  return {
    ...parseFieldLabel(line.slice(0, separatorFrom).trim(), options),
    separatorFrom,
  };
}
