export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";
export type TotpConfig = Readonly<{
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  label: string;
  issuer: string;
}>;

export function parseTotpInput(
  input:
    | string
    | Readonly<{
        secret: string;
        algorithm?: TotpAlgorithm | string;
        digits?: number | string;
        period?: number | string;
        label?: string;
        issuer?: string;
      }>,
): TotpConfig;

export function totpAt(
  input: Parameters<typeof parseTotpInput>[0],
  now?: number,
  crypto?: Crypto,
): Promise<
  Readonly<{ code: string; secondsRemaining: number; period: number }>
>;
