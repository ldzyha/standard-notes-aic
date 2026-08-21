import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import {
  parseDetailsBlocks,
  toggleDetailsMarker,
  type DetailsBlock,
} from "./details-model";
import { safeExternalUrl } from "./block-views";

const toggleVisual = StateEffect.define<number>();
const editSource = StateEffect.define<number>({
  map: (value, mapping) => mapping.mapPos(value),
});

const visualOverrides = StateField.define<ReadonlySet<number>>({
  create: () => new Set(),
  update(value, transaction) {
    if (transaction.docChanged) return new Set();
    let next = value;
    for (const effect of transaction.effects) {
      if (!effect.is(toggleVisual)) continue;
      const copy = new Set(next);
      if (copy.has(effect.value)) copy.delete(effect.value);
      else copy.add(effect.value);
      next = copy;
    }
    return next;
  },
});

const sourceOverrides = StateField.define<ReadonlySet<number>>({
  create: () => new Set(),
  update(value, transaction) {
    let next: ReadonlySet<number> = transaction.docChanged
      ? new Set(
          [...value].map((position) => transaction.changes.mapPos(position)),
        )
      : value;
    for (const effect of transaction.effects) {
      if (!effect.is(editSource)) continue;
      const copy = new Set(next);
      copy.add(effect.value);
      next = copy;
    }
    if (transaction.selection && next.size) {
      const blocks = parseDetailsBlocks(transaction.state.doc.toString());
      next = new Set(
        [...next].filter((position) => {
          const block = blocks.find(
            ({ headerFrom }) => headerFrom === position,
          );
          return Boolean(
            block &&
            transaction.state.selection.ranges.some((range) =>
              range.empty
                ? range.from > block.from && range.from < block.end
                : range.from < block.end && range.to > block.from,
            ),
          );
        }),
      );
    }
    return next;
  },
});

function svgIcon(document: Document, path: string, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  shape.setAttribute("fill", "none");
  shape.setAttribute("stroke", "currentColor");
  shape.setAttribute("stroke-width", "1.7");
  shape.setAttribute("stroke-linecap", "round");
  shape.setAttribute("stroke-linejoin", "round");
  svg.append(shape);
  return svg;
}

class DetailsSummaryWidget extends WidgetType {
  constructor(
    private readonly block: DetailsBlock,
    private readonly open: boolean,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  override eq(other: DetailsSummaryWidget): boolean {
    return (
      other.block.headerFrom === this.block.headerFrom &&
      other.block.title === this.block.title &&
      other.open === this.open &&
      other.readOnly === this.readOnly
    );
  }

  override ignoreEvent(): boolean {
    return false;
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const row = document.createElement("div");
    row.className = "cm-aic-details-summary";
    row.dataset.open = String(this.open);
    row.dataset.body = String(this.block.contentFrom < this.block.closeFrom);
    const toggle = () => {
      if (view.state.readOnly) {
        view.dispatch({ effects: toggleVisual.of(this.block.headerFrom) });
        return;
      }
      const line = view.state.doc.lineAt(this.block.headerFrom);
      const replacement = toggleDetailsMarker(line.text);
      if (!replacement) return;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: replacement },
        userEvent: "input",
      });
    };

    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "cm-aic-details-disclosure";
    disclosure.setAttribute(
      "aria-label",
      this.open ? "Collapse details" : "Expand details",
    );
    disclosure.setAttribute("aria-expanded", String(this.open));
    disclosure.append(
      svgIcon(document, "M5.5 3.5 10 8l-4.5 4.5", "cm-aic-details-chevron"),
    );
    disclosure.addEventListener("pointerdown", (event) =>
      event.preventDefault(),
    );
    disclosure.addEventListener("click", toggle);
    row.append(disclosure);

    const data = this.block.summary;
    if (data.checked !== null) {
      const checkbox = document.createElement("button");
      checkbox.type = "button";
      checkbox.className = `cm-aic-details-check${data.checked ? " checked" : ""}`;
      checkbox.setAttribute("role", "checkbox");
      checkbox.setAttribute("aria-checked", String(data.checked));
      checkbox.setAttribute(
        "aria-label",
        data.checked
          ? "Mark linked item incomplete"
          : "Mark linked item complete",
      );
      checkbox.disabled = view.state.readOnly;
      checkbox.addEventListener("pointerdown", (event) =>
        event.preventDefault(),
      );
      checkbox.addEventListener("click", () => {
        if (view.state.readOnly || data.taskOffset < 0) return;
        const from = this.block.titleFrom + data.taskOffset;
        view.dispatch({
          changes: { from, to: from + 1, insert: data.checked ? " " : "x" },
          userEvent: "input",
        });
      });
      row.append(checkbox);
    }

    const title = document.createElement("button");
    title.type = "button";
    title.className = "cm-aic-details-title";
    title.textContent = data.label;
    title.setAttribute(
      "aria-label",
      `${this.open ? "Collapse" : "Expand"} ${data.label}`,
    );
    title.addEventListener("pointerdown", (event) => event.preventDefault());
    title.addEventListener("click", toggle);
    row.append(title);

    if (data.href) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "cm-aic-details-link";
      link.title = data.href;
      link.setAttribute("aria-label", `Open linked source: ${data.label}`);
      link.append(
        svgIcon(
          document,
          "M6.5 3.5H3.75a.75.75 0 0 0-.75.75v8a.75.75 0 0 0 .75.75h8a.75.75 0 0 0 .75-.75V9.5M9 3h4v4M13 3 7.25 8.75",
        ),
      );
      link.addEventListener("pointerdown", (event) => event.preventDefault());
      link.addEventListener("click", () => {
        const external = safeExternalUrl(data.href);
        if (external)
          document.defaultView?.open(external, "_blank", "noopener,noreferrer");
        else
          view.dom.dispatchEvent(
            new document.defaultView!.CustomEvent("aic-link-open", {
              detail: { href: data.href },
              bubbles: true,
            }),
          );
      });
      row.append(link);
    }

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-md-edit-source cm-aic-details-edit";
    edit.textContent = "Edit source";
    edit.title = view.state.readOnly
      ? "View source (read-only)"
      : "Edit source";
    edit.addEventListener("pointerdown", (event) => event.preventDefault());
    edit.addEventListener("click", () => {
      const anchor = Math.min(this.block.headerTo, this.block.headerFrom + 4);
      view.dispatch({
        selection: { anchor },
        effects: editSource.of(this.block.headerFrom),
        scrollIntoView: true,
      });
      view.focus();
    });
    row.append(edit);
    return row;
  }
}

function previewDecorations(state: EditorState) {
  const overrides = state.field(visualOverrides);
  const source = state.field(sourceOverrides);
  const ranges: Range<Decoration>[] = [];
  for (const block of parseDetailsBlocks(state.doc.toString())) {
    if (source.has(block.headerFrom)) continue;
    const open = overrides.has(block.headerFrom) ? !block.open : block.open;
    const widget = new DetailsSummaryWidget(block, open, state.readOnly);
    if (!open) {
      ranges.push(
        Decoration.replace({ block: true, widget }).range(
          block.from,
          block.end,
        ),
      );
      continue;
    }
    ranges.push(
      Decoration.replace({ block: true, widget }).range(
        block.headerFrom,
        block.headerTo,
      ),
    );
    ranges.push(
      Decoration.replace({ block: true }).range(block.closeFrom, block.closeTo),
    );
  }
  return Decoration.set(ranges, true);
}

const detailsField = StateField.define({
  create: previewDecorations,
  update(value, transaction) {
    return transaction.docChanged ||
      transaction.selection ||
      transaction.effects.length
      ? previewDecorations(transaction.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function bodyDecorations(state: EditorState) {
  const overrides = state.field(visualOverrides);
  const source = state.field(sourceOverrides);
  const ranges: Range<Decoration>[] = [];
  for (const block of parseDetailsBlocks(state.doc.toString())) {
    if (source.has(block.headerFrom)) continue;
    const open = overrides.has(block.headerFrom) ? !block.open : block.open;
    if (!open) continue;
    const first = state.doc.lineAt(block.contentFrom).number;
    const bodyLines = [];
    for (let number = first; number <= state.doc.lines; number++) {
      const line = state.doc.line(number);
      if (line.from >= block.closeFrom) break;
      bodyLines.push(line);
    }
    bodyLines.forEach((line, index) => {
      const classes = ["cm-aic-details-body"];
      if (index === 0) classes.push("cm-aic-details-body-first");
      if (index === bodyLines.length - 1)
        classes.push("cm-aic-details-body-last");
      ranges.push(
        Decoration.line({ attributes: { class: classes.join(" ") } }).range(
          line.from,
        ),
      );
    });
  }
  return Decoration.set(ranges, true);
}

const detailsBodyField = StateField.define({
  create: bodyDecorations,
  update(value, transaction) {
    return transaction.docChanged ||
      transaction.selection ||
      transaction.effects.length
      ? bodyDecorations(transaction.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const inertPreviewClicks = EditorView.domEventHandlers({
  mousedown(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".cm-aic-details-body")) return false;
    if (target.closest("button, a, input, [role='checkbox']")) return false;
    event.preventDefault();
    return true;
  },
});

export function detailsExtensions(): Extension {
  return [
    visualOverrides,
    sourceOverrides,
    detailsBodyField,
    detailsField,
    inertPreviewClicks,
  ];
}
