import type { SecurityField } from "./security-model.js";

export type PasswordOptions = Readonly<{
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}>;

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions;

/** Length 8–128, at least one enabled class; fails closed without WebCrypto. */
export function generatePassword(
  options?: Partial<PasswordOptions>,
  crypto?: Pick<Crypto, "getRandomValues">,
): string;

/** Explicit password labels on hidden fields only; emptiness is a UI guard. */
export function isPasswordField(
  field: Pick<SecurityField, "label" | "hide">,
): boolean;
