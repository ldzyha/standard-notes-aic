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
  WidgetType,
} from "@codemirror/view";

export type FrontmatterRow = Readonly<{ key: string; value: string }>;
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
  const rows: FrontmatterRow[] = [];
  const keys = new Set<string>();
  let cursor = firstBreak + 1;
  while (cursor <= document.length) {
    const nextBreak = document.indexOf("\n", cursor);
    const rawTo = nextBreak < 0 ? document.length : nextBreak;
    const raw = document.slice(cursor, rawTo).replace(/\r$/u, "");
    if (raw.trim() === "---") {
      if (rows.length === 0) return null;
      return Object.freeze({ from: 0, to: rawTo, rows: Object.freeze(rows) });
    }
    if (raw.trim()) {
      if (/^[ \t]/u.test(raw)) return null;
      const match = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/u.exec(raw);
      if (!match?.[1] || keys.has(match[1])) return null;
      keys.add(match[1]);
      rows.push(Object.freeze({ key: match[1], value: match[2] ?? "" }));
    }
    if (nextBreak < 0) break;
    cursor = nextBreak + 1;
  }
  return null;
}

export type ParsedTable = Readonly<{
  header: readonly string[];
  aligns: readonly ("left" | "center" | "right" | "")[];
  rows: readonly (readonly string[])[];
}>;

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
    header.length === 0 ||
    delimiters.length !== header.length ||
    delimiters.some((delimiter) => !/^:?-{3,}:?$/u.test(delimiter))
  ) {
    return null;
  }
  const aligns = delimiters.map((delimiter) => {
    const left = delimiter.startsWith(":");
    const right = delimiter.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : "";
  });
  const rows = lines.slice(2).map((line) => splitRow(line));
  return Object.freeze({
    header: Object.freeze(header),
    aligns: Object.freeze(aligns),
    rows: Object.freeze(rows),
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

const CELL_INLINE =
  /(`([^`]+)`)|(\[([^\]]*)\]\(([^)]+)\))|(\*\*([^*]+)\*)|(__([^_]+)__)|(~~([^~]+)~~)|(\*([^*]+)\*)|(_([^_]+)_)/gu;

function fillInline(parent: HTMLElement, source: string) {
  const pattern = new RegExp(CELL_INLINE.source, "gu");
  let last = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match.index > last)
      parent.append(document.createTextNode(source.slice(last, match.index)));
    if (match[2] !== undefined) {
      const code = document.createElement("code");
      code.className = "cm-md-code";
      code.textContent = match[2];
      parent.append(code);
    } else if (match[5] !== undefined) {
      const url = safeExternalUrl(match[5]);
      if (url) {
        const anchor = document.createElement("a");
        anchor.className = "cm-md-table-link";
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.title = match[5];
        fillInline(anchor, match[4] || match[5]);
        parent.append(anchor);
      } else {
        const text = document.createElement("span");
        text.className = "cm-md-table-link cm-md-table-link-local";
        text.title = match[5];
        fillInline(text, match[4] || match[5]);
        parent.append(text);
      }
    } else if (match[7] !== undefined || match[9] !== undefined) {
      const strong = document.createElement("strong");
      fillInline(strong, match[7] ?? match[9] ?? "");
      parent.append(strong);
    } else if (match[11] !== undefined) {
      const deleted = document.createElement("del");
      fillInline(deleted, match[11]);
      parent.append(deleted);
    } else {
      const emphasis = document.createElement("em");
      fillInline(emphasis, match[13] ?? match[15] ?? "");
      parent.append(emphasis);
    }
    last = match.index + match[0].length;
  }
  if (last < source.length)
    parent.append(document.createTextNode(source.slice(last)));
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

function previewHeader(
  document: Document,
  label: string,
  onEdit: () => void,
  readOnly: boolean,
) {
  const header = document.createElement("div");
  header.className = "cm-md-preview-header";
  const title = document.createElement("span");
  title.textContent = label;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "cm-md-edit-source";
  edit.textContent = "Edit source";
  edit.title = readOnly ? "View source (read-only)" : "Edit source";
  edit.addEventListener("pointerdown", (event) => event.preventDefault());
  edit.addEventListener("click", (event) => {
    event.stopPropagation();
    onEdit();
  });
  header.append(title, edit);
  return header;
}

class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.from === this.from;
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table aic-md-block-scroll cm-md-block-preview";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Markdown table preview");
    wrapper.append(
      previewHeader(
        document,
        "Table",
        () => {
          view.dispatch({
            selection: { anchor: this.from },
            scrollIntoView: true,
          });
          view.focus();
        },
        view.state.readOnly,
      ),
    );
    const parsed = parseTable(this.source);
    if (!parsed) {
      wrapper.textContent = this.source;
      return wrapper;
    }
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    parsed.header.forEach((cell, index) => {
      const element = document.createElement("th");
      fillInline(element, cell);
      if (parsed.aligns[index]) element.style.textAlign = parsed.aligns[index]!;
      headRow.append(element);
    });
    head.append(headRow);
    table.append(head);
    const body = document.createElement("tbody");
    for (const row of parsed.rows) {
      const rowElement = document.createElement("tr");
      parsed.header.forEach((_, index) => {
        const element = document.createElement("td");
        fillInline(element, row[index] ?? "");
        if (parsed.aligns[index])
          element.style.textAlign = parsed.aligns[index]!;
        rowElement.append(element);
      });
      body.append(rowElement);
    }
    table.append(body);
    wrapper.append(table);

    return wrapper;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class FrontmatterWidget extends WidgetType {
  constructor(private readonly block: FrontmatterBlock) {
    super();
  }

  override eq(other: FrontmatterWidget): boolean {
    return JSON.stringify(other.block.rows) === JSON.stringify(this.block.rows);
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-props aic-md-block-scroll cm-md-block-preview";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Markdown properties preview");
    wrapper.append(
      previewHeader(
        document,
        "Properties",
        () => {
          const anchor = Math.min(view.state.doc.length, this.block.from + 4);
          view.dispatch({ selection: { anchor }, scrollIntoView: true });
          view.focus();
        },
        view.state.readOnly,
      ),
    );
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    for (const row of this.block.rows) {
      const element = document.createElement("tr");
      const key = document.createElement("th");
      const value = document.createElement("td");
      key.textContent = row.key;
      value.textContent = row.value;
      element.append(key, value);
      body.append(element);
    }
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

const refreshBlockViews = StateEffect.define<void>();

function tableDecorations(state: EditorState) {
  const replacements = [];
  for (const node of tableNodes(state)) {
    if (selectionIntersects(state, node.from, node.to)) continue;
    const source = state.sliceDoc(node.from, node.to);
    if (!source.trim() || !parseTable(source)) continue;
    replacements.push(
      Decoration.replace({
        widget: new TableWidget(source, node.from),
        block: true,
      }).range(node.from, node.to),
    );
  }
  return Decoration.set(replacements, true);
}

function frontmatterDecorations(state: EditorState) {
  const block = parseFrontmatter(state.doc.toString());
  if (!block || selectionIntersects(state, block.from, block.to))
    return Decoration.none;
  return Decoration.set(
    [
      Decoration.replace({
        widget: new FrontmatterWidget(block),
        block: true,
      }).range(block.from, block.to),
    ],
    true,
  );
}

const tableField = StateField.define({
  create: tableDecorations,
  update(value, transaction) {
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      !transaction.effects.some((effect) => effect.is(refreshBlockViews))
    ) {
      return value;
    }
    return tableDecorations(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const frontmatterField = StateField.define({
  create: frontmatterDecorations,
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value;
    return frontmatterDecorations(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const viewportRefresh = ViewPlugin.fromClass(
  class {
    update(update: {
      viewportChanged: boolean;
      docChanged: boolean;
      selectionSet: boolean;
      view: EditorView;
    }) {
      if (
        update.viewportChanged &&
        !update.docChanged &&
        !update.selectionSet
      ) {
        update.view.dispatch({ effects: refreshBlockViews.of() });
      }
    }
  },
);

export function blockViewExtensions(): Extension {
  return [tableField, frontmatterField, viewportRefresh];
}
