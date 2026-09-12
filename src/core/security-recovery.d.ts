import type { SecurityField } from "./security-model.js";

export type RecoveryCode = { value: string; used: boolean };
export type RecoveryCodesResult =
  | { ok: true; codes: RecoveryCode[] }
  | {
      ok: false;
      code: "invalid_recovery_codes" | "recovery_codes_too_large";
    };

/** Only explicitly hidden fields with these exact labels get code controls. */
export function isRecoveryField(
  field: Pick<SecurityField, "label" | "hide">,
): boolean;

/** Parse a stored canonical checklist or an unused raw batch, never a mixture. */
export function parseRecoveryCodes(value: string): RecoveryCodesResult;

/** Split only CRLF/CR/LF; every nonblank line is an exact, unused code. */
export function parseRecoveryCodesPaste(raw: string): RecoveryCodesResult;

/** Throws only fixed TypeError/RangeError messages for invalid or oversized data. */
export function serializeRecoveryCodes(codes: readonly RecoveryCode[]): string;
