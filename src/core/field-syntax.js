export const PIPE_FIELD_OPTIONS = Object.freeze({ fieldSyntax: "pipes" });
export const SECURITY_FIELD_OPTIONS = Object.freeze({
  fieldSyntax: "pipes",
  sectionSyntax: "separators",
});
export const SECURITY_FENCE_INFO = "aic-security v3";
export const PROPERTIES_SYNTAX_MARKER = "# aic-fields: v2";

/** Only the first body line is a version directive, never a scalar's contents. */
export function propertiesSyntax(body) {
  const match = /^# aic-fields: (v[0-9]+)[ \t]*(?:\r\n|\n|\r|$)/u.exec(body);
  if (!match) return {};
  return match[1] === "v2" ? PIPE_FIELD_OPTIONS : { unsupportedSyntax: true };
}
