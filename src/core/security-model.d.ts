export type SecurityField = Readonly<{
  label: string;
  value: string;
  hide: boolean;
}>;

export type SecuritySection = Readonly<{
  label: string;
  fields: readonly SecurityField[];
}>;

export type SecurityModel = Readonly<{
  sections: readonly SecuritySection[];
}>;

export type SecurityParseResult =
  | Readonly<{ ok: true; model: SecurityModel }>
  | Readonly<{ ok: false; code: "invalid_security_block" }>;

/** Full fenced Markdown block with one base section and blank fields. */
export function securityTemplate(): string;
/** Strict bounded line parser; also reads legacy YAML. Failures never include the source. */
export function parseSecurityBlock(body: string): SecurityParseResult;
/** Stable line body without fences; invalid models throw a fixed TypeError. */
export function serializeSecurityBlock(model: SecurityModel): string;
/** Explicit hide property; legacy inference occurs only when old YAML is parsed. */
export function isSecretField(field: Pick<SecurityField, "hide">): boolean;
/** An absolute HTTP(S) URL safe to hand to the host; empty otherwise. */
export function safeSecurityUrl(value: unknown): string;
/** Removes complete and unclosed aic-security fences from preview input. */
export function redactSecurityBlocks(markdown: string): string;
