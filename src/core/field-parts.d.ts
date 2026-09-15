export type FieldPartKind =
  "text" | "secret" | "totp" | "card" | "one-time" | "used";
export type FieldPart = Readonly<{ value: string; kind: FieldPartKind }>;
export type EncodedFieldPart = Readonly<{
  kind: FieldPartKind;
  encoded: string;
  quoted: boolean;
  from: number;
  to: number;
  separatorFrom: number;
  separatorTo: number;
}>;
export const FIELD_PARTS_MAX_LENGTH: 16384;
export const FIELD_PARTS_MAX_COUNT: 64;
/** Input begins with |, *|, #| or _|; ranges are relative to that input. */
export function scanFieldParts(raw: string): EncodedFieldPart[];
export function parseFieldParts(raw: string): FieldPart[];
export function quoteFieldPart(value: string): string | null;
export function serializeFieldParts(parts: readonly FieldPart[]): string;
