import { EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { createIconButton } from "./structured-preview.js";
import { applyUiComponent, createUiButton } from "./ui-system.js";

/** Shared presentation only. The host keeps source edits, navigation and copying. */
export function createDetailsSummary(
  document,
  { block, open, readOnly, onToggle, onCheck, onOpen },
) {
  const row = applyUiComponent(
    document.createElement("div"),
    "card",
    ["details"],
    "header",
  );
  row.classList.add("cm-aic-details-summary");
  row.dataset.aicSourceFrom = String(block.from);
  row.dataset.aicSourceTo = String(block.end);
  row.dataset.open = String(open);
  row.dataset.body = String(block.contentFrom < block.closeFrom);

  const heading = applyUiComponent(
    document.createElement("div"),
    "card",
    ["details"],
    "section",
  );
  const disclosure = createIconButton(document, {
    label: open ? "Collapse details" : "Expand details",
    icon: "chevron",
    className: "cm-aic-details-disclosure",
    onActivate: onToggle,
  });
  disclosure.setAttribute("aria-expanded", String(open));
  heading.append(disclosure);

  const data = block.summary;
  if (data.checked !== null) {
    const checkbox = createUiButton(document, {
      label: data.checked
        ? "Mark linked item incomplete"
        : "Mark linked item complete",
      variant: "ghost",
      size: "compact",
      iconOnly: true,
    });
    checkbox.classList.add("cm-aic-details-check");
    checkbox.classList.toggle("checked", data.checked);
    checkbox.setAttribute("role", "checkbox");
    checkbox.setAttribute("aria-checked", String(data.checked));
    checkbox.disabled = readOnly;
    checkbox.addEventListener("pointerdown", (event) => event.preventDefault());
    checkbox.addEventListener("click", onCheck);
    heading.append(checkbox);
  }
  const title = createUiButton(document, {
    label: `${open ? "Collapse" : "Expand"} ${data.label}`,
    text: data.label,
    variant: "ghost",
    size: "compact",
  });
  applyUiComponent(title, "card", ["details"], "title");
  title.classList.add("cm-aic-details-title");
  title.setAttribute("aria-expanded", String(open));
  title.addEventListener("pointerdown", (event) => event.preventDefault());
  title.addEventListener("click", onToggle);
  heading.append(title);

  const actions = applyUiComponent(
    document.createElement("div"),
    "card",
    ["details"],
    "actions",
  );
  if (data.href)
    actions.append(
      createIconButton(document, {
        label: `Open linked source: ${data.label}`,
        icon: "open",
        className: "cm-aic-details-link",
        onActivate: onOpen,
      }),
    );
  row.append(heading, actions);
  return { row, actions };
}

/** The closing marker owns the parent boundary even when the last child is a widget. */
export class DetailsEndWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view) {
    const end = applyUiComponent(
      view.dom.ownerDocument.createElement("div"),
      "card",
      ["details"],
      "footer",
    );
    end.setAttribute("aria-hidden", "true");
    return end;
  }
}

/**
 * A block replacement is a sibling of CM lines, so line decorations cannot
 * carry its parent styling. Classify the rendered widget roots after CM draws
 * them; never reparent its DOM or create a second editor for the body.
 */
export function detailsBodyLayout(openBlocks) {
  const embedded = "aic-card__body--embedded";
  const sync = (view) => {
    const blocks = openBlocks(view.state);
    let changed = false;
    for (const element of view.contentDOM.children) {
      if (
        element.classList.contains("cm-line") ||
        element.classList.contains("cm-gap")
      )
        continue;
      let position;
      try {
        position = view.posAtDOM(element);
      } catch {
        continue;
      }
      const inside = blocks.some(
        (block) => position >= block.contentFrom && position < block.closeFrom,
      );
      if (element.classList.contains(embedded) === inside) continue;
      element.classList.toggle(embedded, inside);
      changed = true;
    }
    if (changed) view.requestMeasure();
  };
  return [
    ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.view = view;
          this.active = true;
          view.requestMeasure({
            read: () => null,
            write: () => {
              if (this.active) sync(view);
            },
          });
        }
        destroy() {
          this.active = false;
          for (const element of this.view.contentDOM.children)
            element.classList.remove(embedded);
        }
      },
    ),
    EditorView.updateListener.of((update) => sync(update.view)),
  ];
}
