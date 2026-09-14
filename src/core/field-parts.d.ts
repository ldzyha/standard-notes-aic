export const FIELD_PARTS_MAX_LENGTH: 16384;
export type FieldParts = Readonly<{
  value: string;
  description?: string;
  additionalSecret?: string;
}>;

export type EncodedFieldPart = Readonly<{
  encoded: string;
  from: number;
  to: number;
  quoted: boolean;
}>;
/** Scan spaced ` | ` delimiters outside JSON double-quoted strings; errors carry safe code/offset. */
export function scanFieldParts(raw: string): EncodedFieldPart[];
/** Split encoded parts, retaining their quote syntax until decoding. */
export function splitFieldParts(raw: string): string[];
/** JSON-encode a value containing pipe/quote, or return null for ordinary unquoted encoding. */
export function quoteFieldPart(value: string): string | null;
/** Join one to three slots already encoded for Security or YAML source. */
export function joinFieldParts(encodedSlots: readonly string[]): string;
/** Escape literal backslashes and pipes within a decoded slot. */
export function escapePipePart(value: string): string;
/** Decode only pipe-layer escapes; unknown escapes fail closed. */
export function unescapePipePart(raw: string): string;
/** Decode a pipe-encoded value into one to three logical slots. */
export function parseFieldParts(raw: string): FieldParts;
/** Encode logical slots, preserving explicit empty and absent slots. */
export function serializeFieldParts(field: FieldParts): string;
