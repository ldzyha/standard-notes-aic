export type RecoveryCode = Readonly<{ value: string }>;
export type RecoveryCodesResult =
  | { ok: true; codes: RecoveryCode[] }
  | { ok: false; code: "invalid_recovery_codes" | "recovery_codes_too_large" };
/**
 * Explicit multi-line one-time paste. Splits CRLF/CR/LF only, preserves every
 * nonblank line verbatim, and never interprets checklist-like code text.
 * At most 64 codes, 256 UTF-16 units per code and 16 KiB raw/encoded parts.
 */
export function parseRecoveryCodesPaste(raw: string): RecoveryCodesResult;
