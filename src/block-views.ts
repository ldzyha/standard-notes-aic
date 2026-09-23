import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
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
  addTableColumn,
  addTableRow,
  createCellEditor,
  createIconButton,
  moveTableColumn,
  moveTableRow,
  parseFrontmatterRows,
  selectionRevealsPreview,
  showIconFeedback,
  serializeTable,
  updateTableCell,
  writeTextToClipboard,
  type PropertyRow,
  type TableModel,
} from "./core/structured-preview.js";
import { providePreviewRanges } from "./core/preview-ranges.js";
import {
  sourcePreviewExit,
  sourcePreviewExitHandlers,
} from "./core/source-mode.js";
import { makePropertiesBlockExtension } from "./core/security-block.js";

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
  kind: "table";
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
  icon: string,
  run: (button: HTMLButtonElement) => void | Promise<void>,
  disabled = false,
): HTMLButtonElement {
  return createIconButton(document, {
    label,
    icon,
    className: "cm-md-edit-source",
    disabled,
    onActivate: run,
  });
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

function dragHandle(
  document: Document,
  label: string,
  kind: string,
  index: number,
  readOnly: boolean,
): HTMLButtonElement {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "cm-aic-drag-handle cm-aic-icon-button";
  handle.dataset.aicIcon = "drag";
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
    const type = `application/x-aic-${kind}`;
    if (!event.dataTransfer?.types.includes(type)) return;
    const value = event.dataTransfer.getData(type);
    if (!/^\d+$/u.test(value)) return;
    const from = Number(value);
    if (!Number.isSafeInteger(from)) return;
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
    const isCurrent = () =>
      wrapper.isConnected &&
      this.from >= 0 &&
      this.from + this.source.length <= view.state.doc.length &&
      view.state.sliceDoc(this.from, this.from + this.source.length) ===
        this.source;
    const replace = (model: TableModel) => {
      if (view.state.readOnly || !isCurrent()) return;
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
      if (!isCurrent()) return;
      view.dispatch({
        selection: { anchor: this.from },
        effects: editBlockSource.of({ kind: "table", from: this.from }),
        scrollIntoView: true,
      });
      view.focus();
    };
    const copy = async (button: HTMLButtonElement) => {
      if (!isCurrent()) return;
      if (!(await writeTextToClipboard(this.source, document))) return;
      showIconFeedback(button, { restoreLabel: "Copy table" });
    };
    const cut = async () => {
      if (this.readOnly || view.state.readOnly || !isCurrent()) return;
      if (!(await writeTextToClipboard(this.source, document))) return;
      if (view.state.readOnly || !isCurrent()) return;
      view.dispatch({
        changes: { from: this.from, to: this.from + this.source.length },
        userEvent: "input.cut",
      });
      view.focus();
    };
    if (!parsed) {
      const fallback = document.createElement("pre");
      fallback.textContent = this.source;
      wrapper.append(
        previewHeader(document, "Table", [
          action(document, "Copy table", "copy", copy),
          action(document, "Edit table source", "edit", reveal),
          ...(!this.readOnly
            ? [action(document, "Cut table", "cut", cut)]
            : []),
        ]),
        fallback,
      );
      return wrapper;
    }
    wrapper.append(
      previewHeader(document, "Table", [
        action(
          document,
          "Add row",
          "add-row",
          () => replace(addTableRow(parsed)),
          this.readOnly,
        ),
        action(
          document,
          "Add column",
          "add-column",
          () => replace(addTableColumn(parsed)),
          this.readOnly,
        ),
        action(document, "Copy table", "copy", copy),
        action(
          document,
          this.readOnly ? "View table source" : "Edit table source",
          this.readOnly ? "source" : "edit",
          reveal,
        ),
        ...(!this.readOnly ? [action(document, "Cut table", "cut", cut)] : []),
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
        createCellEditor(document, {
          value,
          label: `Column ${columnIndex + 1} name`,
          multiline: true,
          readOnly: this.readOnly,
          getRevision: () => view.state.doc,
          onCommit: (next) =>
            replace(updateTableCell(parsed, -1, columnIndex, next)),
        }),
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
          createCellEditor(document, {
            value: row[columnIndex] ?? "",
            label: `Row ${rowIndex + 1}, column ${columnIndex + 1}`,
            multiline: true,
            readOnly: this.readOnly,
            getRevision: () => view.state.doc,
            onCommit: (next) =>
              replace(updateTableCell(parsed, rowIndex, columnIndex, next)),
          }),
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

function tableNodes(state: EditorState): Array<{ from: number; to: number }> {
  const nodes: Array<{ from: number; to: number }> = [];
  const tree =
    ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
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
      if (effect.is(sourcePreviewExit)) next = null;
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

const refreshBlockViews = StateEffect.define<void>();

const tableField = StateField.define({
  create: tableDecorations,
  update(value, transaction) {
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      transaction.startState.readOnly === transaction.state.readOnly &&
      !transaction.effects.some(
        (effect) =>
          effect.is(refreshBlockViews) || effect.is(sourcePreviewExit),
      )
    )
      return value;
    return tableDecorations(transaction.state);
  },
  provide: providePreviewRanges,
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

export function blockViewExtensions(
  document: Document = globalThis.document,
): Extension {
  return [
    sourceOverrideField,
    sourcePreviewExitHandlers.of((state) => {
      const source = state.field(sourceOverrideField);
      return source ? sourceRange(state, source) : null;
    }),
    tableField,
    makePropertiesBlockExtension({ document }),
    viewportRefresh,
  ];
}
