export const STRUCTURED_PREVIEW_CORE_VERSION = "2.0.0";

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
  }));
}

export function serializeFrontmatter(rows, lineEnding = "\n") {
  const normalized = propertyRows(rows);
  if (
    !normalized.length ||
    normalized.some((row) => !validPropertyKey(row.key))
  )
    return "";
  return [
    "---",
    ...normalized.map((row) => `${row.key}: ${row.value}`),
    "---",
  ].join(lineEnding);
}

export function updateProperty(rows, index, field, value) {
  const next = propertyRows(rows);
  if (index < 0 || index >= next.length || !["key", "value"].includes(field))
    return next;
  next[index][field] =
    field === "key" ? String(value ?? "").trim() : text(value);
  return next;
}

export function addProperty(rows) {
  const next = propertyRows(rows);
  next.push({ key: uniquePropertyKey(next), value: "" });
  return next;
}

export function moveProperty(rows, from, to) {
  return moveItem(propertyRows(rows), from, to);
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
