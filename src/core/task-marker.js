import { WidgetType } from "@codemirror/view";

/** All task controls use this edit boundary, including command invocation. */
export function toggleTaskMarker(view, from) {
  if (
    view.state.readOnly ||
    !Number.isInteger(from) ||
    from < 0 ||
    from + 3 > view.state.doc.length
  )
    return false;
  const marker = /^\[([ xX])\]$/u.exec(view.state.sliceDoc(from, from + 3));
  if (!marker) return false;
  view.dispatch({
    changes: {
      from: from + 1,
      to: from + 2,
      insert: marker[1] === " " ? "x" : " ",
    },
    userEvent: "input",
  });
  return true;
}

export class TaskMarkerWidget extends WidgetType {
  constructor(from, checked, readOnly) {
    super();
    Object.assign(this, { from, checked, readOnly });
  }
  eq(other) {
    return (
      other.from === this.from &&
      other.checked === this.checked &&
      other.readOnly === this.readOnly
    );
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view) {
    const document = view.dom.ownerDocument;
    const element = document.createElement("span");
    element.className = `cm-md-task${this.checked ? " checked" : ""}`;
    element.setAttribute("role", "checkbox");
    element.setAttribute("aria-checked", String(this.checked));
    element.setAttribute("aria-disabled", String(this.readOnly));
    element.setAttribute(
      "aria-label",
      this.checked ? "Mark task incomplete" : "Mark task complete",
    );
    element.tabIndex = this.readOnly ? -1 : 0;
    const box = element.appendChild(document.createElement("span"));
    box.className = "cm-md-task-box";
    const toggle = () => {
      if (!view.dom.contains(element)) return;
      toggleTaskMarker(view, this.from);
    };
    element.addEventListener("pointerdown", (event) => event.preventDefault());
    element.addEventListener("click", toggle);
    element.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });
    return element;
  }
}
