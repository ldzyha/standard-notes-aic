export type SecurityImportErrorCode =
  "invalid_json" | "unsupported_authenticator" | "too_large";

export type SecurityImportResult =
  | Readonly<{ ok: true; markdown: string; count: number }>
  | Readonly<{ ok: false; code: SecurityImportErrorCode }>;

/** Convert a bounded Standard Notes Authenticator JSON array to aic-security fences. */
export function convertAuthenticatorJson(source: string): SecurityImportResult;
