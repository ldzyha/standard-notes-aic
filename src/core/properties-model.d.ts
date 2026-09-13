export type PropertiesField = Readonly<{
  label: string;
  description?: string;
  additionalSecret?: string;
  kind?: "totp" | "card";
  value: string;
  hide: boolean;
  readOnly?: true;
  displayValue?: string;
}>;
export type PropertiesSection = Readonly<{
  label: string;
  fields: readonly PropertiesField[];
  readOnly?: true;
  allowAdd: boolean;
}>;
export type PropertiesModel = Readonly<{
  sections: readonly PropertiesSection[];
}>;
export type PropertiesParseResult =
  | Readonly<{ ok: true; model: PropertiesModel }>
  | Readonly<{ ok: false; code: "invalid_properties_block" }>;
/** Strict bounded YAML body parser. Body excludes frontmatter delimiters. */
export function parsePropertiesBody(
  body: string,
  options?: { fieldSyntax?: "pipes" },
): PropertiesParseResult;
/** Targeted token edits; identical model returns original bytes. Throws a fixed TypeError. */
export function serializePropertiesBody(
  model: PropertiesModel,
  originalBody: string,
  options?: { fieldSyntax?: "pipes" },
): string;
