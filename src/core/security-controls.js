import { createIconButton } from "./structured-preview.js";

/** A small disclosure, not a second editor. Global listeners live only while open. */
export function createSecurityAddMenu(document, label, entries) {
  const element = document.createElement("div");
  element.className = "cm-aic-security-add";
  const menu = document.createElement("div");
  menu.className = "cm-aic-security-add-menu";
  menu.hidden = true;
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", label);
  let disposed = false;
  const close = (focus = false) => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", escape, true);
    if (focus && trigger.isConnected) trigger.focus();
  };
  const outside = (event) => {
    if (!element.contains(event.target)) close();
  };
  const escape = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  const trigger = createIconButton(document, {
    label,
    icon: "add",
    className: "cm-aic-security-action cm-aic-security-add-trigger",
    onActivate() {
      if (disposed || !element.isConnected) return;
      if (!menu.hidden) return close();
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", escape, true);
      menu.querySelector("button:not(:disabled)")?.focus();
    },
  });
  trigger.setAttribute("aria-expanded", "false");
  for (const entry of entries) {
    const control = createIconButton(document, {
      label: entry.label,
      icon: entry.icon || "add-property",
      disabled: Boolean(entry.disabled),
      className: "cm-aic-security-action",
      onActivate() {
        if (disposed || !element.isConnected) return;
        close(true);
        entry.run();
      },
    });
    control.append(document.createTextNode(entry.text || entry.label));
    menu.append(control);
  }
  element.append(trigger, menu);
  return {
    element,
    dispose() {
      disposed = true;
      close();
    },
  };
}

/** Filter only names and deliberately visible values; never index secrets or OTPs. */
export function createSecurityFilter(
  document,
  { title, groups, initialQuery = "", onChange },
) {
  const element = document.createElement("div");
  element.className = "cm-aic-security-filter";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Filter fields and groups";
  input.setAttribute("aria-label", "Filter fields and groups");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = initialQuery;
  const empty = document.createElement("p");
  empty.className = "cm-aic-security-filter-empty";
  empty.setAttribute("role", "status");
  empty.textContent = "No matching fields or groups";
  const normalize = (value) =>
    String(value || "")
      .trim()
      .toLocaleLowerCase();
  const update = (notify = true) => {
    const query = normalize(input.value);
    const titleMatches = normalize(title).includes(query);
    let found = false;
    for (const group of groups) {
      if (group.pinned) continue;
      const all =
        !query || titleMatches || normalize(group.label).includes(query);
      let visible = false;
      for (const { element: row, field } of group.fields) {
        const matches =
          all ||
          normalize(field.label).includes(query) ||
          normalize(field.description).includes(query) ||
          (!field.hide &&
            !field.recovery &&
            normalize(field.value).includes(query));
        row.hidden = !matches;
        visible ||= matches;
      }
      group.element.hidden = !all && !visible;
      found ||= !group.element.hidden;
    }
    empty.hidden = found || !query;
    clear.hidden = !input.value;
    if (notify) onChange(input.value);
  };
  const clear = createIconButton(document, {
    label: "Clear filter",
    icon: "close",
    className: "cm-aic-security-action",
    onActivate() {
      input.value = "";
      update();
      input.focus();
    },
  });
  input.addEventListener("input", () => update());
  input.addEventListener("keydown", (event) => {
    // Typing/navigation in the search field never belongs to Markdown keymaps.
    event.stopPropagation();
    if (event.key === "Escape" && input.value) {
      event.preventDefault();
      input.value = "";
      update();
    }
  });
  element.append(input, clear);
  update(false);
  return { element, empty, input };
}
