/** Presets assemble ordinary independent parts; names never select behavior. */
const TEMPLATES = Object.freeze({
  blank: { label: "", kinds: ["text"] },
  account: { label: "Account", kinds: ["text", "secret"] },
  card: { label: "Card", kinds: ["card", "text", "secret"] },
  "one-time": { label: "One-time codes", kinds: ["one-time"] },
});

export const SECURITY_ROW_TEMPLATES = Object.freeze([
  Object.freeze({ id: "blank", label: "Blank row" }),
  Object.freeze({ id: "account", label: "Account" }),
  Object.freeze({ id: "card", label: "Card" }),
  Object.freeze({ id: "one-time", label: "One-time codes" }),
]);

/** Always return a fresh row so editing a preset cannot alter future notes. */
export function createSecurityRowTemplate(id = "blank") {
  if (!Object.hasOwn(TEMPLATES, id))
    throw new TypeError("Unknown row template");
  const template = TEMPLATES[id];
  return {
    label: template.label,
    parts: template.kinds.map((kind) => ({ kind, value: "" })),
  };
}
