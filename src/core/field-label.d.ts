export type ParsedFieldLabel = Readonly<{ label: string }>;
export type FieldSyntaxOptions = Readonly<{
  fieldSyntax?: "pipes";
  allowEmptyLabel?: true;
}>;
export function parseFieldLabel(
  raw: string,
  options?: FieldSyntaxOptions,
): ParsedFieldLabel;
export function serializeFieldLabel(
  field: ParsedFieldLabel,
  options?: FieldSyntaxOptions,
): string;
export function scanFieldLabel(
  line: string,
  options?: FieldSyntaxOptions,
): (ParsedFieldLabel & { separatorFrom: number }) | null;
