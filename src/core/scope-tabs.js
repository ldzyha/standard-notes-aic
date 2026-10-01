import { applyUiComponent, createUiButton } from "./ui-system.js";

let sequence = 0;

/** Presentation-only scope navigation. The host owns save barriers and content. */
export function createScopeTabs(document, options) {
  const { items, label, onSelect, onSelected } = options;
  if (
    !items?.length ||
    new Set(items.map((item) => item.id)).size !== items.length ||
    items.some((item) => !item.id || !item.panel || !item.label)
  )
    throw new TypeError("Scope tabs require unique named panels.");
  let selected = options.selected ?? items[0].id;
  if (!items.some((item) => item.id === selected))
    throw new TypeError("Unknown initial scope.");
  const prefix = `aic-scope-${++sequence}`;
  const element = applyUiComponent(document.createElement("nav"), "context", [
    "tabs",
  ]);
  element.setAttribute("role", "tablist");
  element.setAttribute("aria-label", label);
  let disposed = false;
  let pending = false;
  const cleanups = [];
  const buttons = items.map((item, index) => {
    const button = createUiButton(document, {
      label: item.label,
      variant: "ghost",
      size: "touch",
    });
    applyUiComponent(button, "context", [], "tab");
    button.id = `${prefix}-tab-${index}`;
    button.setAttribute("role", "tab");
    if (item.disabled) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }
    if (item.title) button.title = item.title;
    item.panel.id ||= `${prefix}-panel-${index}`;
    item.panel.setAttribute("role", "tabpanel");
    item.panel.setAttribute("aria-labelledby", button.id);
    applyUiComponent(item.panel, "context", [], "panel");
    button.setAttribute("aria-controls", item.panel.id);
    const blockHiddenIntent = (event) => {
      if (!item.panel.hidden) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    item.panel.addEventListener("click", blockHiddenIntent, true);
    const click = () => {
      void activate(item.id);
    };
    const keydown = (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % items.length;
      else if (event.key === "ArrowLeft")
        next = (index + items.length - 1) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void activate(item.id);
        return;
      } else return;
      event.preventDefault();
      const direction =
        event.key === "ArrowLeft" || event.key === "End" ? -1 : 1;
      for (let count = 0; items[next].disabled && count < items.length; count++)
        next = (next + items.length + direction) % items.length;
      if (!items[next].disabled) buttons[next].focus();
    };
    button.addEventListener("click", click);
    button.addEventListener("keydown", keydown);
    cleanups.push(() => {
      item.panel.removeEventListener("click", blockHiddenIntent, true);
      button.removeEventListener("click", click);
      button.removeEventListener("keydown", keydown);
    });
    element.append(button);
    return button;
  });
  function reflect() {
    items.forEach((item, index) => {
      const active = item.id === selected;
      buttons[index].setAttribute("aria-selected", String(active));
      buttons[index].tabIndex = active ? 0 : -1;
      item.panel.hidden = !active;
      item.panel.inert = !active;
    });
  }
  async function activate(id) {
    if (
      disposed ||
      pending ||
      !items.some((item) => item.id === id && !item.disabled)
    )
      return false;
    if (id === selected) return true;
    pending = true;
    element.setAttribute("aria-busy", "true");
    try {
      if (onSelect && !(await onSelect(id, selected))) return false;
      if (disposed) return false;
      selected = id;
      reflect();
      onSelected?.(id);
      return true;
    } catch {
      return false;
    } finally {
      pending = false;
      if (!disposed) element.removeAttribute("aria-busy");
    }
  }
  reflect();
  return Object.freeze({
    element,
    activate,
    get selected() {
      return selected;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    },
  });
}
