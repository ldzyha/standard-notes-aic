export const PIPE_FIELD_OPTIONS: Readonly<{ fieldSyntax: "pipes" }>;
export const SECURITY_FIELD_OPTIONS: Readonly<{
  fieldSyntax: "pipes";
  sectionSyntax: "separators";
}>;
export const SECURITY_FENCE_INFO: "aic-security v3";
export const PROPERTIES_SYNTAX_MARKER: "# aic-fields: v2";
export function propertiesSyntax(
  body: string,
): Readonly<{ fieldSyntax?: "pipes"; unsupportedSyntax?: true }>;
