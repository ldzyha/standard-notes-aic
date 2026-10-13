/**
 * The one note the browser panel edits: `aic.md` in the connected folder, or
 * the connected file. The extension's background worker is its sole writer.
 */
export interface BrowserNote {
  id: string;
  /** Path inside the connected folder, or the connected file's name. */
  filePath: string;
  markdown: string;
  /** Opaque token of the bytes last observed on disk, never a counter. */
  revision: number;
}

export interface PageContext {
  url: string;
  title: string;
}

export class LibraryError extends Error {
  constructor(
    public readonly code: "invalid" | "quota" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

/** The whole note file is read and written in one piece; it is never truncated. */
export const MAX_NOTE_BYTES = 512 * 1024;
export const NOTE_TOO_LARGE =
  "The note file is too large: AIC edits notes up to 512 KiB. Nothing was truncated.";
const MAX_URL_BYTES = 8192;
const encoder = new TextEncoder();

const invalid = () => new LibraryError("invalid", "Invalid browser note data.");

function bytes(value: string): number {
  return encoder.encode(value).length;
}

export function validateMarkdownPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    bytes(value) > 2048 ||
    !/\.md$/iu.test(value) ||
    value.includes("\\") ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /^(?:\.git|\.aic|node_modules)$/iu.test(part),
      )
  )
    throw invalid();
  return value;
}

export function normalizePageUrl(input: string): string {
  if (
    typeof input !== "string" ||
    bytes(input) > MAX_URL_BYTES ||
    input !== input.trim()
  )
    throw invalid();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalid();
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    bytes(url.href) > MAX_URL_BYTES
  )
    throw invalid();
  return url.href;
}

/** Origin of a recovery copy kept from the retired per-site notes. */
export function normalizeDomainOrigin(input: string): string {
  const origin = new URL(normalizePageUrl(input)).origin;
  if (input !== origin) throw invalid();
  return origin;
}

/** A save request as the worker accepts it; the text limit is the note cap. */
export function validateSave(
  id: unknown,
  markdown: unknown,
  revision: unknown,
): void {
  if (
    typeof id !== "string" ||
    !id ||
    typeof markdown !== "string" ||
    !Number.isSafeInteger(revision) ||
    (revision as number) < 1
  )
    throw invalid();
  if (bytes(markdown) > MAX_NOTE_BYTES)
    throw new LibraryError("quota", NOTE_TOO_LARGE);
}
