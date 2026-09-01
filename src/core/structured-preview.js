export const STRUCTURED_PREVIEW_CORE_VERSION = "2.1.0";

function text(value) {
  return String(value ?? "").replace(/\r?\n|\r/g, " ");
}

function tableCell(value) {
  return text(value).replace(/\|/g, "\\|");
}

function tableModel(model) {
  const header = [...(model?.header ?? [])].map(text);
  const aligns = header.map((_, index) => model?.aligns?.[index] ?? "");
  const rows = [...(model?.rows ?? [])].map((row) =>
    header.map((_, index) => text(row?.[index] ?? "")),
  );
  return { header, aligns, rows };
}

export function serializeTable(model, lineEnding = "\n") {
  const next = tableModel(model);
  if (!next.header.length) return "";
  const row = (cells) => `| ${cells.map(tableCell).join(" | ")} |`;
  const delimiter = next.aligns.map((align) =>
    align === "center"
      ? ":---:"
      : align === "right"
        ? "---:"
        : align === "left"
          ? ":---"
          : "---",
  );
  return [row(next.header), row(delimiter), ...next.rows.map(row)].join(
    lineEnding,
  );
}

export function updateTableCell(model, rowIndex, columnIndex, value) {
  const next = tableModel(model);
  if (rowIndex === -1) {
    if (columnIndex >= 0 && columnIndex < next.header.length)
      next.header[columnIndex] = text(value);
  } else if (
    rowIndex >= 0 &&
    rowIndex < next.rows.length &&
    columnIndex >= 0 &&
    columnIndex < next.header.length
  ) {
    next.rows[rowIndex][columnIndex] = text(value);
  }
  return next;
}

export function addTableRow(model) {
  const next = tableModel(model);
  next.rows.push(next.header.map(() => ""));
  return next;
}

export function addTableColumn(model, label = "Column") {
  const next = tableModel(model);
  next.header.push(text(label));
  next.aligns.push("");
  for (const row of next.rows) row.push("");
  return next;
}

export function moveItem(items, from, to) {
  const next = [...items];
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length ||
    from === to
  ) {
    return next;
  }
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function moveTableRow(model, from, to) {
  const next = tableModel(model);
  next.rows = moveItem(next.rows, from, to);
  return next;
}

export function moveTableColumn(model, from, to) {
  const next = tableModel(model);
  next.header = moveItem(next.header, from, to);
  next.aligns = moveItem(next.aligns, from, to);
  next.rows = next.rows.map((row) => moveItem(row, from, to));
  return next;
}

export function validPropertyKey(value) {
  return /^[A-Za-z0-9_.-]+$/.test(String(value ?? ""));
}

export function parseFrontmatterRows(source) {
  const rows = [];
  const levels = [];
  const keysByParent = new Map();
  for (const original of String(source ?? "").split(/\r?\n|\r/g)) {
    if (!original.trim()) continue;
    if (/\t/.test(original.match(/^\s*/)?.[0] ?? "")) return null;
    let match = /^( *)(- +)?([A-Za-z0-9_.-]+):( *)(.*)$/.exec(original);
    let scalar = false;
    if (!match) {
      const list = /^( *)- +(.*)$/.exec(original);
      if (!list) return null;
      match = [original, list[1], "- ", "", "", list[2]];
      scalar = true;
    }
    const indent = match[1].length;
    if (!rows.length && (indent !== 0 || match[2])) return null;
    while (levels.length && levels[levels.length - 1].indent >= indent)
      levels.pop();
    const depth = levels.length;
    const parent = levels[levels.length - 1]?.index ?? -1;
    const value = text(match[5]);
    if (!scalar && ["|", ">", "|-", ">-", "|+", ">+"].includes(value.trim()))
      return null;
    if (!scalar && !match[2]) {
      const keys = keysByParent.get(parent) ?? new Set();
      if (keys.has(match[3])) return null;
      keys.add(match[3]);
      keysByParent.set(parent, keys);
    }
    rows.push({
      key: scalar ? "" : match[3],
      value,
      indent,
      depth,
      sequence: Boolean(match[2]),
      scalar,
      spacing: scalar ? "" : match[4],
    });
    levels.push({ indent, index: rows.length - 1 });
  }
  return rows.length ? rows : null;
}

export function uniquePropertyKey(rows, seed = "property") {
  const used = new Set((rows ?? []).map((row) => String(row?.key ?? "")));
  const base = validPropertyKey(seed) ? seed : "property";
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

function propertyRows(rows) {
  return [...(rows ?? [])].map((row) => ({
    key: String(row?.key ?? ""),
    value: text(row?.value ?? ""),
    indent: Math.max(0, Math.trunc(Number(row?.indent) || 0)),
    depth: Math.max(0, Math.trunc(Number(row?.depth) || 0)),
    sequence: Boolean(row?.sequence),
    scalar: Boolean(row?.scalar),
    spacing:
      typeof row?.spacing === "string" ? row.spacing.replace(/[^ ]/g, "") : " ",
  }));
}

export function serializeFrontmatter(rows, lineEnding = "\n") {
  const normalized = propertyRows(rows);
  if (
    !normalized.length ||
    normalized.some((row) => !row.scalar && !validPropertyKey(row.key))
  )
    return "";
  return [
    "---",
    ...normalized.map((row) => {
      const prefix = " ".repeat(row.indent) + (row.sequence ? "- " : "");
      if (row.scalar) return prefix + row.value;
      const spacing = row.value ? row.spacing || " " : row.spacing;
      return prefix + row.key + ":" + spacing + row.value;
    }),
    "---",
  ].join(lineEnding);
}

export function updateProperty(rows, index, field, value) {
  const next = propertyRows(rows);
  if (index < 0 || index >= next.length || !["key", "value"].includes(field))
    return next;
  next[index][field] =
    field === "key" ? String(value ?? "").trim() : text(value);
  if (field === "value" && next[index].value && !next[index].spacing)
    next[index].spacing = " ";
  return next;
}

export function addProperty(rows) {
  const next = propertyRows(rows);
  next.push({
    key: uniquePropertyKey(next.filter((row) => row.indent === 0)),
    value: "",
    indent: 0,
    depth: 0,
    sequence: false,
    scalar: false,
    spacing: " ",
  });
  return next;
}

export function moveProperty(rows, from, to) {
  const next = propertyRows(rows);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length ||
    from === to
  )
    return next;
  const parentOf = (index) => {
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (next[cursor].indent < next[index].indent) return cursor;
    }
    return -1;
  };
  if (
    next[from].indent !== next[to].indent ||
    next[from].sequence !== next[to].sequence ||
    parentOf(from) !== parentOf(to)
  )
    return next;
  const subtreeEnd = (index) => {
    let end = index + 1;
    while (end < next.length && next[end].indent > next[index].indent) end++;
    return end;
  };
  const sourceEnd = subtreeEnd(from);
  const targetEnd = subtreeEnd(to);
  const block = next.slice(from, sourceEnd);
  next.splice(from, block.length);
  const insertAt = from < to ? targetEnd - block.length : to;
  next.splice(insertAt, 0, ...block);
  return next;
}

function actionButton(document, label, className, run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void run(button);
  });
  return button;
}

export function createLinkControl(document, options) {
  const wrapper = document.createElement("span");
  wrapper.className = "cm-aic-link-control";
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute(
    "aria-label",
    `Link: ${options.label || options.url || "empty"}`,
  );

  const open = actionButton(
    document,
    options.label || options.url || "Empty link",
    "cm-aic-link-open",
    () => options.onOpen?.(),
  );
  open.disabled = !options.url || options.openable === false;

  const actions = document.createElement("span");
  actions.className = "cm-aic-link-actions";
  const copy = actionButton(
    document,
    "Copy",
    "cm-aic-link-action",
    async (button) => {
      const result = await options.onCopy?.();
      if (result === false) return;
      button.textContent = "Copied";
      document.defaultView?.setTimeout(() => {
        button.textContent = "Copy";
      }, 1200);
    },
  );
  copy.disabled = !options.url;
  const edit = actionButton(
    document,
    options.readOnly ? "View source" : "Edit",
    "cm-aic-link-action",
    () => options.onEdit?.(),
  );
  actions.append(copy, edit);
  wrapper.append(open, actions);
  return wrapper;
}
