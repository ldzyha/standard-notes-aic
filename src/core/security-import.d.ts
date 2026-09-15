export type SecurityImportErrorCode =
  "invalid_json" | "unsupported_authenticator" | "too_large";

export type SecurityImportResult =
  | Readonly<{
      ok: true;
      markdown: string;
      /** Compatibility alias for blockCount. */
      count: number;
      accountCount: number;
      blockCount: number;
    }>
  | Readonly<{ ok: false; code: SecurityImportErrorCode }>;

/** Convert a bounded Authenticator JSON array to canonical typed-pipe aic fences. */
export function convertAuthenticatorJson(source: string): SecurityImportResult;
