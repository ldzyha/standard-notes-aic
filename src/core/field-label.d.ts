export type ParsedFieldLabel = Readonly<{
  label: string;
  hide: boolean;
  kind?: "totp" | "card";
}>;
export type FieldSyntaxOptions = Readonly<{
  fieldSyntax?: "pipes";
  /** Security-only opt-in; ordinary Properties labels remain required. */
  allowEmptyLabel?: true;
}>;
/** Interpret terminal field markers; optional empty labels require explicit opt-in. */
export function parseFieldLabel(
  rawKey: string,
  options?: FieldSyntaxOptions,
): ParsedFieldLabel;
/** Throws a fixed TypeError for malformed or ambiguous labels. */
export function serializeFieldLabel(
  field: ParsedFieldLabel,
  options?: FieldSyntaxOptions,
): string;
