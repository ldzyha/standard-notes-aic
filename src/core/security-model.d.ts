export type SecurityField = Readonly<{
  label: string;
  description?: string;
  additionalSecret?: string;
  kind?: "totp" | "card";
  value: string;
  hide: boolean;
}>;

export type SecuritySection = Readonly<{
  label: string;
  fields: readonly SecurityField[];
}>;

export type SecurityModel = Readonly<{
  /** Independent card title. Omitted preserves legacy behavior; empty emits bare #. */
  title?: string;
  sections: readonly SecuritySection[];
}>;

export type SecurityParseResult =
  | Readonly<{ ok: true; model: SecurityModel }>
  | Readonly<{ ok: false; code: "invalid_security_block" }>;

/** Full v2 fenced Markdown block with one base section and blank fields. */
export function securityTemplate(): string;
/**
 * Optional leading # title (or bare #), then explicit ## sections and fields.
 * Titles use field-value escapes, but must decode to trimmed printable text
 * of at most 256 UTF-16 units. No implicit section; also reads legacy YAML.
 * Failures never include the source.
 */
export function parseSecurityBlock(
  body: string,
  options?: { fieldSyntax?: "pipes" },
): SecurityParseResult;
/** Stable line body without fences; invalid models throw a fixed TypeError. */
export function serializeSecurityBlock(
  model: SecurityModel,
  options?: { fieldSyntax?: "pipes" },
): string;
/** Explicit hide property; legacy inference occurs only when old YAML is parsed. */
export function isSecretField(field: Pick<SecurityField, "hide">): boolean;
/** An absolute HTTP(S) URL safe to hand to the host; empty otherwise. */
export function safeSecurityUrl(value: unknown): string;
/** Removes complete and unclosed aic-security fences from preview input. */
export function redactSecurityBlocks(markdown: string): string;
