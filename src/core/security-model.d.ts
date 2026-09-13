import type { BlockDiagnostic, BlockSourceRange } from "./block-diagnostic.js";

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
  /** Independent card title; empty emits bare #. */
  title?: string;
  sections: readonly SecuritySection[];
}>;

export type SecurityParseResult =
  | Readonly<{ ok: true; model: SecurityModel }>
  | Readonly<{ ok: false; code: "invalid_security_block" }>;

export type SecurityDiagnosticParseResult =
  | Readonly<{
      ok: true;
      model: SecurityModel;
      /** Parallel body-relative ranges for sections and fields. */
      fieldRanges: readonly (readonly BlockSourceRange[])[];
    }>
  | Readonly<{
      ok: false;
      code: "invalid_security_block";
      /** Fixed advice and body-relative position; never contains authored text. */
      diagnostic: BlockDiagnostic;
    }>;

export const SECURITY_LIMITS: Readonly<{
  maxSections: 16;
  maxFields: 64;
  maxBodyLength: 65536;
  maxValueLength: 16384;
}>;

/** Full fenced Markdown block with one implicit base section and blank fields. */
export function securityTemplate(): string;
/**
 * One Security grammar: optional leading # card title, implicit first section,
 * standalone --- section boundaries, optional ## titles, and pipe field parts.
 * Labels may be empty. Unsupported syntax options fail with a fixed diagnostic.
 */
export function parseSecurityBlock(
  body: string,
  options: {
    fieldSyntax?: "pipes";
    sectionSyntax?: "separators";
    diagnostics: true;
  },
): SecurityDiagnosticParseResult;
export function parseSecurityBlock(
  body: string,
  options?: {
    fieldSyntax?: "pipes";
    sectionSyntax?: "separators";
    diagnostics?: false;
  },
): SecurityParseResult;
export function parseSecurityBlock(
  body: string,
  options: {
    fieldSyntax?: "pipes";
    sectionSyntax?: "separators";
    diagnostics?: boolean;
  },
): SecurityParseResult | SecurityDiagnosticParseResult;
/** Stable line body without fences; invalid models throw a fixed TypeError. */
export function serializeSecurityBlock(
  model: SecurityModel,
  options?: { fieldSyntax?: "pipes"; sectionSyntax?: "separators" },
): string;
/** Explicit hide property from the field marker. */
export function isSecretField(field: Pick<SecurityField, "hide">): boolean;
/** An absolute HTTP(S) URL safe to hand to the host; empty otherwise. */
export function safeSecurityUrl(value: unknown): string;
/** Removes complete and unclosed aic fences from preview input. */
export function redactSecurityBlocks(markdown: string): string;
