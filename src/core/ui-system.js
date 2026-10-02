/** Shared visual primitives. Hosts own behavior, storage and navigation. */
export const UI_COMPONENTS = Object.freeze({
  button: definition(
    [
      "default",
      "primary",
      "ghost",
      "danger",
      "normal",
      "compact",
      "touch",
      "icon-only",
      "unsaved",
    ],
    ["icon", "label"],
  ),
  toolbar: definition(["compact", "wrap"], ["group", "title", "actions"]),
  menu: definition(["compact"], ["title", "item", "separator", "hint"]),
  notice: definition(
    ["info", "success", "warning", "error"],
    ["message", "actions"],
  ),
  field: definition(
    ["compact", "invalid", "masked", "composite", "unlabelled", "icon"],
    ["label", "control", "hint", "error", "value", "status", "actions"],
  ),
  card: definition(
    [
      "compact",
      "security",
      "properties",
      "readonly",
      "empty",
      "details",
      "embedded",
    ],
    [
      "header",
      "title",
      "body",
      "actions",
      "section",
      "section-title",
      "section-actions",
      "footer",
    ],
  ),
  tree: definition(
    ["compact", "ancestors", "connected"],
    ["group", "item", "row", "label", "actions", "icon", "toggle"],
  ),
  context: definition(
    ["compact", "empty", "editing", "tabs", "document"],
    ["title", "path", "item", "link", "current", "tab", "panel", "status"],
  ),
});

function definition(modifiers, elements) {
  return Object.freeze({
    modifiers: Object.freeze(modifiers),
    elements: Object.freeze(elements),
  });
}

/** Add registered BEM classes without replacing a host's existing classes. */
export function applyUiComponent(element, block, modifiers = [], elementName) {
  if (
    typeof block !== "string" ||
    !Object.hasOwn(UI_COMPONENTS, block) ||
    !Array.isArray(modifiers) ||
    Array.from(modifiers).some(
      (modifier) => !UI_COMPONENTS[block].modifiers.includes(modifier),
    ) ||
    (elementName !== undefined &&
      !UI_COMPONENTS[block].elements.includes(elementName))
  )
    throw new TypeError("Unknown AIC UI component, element or modifier.");
  const base = `aic-${block}${elementName === undefined ? "" : `__${elementName}`}`;
  element.classList.add(
    base,
    ...modifiers.map((modifier) => `${base}--${modifier}`),
  );
  return element;
}

/** A named native button; callers attach the action and optional icon content. */
export function createUiButton(
  document,
  { label, text, icon, variant = "default", size = "normal", iconOnly = false },
) {
  if (
    typeof label !== "string" ||
    !label.trim() ||
    (text !== undefined && typeof text !== "string") ||
    !["default", "primary", "ghost", "danger"].includes(variant) ||
    !["normal", "compact", "touch"].includes(size) ||
    typeof iconOnly !== "boolean" ||
    (icon !== undefined &&
      (typeof icon !== "string" || !/^[a-z][a-z0-9-]*$/.test(icon)))
  )
    throw new TypeError("Invalid AIC button options.");
  const button = document.createElement("button");
  applyUiComponent(button, "button", [
    variant,
    size,
    ...(iconOnly ? ["icon-only"] : []),
  ]);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  if (icon) {
    const graphic = document.createElement("span");
    applyUiComponent(graphic, "button", [], "icon");
    graphic.classList.add("cm-aic-icon-button");
    graphic.dataset.aicIcon = icon;
    graphic.setAttribute("aria-hidden", "true");
    button.append(graphic);
    if (!iconOnly) {
      const caption = document.createElement("span");
      applyUiComponent(caption, "button", [], "label");
      caption.textContent = text ?? label;
      button.append(caption);
    }
  } else button.textContent = text ?? (iconOnly ? "" : label);
  return button;
}
