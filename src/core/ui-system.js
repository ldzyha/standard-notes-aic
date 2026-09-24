/** Shared visual primitives. Hosts own behavior, storage and navigation. */
export const UI_COMPONENTS = Object.freeze({
  button: definition(
    ["default", "ghost", "danger", "normal", "compact", "touch", "icon-only"],
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
    ["compact", "security", "properties", "readonly", "empty"],
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
    ["compact", "ancestors"],
    ["group", "item", "row", "label", "actions"],
  ),
  context: definition(
    ["compact", "empty", "editing"],
    ["title", "path", "item", "link", "current"],
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
  { label, text, variant = "default", size = "normal", iconOnly = false },
) {
  if (
    typeof label !== "string" ||
    !label.trim() ||
    (text !== undefined && typeof text !== "string") ||
    !["default", "ghost", "danger"].includes(variant) ||
    !["normal", "compact", "touch"].includes(size) ||
    typeof iconOnly !== "boolean"
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
  button.textContent = text ?? (iconOnly ? "" : label);
  return button;
}
