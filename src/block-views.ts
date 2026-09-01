import { syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  addProperty,
  addTableColumn,
  addTableRow,
  moveProperty,
  moveTableColumn,
  moveTableRow,
  parseFrontmatterRows,
  selectionRevealsPreview,
  serializeFrontmatter,
  serializeTable,
  updateProperty,
  updateTableCell,
  validPropertyKey,
  type PropertyRow,
  type TableModel,
} from "./core/structured-preview.js";

export type FrontmatterRow = Readonly<PropertyRow>;
export type FrontmatterBlock = Readonly<{
  from: number;
  to: number;
  rows: readonly FrontmatterRow[];
}>;

export function parseFrontmatter(document: string): FrontmatterBlock | null {
  if (!document.startsWith("---")) return null;
  const firstBreak = document.indexOf("\n");
  if (
    firstBreak < 0 ||
    document.slice(0, firstBreak).replace(/\r$/u, "").trim() !== "---"
  )
    return null;
  const bodyFrom = firstBreak + 1;
  let cursor = firstBreak + 1;
  while (cursor <= document.length) {
    const nextBreak = document.indexOf("\n", cursor);
    const rawTo = nextBreak < 0 ? document.length : nextBreak;
    const raw = document.slice(cursor, rawTo).replace(/\r$/u, "");
    if (raw.trim() === "---") {
      const rows = parseFrontmatterRows(document.slice(bodyFrom, cursor));
      return rows?.length
        ? Object.freeze({
            from: 0,
            to: rawTo,
            rows: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
          })
        : null;
    }
    if (nextBreak < 0) break;
    cursor = nextBreak + 1;
  }
  return null;
}

export type ParsedTable = Readonly<TableModel>;

type SourceOverride = Readonly<{
  kind: "table" | "frontmatter";
  from: number;
}>;

const editBlockSource = StateEffect.define<SourceOverride>();

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/u, "")
    .replace(/\|\s*$/u, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replace(/\\\|/gu, "|"));
}

export function parseTable(source: string): ParsedTable | null {
  const lines = source.split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length < 2 || !lines[0] || !lines[1]) return null;
  const header = splitRow(lines[0]);
  const delimiters = splitRow(lines[1]);
  if (
    !header.length ||
    delimiters.length !== header.length ||
    delimiters.some((value) => !/^:?-{3,}:?$/u.test(value))
  )
    return null;
  const aligns = delimiters.map((value) => {
    const left = value.startsWith(":");
    const right = value.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : "";
  });
  return Object.freeze({
    header: Object.freeze(header),
    aligns: Object.freeze(aligns),
    rows: Object.freeze(
      lines.slice(2).map((line) => Object.freeze(splitRow(line))),
    ),
  });
}

export function safeExternalUrl(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:https?:|mailto:|tel:)/iu.test(trimmed)) return "";
  try {
    const url = new URL(
      trimmed,
      globalThis.location?.href ?? "https://invalid.local/",
    );
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? trimmed
      : "";
  } catch {
    return "";
  }
}

function selectionIntersects(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.from >= from && range.from < to
      : range.from < to && range.to > from,
  );
}

function action(
  document: Document,
  label: string,
  run: () => void,
  disabled = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-edit-source";
  button.textContent = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    run();
  });
  return button;
}

function previewHeader(
  document: Document,
  label: string,
  actions: HTMLElement[],
): HTMLElement {
  const header = document.createElement("div");
  header.className = "cm-md-preview-header";
  const title = document.createElement("span");
  title.textContent = label;
  const group = document.createElement("span");
  group.className = "cm-md-preview-actions";
  group.append(...actions);
  header.append(title, group);
  return header;
}

function input(
  document: Document,
  value: string,
  label: string,
  onChange: (value: string) => void,
  readOnly: boolean,
  propertyKey = false,
  multiline = false,
): HTMLInputElement | HTMLTextAreaElement {
  const field = multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  if (field.tagName === "TEXTAREA") (field as HTMLTextAreaElement).rows = 1;
  else (field as HTMLInputElement).type = "text";
  field.className = "cm-aic-structure-input";
  field.value = value;
  field.readOnly = readOnly;
  field.setAttribute("aria-label", label);
  const fit = () => {
    if (field.tagName !== "TEXTAREA") return;
    field.style.height = "0";
    field.style.height = `${Math.max(30, field.scrollHeight)}px`;
  };
  field.addEventListener("input", fit);
  field.addEventListener("change", () => {
    if (propertyKey && !validPropertyKey(field.value.trim())) {
      field.setCustomValidity("Use letters, numbers, dot, underscore, or dash");
      field.reportValidity();
      return;
    }
    field.setCustomValidity("");
    onChange(field.value);
  });
  field.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter") {
      keyboardEvent.preventDefault();
      field.blur();
    } else if (keyboardEvent.key === "Escape") {
      keyboardEvent.preventDefault();
      field.value = value;
      field.blur();
    }
  });
  queueMicrotask(fit);
  return field;
}

function dragHandle(
  document: Document,
  label: string,
  kind: string,
  index: number,
  readOnly: boolean,
): HTMLButtonElement {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "cm-aic-drag-handle";
  handle.textContent = "⠿";
  handle.setAttribute("aria-label", label);
  handle.draggable = !readOnly;
  handle.disabled = readOnly;
  handle.addEventListener("pointerdown", (event) => event.stopPropagation());
  handle.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData(`application/x-aic-${kind}`, String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  return handle;
}

function dropTarget(
  element: HTMLElement,
  kind: string,
  index: number,
  onMove: (from: number, to: number) => void,
  readOnly: boolean,
): void {
  if (readOnly) return;
  element.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes(`application/x-aic-${kind}`))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  element.addEventListener("drop", (event) => {
    const from = Number(
      event.dataTransfer?.getData(`application/x-aic-${kind}`) ?? "",
    );
    if (!Number.isInteger(from)) return;
    event.preventDefault();
    onMove(from, index);
  });
}

class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return (
      other.source === this.source &&
      other.from === this.from &&
      other.readOnly === this.readOnly
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table aic-md-block-scroll cm-md-block-preview";
    wrapper.dataset.aicSourceFrom = String(this.from);
    wrapper.dataset.aicSourceTo = String(this.from + this.source.length);
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Interactive Markdown table");
    const parsed = parseTable(this.source);
    const replace = (model: TableModel) => {
      const markdown = serializeTable(model);
      if (!markdown || markdown === this.source) return;
      view.dispatch({
        changes: {
          from: this.from,
          to: this.from + this.source.length,
          insert: markdown,
        },
        userEvent: "input",
      });
    };
    const reveal = () => {
      view.dispatch({
        selection: { anchor: this.from },
        effects: editBlockSource.of({ kind: "table", from: this.from }),
        scrollIntoView: true,
      });
      view.focus();
    };
    if (!parsed) {
      const fallback = document.createElement("pre");
      fallback.textContent = this.source;
      wrapper.append(
        previewHeader(document, "Table", [action(document, "Edit", reveal)]),
        fallback,
      );
      return wrapper;
    }
    wrapper.append(
      previewHeader(document, "Table", [
        action(
          document,
          "Add row",
          () => replace(addTableRow(parsed)),
          this.readOnly,
        ),
        action(
          document,
          "Add column",
          () => replace(addTableColumn(parsed)),
          this.readOnly,
        ),
        action(document, this.readOnly ? "View source" : "Edit", reveal),
      ]),
    );
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const blank = document.createElement("th");
    blank.className = "cm-aic-structure-handle-cell";
    headRow.append(blank);
    parsed.header.forEach((value, columnIndex) => {
      const cell = document.createElement("th");
      const content = document.createElement("span");
      content.className = "cm-aic-structure-cell";
      content.append(
        dragHandle(
          document,
          `Move column ${value || columnIndex + 1}`,
          "column",
          columnIndex,
          this.readOnly,
        ),
        input(
          document,
          value,
          `Column ${columnIndex + 1} name`,
          (next) => replace(updateTableCell(parsed, -1, columnIndex, next)),
          this.readOnly,
          false,
          true,
        ),
      );
      cell.append(content);
      if (parsed.aligns[columnIndex])
        cell.style.textAlign = parsed.aligns[columnIndex]!;
      dropTarget(
        cell,
        "column",
        columnIndex,
        (from, to) => replace(moveTableColumn(parsed, from, to)),
        this.readOnly,
      );
      headRow.append(cell);
    });
    head.append(headRow);
    table.append(head);
    const body = document.createElement("tbody");
    parsed.rows.forEach((row, rowIndex) => {
      const rowElement = document.createElement("tr");
      const handleCell = document.createElement("td");
      handleCell.className = "cm-aic-structure-handle-cell";
      handleCell.append(
        dragHandle(
          document,
          `Move row ${rowIndex + 1}`,
          "row",
          rowIndex,
          this.readOnly,
        ),
      );
      rowElement.append(handleCell);
      parsed.header.forEach((_, columnIndex) => {
        const cell = document.createElement("td");
        cell.append(
          input(
            document,
            row[columnIndex] ?? "",
            `Row ${rowIndex + 1}, column ${columnIndex + 1}`,
            (next) =>
              replace(updateTableCell(parsed, rowIndex, columnIndex, next)),
            this.readOnly,
            false,
            true,
          ),
        );
        if (parsed.aligns[columnIndex])
          cell.style.textAlign = parsed.aligns[columnIndex]!;
        rowElement.append(cell);
      });
      dropTarget(
        rowElement,
        "row",
        rowIndex,
        (from, to) => replace(moveTableRow(parsed, from, to)),
        this.readOnly,
      );
      body.append(rowElement);
    });
    table.append(body);
    const scroll = document.createElement("div");
    scroll.className = "cm-aic-table-scroll";
    scroll.append(table);
    wrapper.append(scroll);
    return wrapper;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class FrontmatterWidget extends WidgetType {
  constructor(
    private readonly block: FrontmatterBlock,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  override eq(other: FrontmatterWidget): boolean {
    return (
      other.readOnly === this.readOnly &&
      JSON.stringify(other.block.rows) === JSON.stringify(this.block.rows)
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-props aic-md-block-scroll cm-md-block-preview";
    wrapper.dataset.aicSourceFrom = String(this.block.from);
    wrapper.dataset.aicSourceTo = String(this.block.to);
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Interactive Markdown properties");
    const replace = (rows: readonly PropertyRow[]) => {
      const markdown = serializeFrontmatter(rows);
      if (!markdown) return;
      view.dispatch({
        changes: { from: this.block.from, to: this.block.to, insert: markdown },
        userEvent: "input",
      });
    };
    const reveal = () => {
      const anchor = Math.min(view.state.doc.length, this.block.from + 4);
      view.dispatch({
        selection: { anchor },
        effects: editBlockSource.of({
          kind: "frontmatter",
          from: this.block.from,
        }),
        scrollIntoView: true,
      });
      view.focus();
    };
    wrapper.append(
      previewHeader(document, "Properties", [
        action(
          document,
          "Add property",
          () => replace(addProperty(this.block.rows)),
          this.readOnly,
        ),
        action(document, this.readOnly ? "View source" : "Edit", reveal),
      ]),
    );
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    this.block.rows.forEach((item, index) => {
      const row = document.createElement("tr");
      row.dataset.depth = String(item.depth ?? 0);
      row.dataset.sequence = String(Boolean(item.sequence));
      const handle = document.createElement("th");
      handle.className = "cm-aic-structure-handle-cell";
      handle.append(
        dragHandle(
          document,
          `Move property ${index + 1}`,
          "property",
          index,
          this.readOnly,
        ),
      );
      const key = document.createElement("th");
      key.className = "cm-aic-property-key-cell";
      const keyContent = document.createElement("div");
      keyContent.className = "cm-aic-property-key";
      keyContent.style.setProperty(
        "--aic-property-depth",
        String(Math.max(0, Math.min(12, item.depth ?? 0))),
      );
      const marker = document.createElement("span");
      marker.className = "cm-aic-property-level";
      marker.textContent = item.sequence ? "•" : item.depth ? "↳" : "";
      keyContent.append(marker);
      if (!item.scalar) {
        keyContent.append(
          input(
            document,
            item.key,
            `Property ${index + 1} name`,
            (next) =>
              replace(updateProperty(this.block.rows, index, "key", next)),
            this.readOnly,
            true,
          ),
        );
      } else {
        const itemLabel = document.createElement("span");
        itemLabel.className = "cm-aic-property-item";
        itemLabel.textContent = "item";
        keyContent.append(itemLabel);
      }
      key.append(keyContent);
      const value = document.createElement("td");
      const hasChildren =
        !item.value &&
        index + 1 < this.block.rows.length &&
        (this.block.rows[index + 1]?.indent ?? 0) > (item.indent ?? 0);
      if (hasChildren) {
        const group = document.createElement("span");
        group.className = "cm-aic-property-group";
        group.textContent = "Group";
        value.append(group);
      } else {
        value.append(
          input(
            document,
            item.value,
            `Property ${item.key || "list item"} value`,
            (next) =>
              replace(updateProperty(this.block.rows, index, "value", next)),
            this.readOnly,
          ),
        );
      }
      dropTarget(
        row,
        "property",
        index,
        (from, to) => replace(moveProperty(this.block.rows, from, to)),
        this.readOnly,
      );
      row.append(handle, key, value);
      body.append(row);
    });
    table.append(body);
    wrapper.append(table);
    return wrapper;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function tableNodes(state: EditorState): Array<{ from: number; to: number }> {
  const nodes: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Table") nodes.push({ from: node.from, to: node.to });
    },
  });
  return nodes;
}

function sourceRange(
  state: EditorState,
  override: SourceOverride,
): { from: number; to: number } | null {
  if (override.kind === "frontmatter") {
    const block = parseFrontmatter(state.doc.toString());
    return block?.from === override.from
      ? { from: block.from, to: block.to }
      : null;
  }
  return tableNodes(state).find(({ from }) => from === override.from) ?? null;
}

const sourceOverrideField = StateField.define<SourceOverride | null>({
  create: () => null,
  update(value, transaction) {
    let next = value
      ? {
          ...value,
          from: transaction.changes.mapPos(value.from),
        }
      : null;
    for (const effect of transaction.effects) {
      if (effect.is(editBlockSource)) next = effect.value;
    }
    if (!next) return null;
    const range = sourceRange(transaction.state, next);
    return range && selectionIntersects(transaction.state, range.from, range.to)
      ? next
      : null;
  },
});

function tableDecorations(state: EditorState) {
  const source = state.field(sourceOverrideField);
  const replacements = [];
  for (const node of tableNodes(state)) {
    if (source?.kind === "table" && source.from === node.from) continue;
    if (selectionRevealsPreview(state.selection.ranges, node.from, node.to))
      continue;
    const markdown = state.sliceDoc(node.from, node.to);
    if (!markdown.trim() || !parseTable(markdown)) continue;
    replacements.push(
      Decoration.replace({
        widget: new TableWidget(markdown, node.from, state.readOnly),
        block: true,
      }).range(node.from, node.to),
    );
  }
  return Decoration.set(replacements, true);
}

function frontmatterDecorations(state: EditorState) {
  const block = parseFrontmatter(state.doc.toString());
  const source = state.field(sourceOverrideField);
  if (
    !block ||
    (source?.kind === "frontmatter" && source.from === block.from) ||
    selectionRevealsPreview(state.selection.ranges, block.from, block.to)
  )
    return Decoration.none;
  return Decoration.set(
    [
      Decoration.replace({
        widget: new FrontmatterWidget(block, state.readOnly),
        block: true,
      }).range(block.from, block.to),
    ],
    true,
  );
}

const refreshBlockViews = StateEffect.define<void>();

const tableField = StateField.define({
  create: tableDecorations,
  update(value, transaction) {
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      transaction.startState.readOnly === transaction.state.readOnly &&
      !transaction.effects.some((effect) => effect.is(refreshBlockViews))
    )
      return value;
    return tableDecorations(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const frontmatterField = StateField.define({
  create: frontmatterDecorations,
  update(value, transaction) {
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      transaction.startState.readOnly === transaction.state.readOnly
    )
      return value;
    return frontmatterDecorations(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const viewportRefresh = ViewPlugin.fromClass(
  class {
    private scheduled = false;
    private destroyed = false;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (
        !update.viewportChanged ||
        update.docChanged ||
        update.selectionSet ||
        this.scheduled
      )
        return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        if (!this.destroyed)
          this.view.dispatch({ effects: refreshBlockViews.of() });
      });
    }

    destroy() {
      this.destroyed = true;
    }
  },
);

export function blockViewExtensions(): Extension {
  return [sourceOverrideField, tableField, frontmatterField, viewportRefresh];
}
