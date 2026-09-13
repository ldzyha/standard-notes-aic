import { createIconButton } from "./structured-preview.js";
let addReasonId = 0;

/** A small disclosure, not a second editor. Global listeners live only while open. */
export function createSecurityAddMenu(document, label, entries, text = "") {
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
    disabled: entries.every((entry) => entry.disabled),
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
  if (text) trigger.append(document.createTextNode(text));
  trigger.setAttribute("aria-expanded", "false");
  const reasons = [
    ...new Set(
      entries
        .filter((entry) => entry.disabled && entry.disabledReason)
        .map((entry) => entry.disabledReason),
    ),
  ];
  const reason = document.createElement("span");
  if (reasons.length) {
    reason.className = "cm-aic-security-add-reason";
    reason.id = `aic-add-reason-${++addReasonId}`;
    reason.textContent = reasons.join(" ");
    trigger.setAttribute("aria-describedby", reason.id);
    if (trigger.disabled) trigger.title = reason.textContent;
  }
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
    if (entry.disabled && entry.disabledReason) {
      control.title = entry.disabledReason;
      control.setAttribute("aria-describedby", reason.id);
    }
    control.append(document.createTextNode(entry.text || entry.label));
    menu.append(control);
  }
  element.append(trigger, menu);
  if (reasons.length) element.append(reason);
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
      const matches = all
        ? null
        : group.fields.map(
            ({ field }) =>
              all ||
              normalize(field.label).includes(query) ||
              normalize(field.description).includes(query) ||
              (!field.hide &&
                !field.recovery &&
                normalize(
                  field.kind === "card"
                    ? field.value.replace(/[ -]/gu, "").slice(-4)
                    : field.value,
                ).includes(query)),
          );
      const visible = all || matches.some(Boolean);
      // A fully hidden group needs no per-field writes. In particular, clearing
      // a no-match filter restores the group, not hundreds of hidden rows.
      if (visible) {
        for (const [index, { element: row }] of group.fields.entries()) {
          const hidden = !all && !matches[index];
          if (row.hidden !== hidden) row.hidden = hidden;
        }
      }
      if (group.element.hidden === visible) group.element.hidden = !visible;
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
