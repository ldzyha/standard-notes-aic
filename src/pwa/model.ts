export const MAX_PWA_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_PWA_ENTRIES = 2000;
export const MAX_PWA_PAYLOAD_BYTES = 6 * 1024 * 1024;

export interface PwaFile {
  id: string;
  path: string;
  mediaType: string;
  modifiedAt: number;
  data: string;
}

export type PortableFile = PwaFile;

interface PayloadHeader {
  format: "aic-notes-pwa";
  version: 1;
  /** A display label only; paths identify original files. */
  label?: string;
}

export interface WorkspacePayload extends PayloadHeader {
  kind: "workspace";
  files: PwaFile[];
  /** Relative paths retain empty folders and distinguish project roots. */
  directories: string[];
}

export type PwaPayload = WorkspacePayload;

export class PwaError extends Error {
  constructor(
    readonly code:
      "invalid" | "limit" | "locked" | "missing" | "conflict" | "storage",
    message: string,
  ) {
    super(message);
    this.name = "PwaError";
  }
}

const encoder = new TextEncoder();
// This ledger holds no object strongly. Repeated ownership-boundary validation
// can reuse the canonical-byte check for the exact data string on a validated
// file object; descriptors and all metadata are still checked on every call.
const validatedFileData = new WeakMap<object, string>();
const invalid = () =>
  new PwaError("invalid", "Invalid or unsupported AIC file data.");
const limit = () =>
  new PwaError(
    "limit",
    "This entity exceeds the supported 6 MiB workspace payload.",
  );

function ownRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw invalid();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw invalid();
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
    });
  }
  return result;
}

function exactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): void {
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw invalid();
}

function denseArray(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw invalid();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw invalid();
    result.push(descriptor.value);
  }
  return result;
}

function safeString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw invalid();
  const bytes = encoder.encode(value);
  if (
    bytes.length > maximum ||
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== value
  )
    throw invalid();
  return value;
}

/** No traversal, absolute paths, platform separators or ambiguous restore names. */
export function validateRelativePath(value: unknown): string {
  const path = safeString(value, 4096);
  if (
    !path ||
    /[\\<>:"|?*]/u.test(path) ||
    [...path].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw invalid();
  for (const part of path.split("/")) {
    if (
      !part ||
      part === "." ||
      part === ".." ||
      /[. ]$/u.test(part) ||
      encoder.encode(part).length > 255 ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
    )
      throw invalid();
  }
  return path;
}

export function encodeBase64(bytes: Uint8Array): string {
  // File/crypto bytes can originate in another window or platform realm.
  if (
    !ArrayBuffer.isView(bytes) ||
    Object.prototype.toString.call(bytes) !== "[object Uint8Array]"
  )
    throw invalid();
  if (bytes.length > MAX_PWA_FILE_BYTES) throw limit();
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** Accept only canonical padded base64, including the empty file spelling. */
export function decodeBase64(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string") throw invalid();
  if (value.length > 4 * Math.ceil(MAX_PWA_FILE_BYTES / 3)) throw limit();
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value))
    throw invalid();
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw invalid();
  }
  if (binary.length > MAX_PWA_FILE_BYTES) throw limit();
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64(bytes) !== value) throw invalid();
  return bytes;
}

export function validatePwaFile(value: unknown): PwaFile {
  const file = ownRecord(value);
  exactKeys(file, ["id", "path", "mediaType", "modifiedAt", "data"]);
  if (typeof file.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(file.id))
    throw invalid();
  const path = validateRelativePath(file.path);
  const mediaType = safeString(file.mediaType, 255);
  if (
    /[^\u0020-\u007e]/u.test(mediaType) ||
    typeof file.modifiedAt !== "number" ||
    !Number.isSafeInteger(file.modifiedAt) ||
    file.modifiedAt < 0
  )
    throw invalid();
  if (typeof file.data !== "string") throw invalid();
  if (validatedFileData.get(value as object) !== file.data)
    decodeBase64(file.data);
  const result: PwaFile = {
    id: file.id,
    path,
    mediaType,
    modifiedAt: file.modifiedAt,
    data: file.data as string,
  };
  validatedFileData.set(value as object, result.data);
  validatedFileData.set(result, result.data);
  return result;
}

export function createPwaFile(
  path: string,
  bytes: Uint8Array,
  mediaType = "",
  modifiedAt = Date.now(),
): PwaFile {
  return validatePwaFile({
    id: crypto.randomUUID(),
    path,
    mediaType,
    modifiedAt,
    data: encodeBase64(bytes),
  });
}

export function fileBytes(file: PwaFile): Uint8Array<ArrayBuffer> {
  return decodeBase64(validatePwaFile(file).data);
}

/** Invalid UTF-8 stays an opaque binary attachment rather than lossy editor text. */
export function fileText(file: PwaFile): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      fileBytes(file),
    );
  } catch (error) {
    if (error instanceof PwaError) throw error;
    throw new PwaError(
      "invalid",
      "This file is binary and cannot be edited as text.",
    );
  }
}

function labelOf(value: Record<string, unknown>): { label?: string } {
  return Object.hasOwn(value, "label")
    ? { label: safeString(value.label, 1024) }
    : {};
}

function payloadSize(payload: PwaPayload): void {
  if (encoder.encode(JSON.stringify(payload)).length > MAX_PWA_PAYLOAD_BYTES)
    throw limit();
}

export function validatePayload(value: unknown): PwaPayload {
  try {
    const source = ownRecord(value);
    if (source.format !== "aic-notes-pwa" || source.version !== 1)
      throw invalid();
    const header = {
      format: "aic-notes-pwa" as const,
      version: 1 as const,
      ...labelOf(source),
    };
    if (source.kind !== "workspace") throw invalid();
    exactKeys(
      source,
      ["format", "version", "kind", "files", "directories"],
      ["label"],
    );
    const rawFiles = denseArray(source.files);
    const rawDirectories = denseArray(source.directories);
    if (rawFiles.length + rawDirectories.length > MAX_PWA_ENTRIES)
      throw new PwaError(
        "limit",
        `This workspace exceeds its ${MAX_PWA_ENTRIES} stored file and folder limit (${rawFiles.length} files, ${rawDirectories.length} folder records). Existing files count too. Start another workspace or choose fewer notes.`,
      );
    const files = rawFiles.map(validatePwaFile);
    const directories = rawDirectories.map(validateRelativePath);
    const ids = new Set(files.map((file) => file.id));
    const paths = [...files.map((file) => file.path), ...directories];
    // Reject collisions on case-insensitive/Unicode-normalizing destination filesystems.
    const canonical = (path: string) => path.normalize("NFC").toLowerCase();
    const normalizedPaths = paths.map(canonical);
    if (
      ids.size !== files.length ||
      new Set(normalizedPaths).size !== paths.length
    )
      throw invalid();
    const exactAncestors = new Map<string, string>();
    for (const path of paths) {
      const parts = path.split("/");
      for (let index = 1; index <= parts.length; index++) {
        const ancestor = parts.slice(0, index).join("/");
        const key = canonical(ancestor);
        const prior = exactAncestors.get(key);
        if (prior !== undefined && prior !== ancestor) throw invalid();
        exactAncestors.set(key, ancestor);
      }
    }
    const filePaths = new Set(files.map((file) => canonical(file.path)));
    for (const path of normalizedPaths) {
      const parts = path.split("/");
      for (let index = 1; index < parts.length; index++) {
        if (filePaths.has(parts.slice(0, index).join("/"))) throw invalid();
      }
    }
    const payload: WorkspacePayload = {
      ...header,
      kind: "workspace",
      files,
      directories,
    };
    payloadSize(payload);
    return payload;
  } catch (error) {
    if (error instanceof PwaError) throw error;
    throw invalid();
  }
}

export function createWorkspace(label?: string): WorkspacePayload {
  return validatePayload({
    format: "aic-notes-pwa",
    version: 1,
    kind: "workspace",
    ...(label === undefined ? {} : { label }),
    files: [],
    directories: [],
  }) as WorkspacePayload;
}

export function serializePayload(value: unknown): string {
  return JSON.stringify(validatePayload(value));
}

/** Read only the plain workspace cache schema. */
export function parsePayload(text: string): PwaPayload {
  if (typeof text !== "string") throw invalid();
  if (
    text.length > MAX_PWA_PAYLOAD_BYTES ||
    encoder.encode(text).length > MAX_PWA_PAYLOAD_BYTES
  )
    throw limit();
  try {
    const parsed: unknown = JSON.parse(text);
    return validatePayload(parsed);
  } catch (error) {
    if (error instanceof PwaError) throw error;
    throw invalid();
  }
}
