export const STRUCTURED_PREVIEW_CORE_VERSION = "2.5.0";

const activeCellEditors = new WeakMap();

export function selectionRevealsPreview(ranges, from, to) {
  if (!Array.isArray(ranges) || !Number.isFinite(from) || !Number.isFinite(to))
    return false;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) return false;
  return ranges.some((range) => {
    const selectionFrom = Math.min(Number(range?.from), Number(range?.to));
    const selectionTo = Math.max(Number(range?.from), Number(range?.to));
    return (
      Number.isFinite(selectionFrom) &&
      Number.isFinite(selectionTo) &&
      selectionFrom < selectionTo &&
      selectionFrom < end &&
      selectionTo > start
    );
  });
}

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

export function createIconButton(
  document,
  { label, icon, className = "", disabled = false, onActivate } = {},
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cm-aic-icon-button ${className}`.trim();
  button.dataset.aicIcon = String(icon || "action");
  button.setAttribute("aria-label", String(label || "Action"));
  button.disabled = Boolean(disabled);
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onActivate?.(button);
  });
  return button;
}

export function formatPropertyValue(key, value, locale) {
  const source = String(value ?? "");
  if (!/^(?:created|updated)$/iu.test(String(key ?? "").trim())) return source;
  const timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) return source;
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(timestamp));
  } catch {
    return source;
  }
}

export function createCellEditor(
  document,
  {
    value = "",
    displayValue,
    label = "Edit value",
    multiline = false,
    readOnly = false,
    validate,
    onCommit,
  } = {},
) {
  const source = String(value ?? "");
  const visible = String(displayValue ?? source);
  const control = document.createElement("span");
  control.className = "cm-aic-cell-value";
  control.dataset.empty = visible ? "false" : "true";
  control.textContent = visible || "—";
  control.setAttribute("aria-label", String(label));
  if (readOnly) return control;

  control.tabIndex = 0;
  control.setAttribute("role", "button");
  control.setAttribute("aria-haspopup", "dialog");

  const open = () => {
    activeCellEditors.get(document)?.();
    const popup = document.createElement("div");
    popup.className = "cm-aic-cell-popover";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", String(label));
    const field = multiline
      ? document.createElement("textarea")
      : document.createElement("input");
    if (multiline) field.rows = 4;
    else field.type = "text";
    field.className = "cm-aic-cell-editor";
    field.value = source;
    field.setAttribute("aria-label", String(label));
    const actions = document.createElement("span");
    actions.className = "cm-aic-cell-popover-actions";
    let outsideTimer;
    const reposition = () => {
      if (!popup.isConnected) return;
      const view = document.defaultView;
      const rect = control.getBoundingClientRect();
      const viewportWidth =
        view?.innerWidth ?? document.documentElement.clientWidth;
      const viewportHeight =
        view?.innerHeight ?? document.documentElement.clientHeight;
      const width = Math.min(
        Math.max(rect.width, 260),
        Math.max(260, viewportWidth - 24),
      );
      popup.style.width = `${width}px`;
      const measured = popup.getBoundingClientRect();
      const left = Math.max(
        12,
        Math.min(rect.left, viewportWidth - width - 12),
      );
      const below = rect.bottom + 6;
      const top =
        below + measured.height <= viewportHeight - 12
          ? below
          : Math.max(12, rect.top - measured.height - 6);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    const close = () => {
      if (outsideTimer)
        (document.defaultView ?? globalThis).clearTimeout(outsideTimer);
      document.removeEventListener("pointerdown", onOutside, true);
      document.defaultView?.removeEventListener("resize", reposition);
      document.defaultView?.removeEventListener("scroll", reposition, true);
      popup.remove();
      control.setAttribute("aria-expanded", "false");
      if (activeCellEditors.get(document) === close)
        activeCellEditors.delete(document);
    };
    const commit = () => {
      const error = validate?.(field.value);
      if (typeof error === "string" && error) {
        field.setCustomValidity(error);
        field.reportValidity();
        return false;
      }
      if (error === false) return false;
      field.setCustomValidity("");
      const next = field.value;
      close();
      onCommit?.(next);
      return true;
    };
    const onOutside = (event) => {
      if (!popup.contains(event.target) && !control.contains(event.target))
        close();
    };
    const save = createIconButton(document, {
      label: "Apply change",
      icon: "check",
      className: "cm-aic-cell-popover-action",
      onActivate: commit,
    });
    const cancel = createIconButton(document, {
      label: "Cancel edit",
      icon: "close",
      className: "cm-aic-cell-popover-action",
      onActivate: close,
    });
    actions.append(save, cancel);
    popup.append(field, actions);
    document.body.append(popup);
    activeCellEditors.set(document, close);
    control.setAttribute("aria-expanded", "true");
    reposition();
    document.defaultView?.addEventListener("resize", reposition);
    document.defaultView?.addEventListener("scroll", reposition, true);
    outsideTimer = (document.defaultView ?? globalThis).setTimeout(
      () => document.addEventListener("pointerdown", onOutside, true),
      0,
    );
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s"
      ) {
        if (!commit()) event.preventDefault();
      } else if (
        event.key === "Enter" &&
        (!multiline || event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        commit();
      }
    });
    field.focus();
    field.select();
  };

  control.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  control.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  return control;
}

export function showIconFeedback(
  button,
  {
    icon = "check",
    label = "Copied",
    restoreIcon = "copy",
    restoreLabel = "Copy",
    duration = 1200,
  } = {},
) {
  button.dataset.aicIcon = icon;
  button.setAttribute("aria-label", label);
  button.ownerDocument.defaultView?.setTimeout(() => {
    button.dataset.aicIcon = restoreIcon;
    button.setAttribute("aria-label", restoreLabel);
  }, duration);
}

export async function writeTextToClipboard(text, document) {
  const value = String(text ?? "");
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Sandboxed clients can deny Clipboard API access; use the gesture fallback.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    return document.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
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
  const copy = createIconButton(document, {
    label: "Copy link",
    icon: "copy",
    className: "cm-aic-link-action",
    onActivate: async (button) => {
      const result = await options.onCopy?.();
      if (result === false) return;
      showIconFeedback(button, {
        restoreLabel: "Copy link",
      });
    },
  });
  copy.disabled = !options.url;
  const edit = createIconButton(document, {
    label: options.readOnly ? "View link source" : "Edit link",
    icon: options.readOnly ? "source" : "edit",
    className: "cm-aic-link-action",
    onActivate: () => options.onEdit?.(),
  });
  actions.append(copy, edit);
  wrapper.append(open, actions);
  return wrapper;
}
