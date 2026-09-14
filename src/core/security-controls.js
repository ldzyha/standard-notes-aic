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
  const win = document.defaultView;
  const requestFrame =
    win.requestAnimationFrame?.bind(win) ||
    ((callback) => win.setTimeout(callback, 16));
  const cancelFrame =
    win.cancelAnimationFrame?.bind(win) || win.clearTimeout.bind(win);
  let frame = null;
  let observer = null;
  let measuredHeight = null;
  let measuredWidth = null;
  let measuredViewportHeight = null;
  const clipAncestors = () => {
    const ancestors = [];
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = win.getComputedStyle(parent);
      if (
        [style.overflow, style.overflowX, style.overflowY].some(
          (overflow) => overflow && overflow !== "visible",
        )
      )
        ancestors.push(parent);
    }
    return ancestors;
  };
  const position = () => {
    if (menu.hidden) return;
    if (!element.isConnected) return close();
    const viewport = win.visualViewport;
    const bounds = {
      left: viewport?.offsetLeft || 0,
      top: viewport?.offsetTop || 0,
      right: (viewport?.offsetLeft || 0) + (viewport?.width || win.innerWidth),
      bottom:
        (viewport?.offsetTop || 0) + (viewport?.height || win.innerHeight),
    };
    for (const ancestor of clipAncestors()) {
      const rect = ancestor.getBoundingClientRect();
      // A zero rect in a detached/test layout is not a useful clipping box.
      if (!rect.width || !rect.height) continue;
      const left = rect.left + ancestor.clientLeft;
      const top = rect.top + ancestor.clientTop;
      bounds.left = Math.max(bounds.left, left);
      bounds.top = Math.max(bounds.top, top);
      bounds.right = Math.min(
        bounds.right,
        left + (ancestor.clientWidth || rect.width - 2 * ancestor.clientLeft),
      );
      bounds.bottom = Math.min(
        bounds.bottom,
        top + (ancestor.clientHeight || rect.height - 2 * ancestor.clientTop),
      );
    }
    const inset = 8;
    bounds.left += inset;
    bounds.top += inset;
    bounds.right -= inset;
    bounds.bottom -= inset;
    const anchor = trigger.getBoundingClientRect();
    if (
      (anchor.width &&
        anchor.height &&
        (anchor.right <= bounds.left ||
          anchor.left >= bounds.right ||
          anchor.bottom <= bounds.top ||
          anchor.top >= bounds.bottom)) ||
      bounds.right <= bounds.left ||
      bounds.bottom <= bounds.top
    )
      return close();
    const availableWidth = bounds.right - bounds.left;
    const viewportHeight = viewport?.height || win.innerHeight;
    menu.style.maxWidth = `${availableWidth}px`;
    if (
      measuredHeight === null ||
      measuredWidth !== availableWidth ||
      measuredViewportHeight !== viewportHeight
    ) {
      const scrollTop = menu.scrollTop;
      menu.style.maxHeight = "";
      measuredHeight = menu.getBoundingClientRect().height;
      measuredWidth = availableWidth;
      measuredViewportHeight = viewportHeight;
      menu.scrollTop = scrollTop;
    }
    const size = menu.getBoundingClientRect();
    const gap = 4;
    const above = Math.max(0, anchor.top - bounds.top - gap);
    const below = Math.max(0, bounds.bottom - anchor.bottom - gap);
    const placeAbove =
      above >= measuredHeight || (below < measuredHeight && above > below);
    const available = placeAbove ? above : below;
    const height = Math.min(measuredHeight, available);
    menu.style.maxHeight = `${height}px`;
    menu.style.left = `${Math.max(bounds.left, Math.min(anchor.left, bounds.right - size.width))}px`;
    menu.style.top = `${placeAbove ? anchor.top - gap - height : anchor.bottom + gap}px`;
  };
  const schedulePosition = () => {
    if (menu.hidden || frame !== null) return;
    frame = requestFrame(() => {
      frame = null;
      position();
    });
  };
  const close = (focus = false) => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", escape, true);
    document.removeEventListener("focusin", focusOutside, true);
    document.removeEventListener("scroll", schedulePosition, true);
    win.removeEventListener("resize", schedulePosition);
    win.visualViewport?.removeEventListener("resize", schedulePosition);
    win.visualViewport?.removeEventListener("scroll", schedulePosition);
    observer?.disconnect();
    observer = null;
    measuredHeight = null;
    measuredWidth = null;
    measuredViewportHeight = null;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (focus && trigger.isConnected) trigger.focus();
  };
  const outside = (event) => {
    if (!element.contains(event.target)) close();
  };
  const focusOutside = (event) => {
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
      document.addEventListener("focusin", focusOutside, true);
      document.addEventListener("scroll", schedulePosition, true);
      win.addEventListener("resize", schedulePosition);
      win.visualViewport?.addEventListener("resize", schedulePosition);
      win.visualViewport?.addEventListener("scroll", schedulePosition);
      if (win.ResizeObserver) {
        observer = new win.ResizeObserver(schedulePosition);
        observer.observe(trigger);
        for (const ancestor of clipAncestors()) observer.observe(ancestor);
      }
      position();
      if (!menu.hidden)
        menu
          .querySelector("button:not(:disabled)")
          ?.focus({ preventScroll: true });
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
