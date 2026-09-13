export type ParsedFieldLabel = Readonly<{
  label: string;
  hide: boolean;
  kind?: "totp" | "card";
}>;
export type FieldSyntaxOptions = Readonly<{ fieldSyntax?: "pipes" }>;
/** Legacy trailing star by default; v2 `*`, `#`, `_` markers only when opted in. */
export function parseFieldLabel(
  rawKey: string,
  options?: FieldSyntaxOptions,
): ParsedFieldLabel;
/** Throws a fixed TypeError for malformed or ambiguous labels. */
export function serializeFieldLabel(
  field: ParsedFieldLabel,
  options?: FieldSyntaxOptions,
): string;
