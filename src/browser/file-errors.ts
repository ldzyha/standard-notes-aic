/** Actionable filesystem failures cross the vault boundary without exposing file contents. */
export class BrowserFileError extends Error {
  constructor(
    readonly code: "storage" | "conflict" | "invalid" | "source" | "permission",
    message: string,
  ) {
    super(message);
    this.name = "BrowserFileError";
  }
}
