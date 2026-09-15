import type { SecurityPart } from "./security-model.js";

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

/** Explicit secret type only; labels do not select behavior, emptiness is a UI guard. */
export function isPasswordField(field: Pick<SecurityPart, "kind">): boolean;
