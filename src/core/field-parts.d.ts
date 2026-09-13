export type FieldParts = Readonly<{
  value: string;
  description?: string;
  additionalSecret?: string;
}>;

/** Split on any unescaped pipe, removing at most one adjacent ASCII space. */
export function splitFieldParts(raw: string): string[];
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
