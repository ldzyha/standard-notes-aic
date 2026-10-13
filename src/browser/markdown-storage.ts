import { BrowserFileError } from "./file-errors";
import {
  LibraryError,
  NOTE_TOO_LARGE,
  MAX_NOTE_BYTES,
  validateMarkdownPath,
  validateSave,
  type BrowserNote,
} from "./library";

export const FILE_SOURCE_KEY = "aic-browser-markdown-source";
/** The one note file inside a connected folder. */
export const NOTE_FILE = "aic.md";
export interface BrowserFileLocation {
  kind: "file" | "directory" | "unselected";
  id?: string;
  name?: string;
}
export interface BrowserStatus {
  state: "unselected" | "ready" | "unavailable";
  source: BrowserFileLocation;
  sourceError?: string;
  sourceErrorCode?: string;
  access?: { read: PermissionState; write: PermissionState };
  /** The folder holds metadata of the earlier one-note-per-page layout. */
  legacyNotes?: true;
}
interface Permissions {
  queryPermission?(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}
export interface BrowserMarkdownFile extends Permissions {
  kind: "file";
  name: string;
  getFile(): Promise<{
    size: number;
    text(): Promise<string>;
    lastModified?: number;
    arrayBuffer?(): Promise<ArrayBuffer>;
  }>;
  createWritable(options?: {
    keepExistingData: boolean;
    mode: "exclusive";
  }): Promise<{
    write(text: string): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}
export interface BrowserMarkdownDirectory extends Permissions {
  kind: "directory";
  name: string;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<BrowserMarkdownFile>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<BrowserMarkdownDirectory>;
  values(): AsyncIterableIterator<
    BrowserMarkdownFile | BrowserMarkdownDirectory
  >;
  removeEntry(name: string): Promise<void>;
}
export type BrowserMarkdownHandle =
  BrowserMarkdownFile | BrowserMarkdownDirectory;
export interface BrowserSourceBindings {
  read(id: string): Promise<unknown | null>;
  write(id: string, handle: BrowserMarkdownHandle): Promise<void>;
}
interface LocalStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}
interface Observation {
  sourceId: string;
  root: BrowserMarkdownHandle;
  /** Null until the folder's note file exists; it is created by the first save. */
  handle: BrowserMarkdownFile | null;
  note: BrowserNote;
  legacyNotes: boolean;
}
const encoder = new TextEncoder();
const fail = (
  message: string,
  code:
    "storage" | "invalid" | "conflict" | "source" | "permission" = "storage",
) => new BrowserFileError(code, message);
const missing = (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "name" in error &&
  error.name === "NotFoundError";

function bindingId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^browser-[a-zA-Z0-9_-]{1,100}$/u.test(value)
  )
    throw fail("Open your Markdown file or folder again.", "invalid");
  return value;
}
function nativeHandle(value: unknown): BrowserMarkdownHandle {
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    !("name" in value) ||
    typeof value.name !== "string"
  )
    throw fail(
      "Remembered file access is unavailable. Open the original file or folder again.",
    );
  if (
    value.kind === "file" &&
    "getFile" in value &&
    typeof value.getFile === "function" &&
    "createWritable" in value &&
    typeof value.createWritable === "function"
  )
    return value as BrowserMarkdownFile;
  if (
    value.kind === "directory" &&
    "values" in value &&
    typeof value.values === "function" &&
    "getFileHandle" in value &&
    typeof value.getFileHandle === "function" &&
    "getDirectoryHandle" in value &&
    typeof value.getDirectoryHandle === "function"
  )
    return value as BrowserMarkdownDirectory;
  throw fail(
    "Remembered file access is unavailable. Open the original file or folder again.",
  );
}
async function permission(
  handle: Permissions,
  mode: "read" | "readwrite",
  request = false,
): Promise<void> {
  if (
    !handle.queryPermission ||
    (await handle.queryPermission({ mode })) === "granted"
  )
    return;
  if (
    request &&
    handle.requestPermission &&
    (await handle.requestPermission({ mode })) === "granted"
  )
    return;
  throw fail(
    "File access needs permission. Reconnect files, then retry; your draft is unchanged.",
    "permission",
  );
}
async function readText(handle: BrowserMarkdownFile): Promise<string> {
  await permission(handle, "read");
  const file = await handle.getFile();
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > MAX_NOTE_BYTES
  )
    throw fail(NOTE_TOO_LARGE, "invalid");
  const text = file.arrayBuffer
    ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await file.arrayBuffer(),
      )
    : await file.text();
  if (encoder.encode(text).length !== file.size)
    throw fail(
      "The file is not valid UTF-8 Markdown, or changed while reading.",
      "invalid",
    );
  return text;
}
async function writeText(
  handle: BrowserMarkdownFile,
  text: string,
  expected: string | null,
): Promise<void> {
  await permission(handle, "readwrite");
  const assert = async () => {
    const actual = await readText(handle);
    if (actual !== (expected ?? ""))
      throw fail(
        "This file changed on disk. Keep or export your draft before reopening it.",
        "conflict",
      );
  };
  await assert();
  const writer = await handle.createWritable({
    keepExistingData: false,
    mode: "exclusive",
  });
  let closed = false;
  try {
    await assert();
    await writer.write(text);
    await assert();
    await writer.close();
    closed = true;
  } finally {
    if (!closed) {
      try {
        await writer.abort?.();
      } catch {
        /* Preserve original failure. */
      }
    }
  }
}
async function digest(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
function revision(fingerprint: string): number {
  return Number.parseInt(fingerprint.slice(0, 12), 16) + 1;
}

export class IndexedDbBrowserSources implements BrowserSourceBindings {
  constructor(private readonly factory = globalThis.indexedDB) {}
  private async operation<T>(
    id: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    bindingId(id);
    if (!this.factory) throw fail("This browser cannot remember file access.");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open("aic-browser-markdown-bindings", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("sources", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () =>
        reject(fail("Could not remember file access."));
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction("sources", mode);
        const request = run(transaction.objectStore("sources"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () =>
          reject(fail("Could not restore file access."));
      });
    } finally {
      database.close();
    }
  }
  async read(id: string): Promise<unknown | null> {
    const result = await this.operation<
      { id: string; handle: unknown } | undefined
    >(id, "readonly", (store) => store.get(id));
    if (!result) return null;
    if (result.id !== id)
      throw fail("Remembered file access is invalid.", "invalid");
    return result.handle;
  }
  async write(id: string, handle: BrowserMarkdownHandle): Promise<void> {
    nativeHandle(handle);
    await this.operation(id, "readwrite", (store) => store.put({ id, handle }));
  }
}

/** A visible panel retains grants independently of the worker's idle lifetime. */
export class BrowserSourceAccess {
  private readonly handles = new Map<string, BrowserMarkdownHandle>();
  private readonly pending = new Map<string, Promise<void>>();
  private generation = 0;
  constructor(
    private readonly bindings: BrowserSourceBindings = new IndexedDbBrowserSources(),
  ) {}
  has(id: string): boolean {
    return this.handles.has(bindingId(id));
  }
  warm(id: string): Promise<void> {
    bindingId(id);
    if (this.handles.has(id)) return Promise.resolve();
    const existing = this.pending.get(id);
    if (existing) return existing;
    const generation = ++this.generation;
    const operation = this.bindings
      .read(id)
      .then((value) => {
        const handle = nativeHandle(value);
        if (generation === this.generation) this.handles.set(id, handle);
      })
      .finally(() => {
        if (this.pending.get(id) === operation) this.pending.delete(id);
      });
    this.pending.set(id, operation);
    return operation;
  }
  retain(id: string, handle: BrowserMarkdownHandle): void {
    ++this.generation;
    this.handles.set(bindingId(id), nativeHandle(handle));
  }
  /** Commit selection only after the old source's draft has been acknowledged. */
  select(id: string): void {
    bindingId(id);
    if (!this.handles.has(id)) return;
    ++this.generation;
    for (const key of this.handles.keys())
      if (key !== id) this.handles.delete(key);
  }
  reconnect(id: string): Promise<void> {
    bindingId(id);
    const handle = this.handles.get(id);
    if (!handle)
      return Promise.reject(
        fail(
          "The remembered files are still opening. Wait for Continue to become available, then try again.",
          "source",
        ),
      );
    // Invoke during the trusted click, before even a permission query/IDB await.
    // requestPermission returns directly without a prompt when access remains granted.
    const requested = handle.requestPermission
      ? handle.requestPermission({ mode: "readwrite" })
      : (handle.queryPermission?.({ mode: "readwrite" }) ??
        Promise.resolve("granted"));
    return requested
      .catch((error: unknown) => {
        if (
          error instanceof DOMException &&
          (error.name === "SecurityError" || error.name === "NotAllowedError")
        )
          throw fail(
            "Use Reconnect files to allow editing in the browser prompt; your draft is unchanged.",
            "permission",
          );
        throw error;
      })
      .then((state) => {
        if (state !== "granted")
          throw fail(
            "File editing was not allowed. Reconnect files to save; your draft is unchanged.",
            "permission",
          );
      });
  }
  clear(): void {
    ++this.generation;
    this.handles.clear();
    this.pending.clear();
  }
}

export async function chooseBrowserSource(
  mode: "file" | "folder" | "create",
  bindings: BrowserSourceBindings = new IndexedDbBrowserSources(),
  access?: BrowserSourceAccess,
): Promise<string | null> {
  const host = window as unknown as {
    showDirectoryPicker?(options: {
      mode: "readwrite";
    }): Promise<BrowserMarkdownDirectory>;
    showOpenFilePicker?(options: object): Promise<BrowserMarkdownFile[]>;
    showSaveFilePicker?(options: object): Promise<BrowserMarkdownFile>;
  };
  try {
    let handle: BrowserMarkdownHandle | undefined;
    const types = [
      { description: "Markdown", accept: { "text/markdown": [".md"] } },
    ];
    if (mode === "folder")
      handle = await host.showDirectoryPicker?.({ mode: "readwrite" });
    else if (mode === "create")
      handle = await host.showSaveFilePicker?.({
        suggestedName: "note.md",
        types,
      });
    else
      handle = (
        await host.showOpenFilePicker?.({
          multiple: false,
          mode: "readwrite",
          types,
        })
      )?.[0];
    if (!handle)
      throw fail(
        "This browser cannot edit local files directly. Open AIC in a browser with file access support.",
      );
    if (handle.kind === "file") validateMarkdownPath(handle.name);
    await permission(handle, "readwrite", true);
    const id = `browser-${crypto.randomUUID()}`;
    await bindings.write(id, handle);
    access?.retain(id, handle);
    return id;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    )
      return null;
    throw error;
  }
}
export function reconnectBrowserSource(
  id: string,
  access: BrowserSourceAccess,
): Promise<void> {
  return access.reconnect(id);
}

async function maybeEntry<T>(open: () => Promise<T>): Promise<T | null> {
  try {
    return await open();
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

/**
 * One worker owner of the one note file. A connected folder contributes only
 * its `aic.md`: no other file or folder in it is read, listed or written, so
 * notes and `.aic` metadata of the earlier per-page layout stay as they are.
 */
export class BrowserMarkdownStorage {
  private observed: Observation | null = null;
  constructor(
    private readonly local: LocalStorage,
    private readonly bindings: BrowserSourceBindings = new IndexedDbBrowserSources(),
  ) {}
  async location(): Promise<BrowserFileLocation> {
    const value = (await this.local.get(FILE_SOURCE_KEY))[FILE_SOURCE_KEY];
    if (value === undefined || value === null) return { kind: "unselected" };
    if (
      !value ||
      typeof value !== "object" ||
      !("kind" in value) ||
      !("id" in value) ||
      !("name" in value) ||
      (value.kind !== "file" && value.kind !== "directory") ||
      typeof value.name !== "string"
    )
      throw fail(
        "Remembered file location is invalid. Open the original file or folder again.",
        "invalid",
      );
    return { kind: value.kind, id: bindingId(value.id), name: value.name };
  }
  async assertSource(expected?: string): Promise<void> {
    const location = await this.location();
    if (location.id !== expected)
      throw fail(
        "The selected files changed in another panel. Reopen the current files before editing.",
        "source",
      );
  }
  private async handle(id: string): Promise<BrowserMarkdownHandle> {
    return nativeHandle(await this.bindings.read(bindingId(id)));
  }
  async access(): Promise<{ read: PermissionState; write: PermissionState }> {
    const source = await this.location();
    if (!source.id)
      throw fail("Choose a Markdown file or folder first.", "source");
    const root =
      this.observed?.sourceId === source.id
        ? this.observed.root
        : await this.handle(source.id);
    const [read, write] = await Promise.all([
      root.queryPermission?.({ mode: "read" }) ?? ("granted" as const),
      root.queryPermission?.({ mode: "readwrite" }) ?? ("granted" as const),
    ]);
    return { read, write };
  }
  async connect(id: string): Promise<void> {
    const handle = await this.handle(bindingId(id));
    await permission(handle, "readwrite");
    await this.inspect(id, handle);
    await this.local.set({
      [FILE_SOURCE_KEY]: { id, kind: handle.kind, name: handle.name },
    });
  }
  snapshot(): BrowserNote {
    if (!this.observed) throw fail("Open the original files first.", "source");
    return { ...this.observed.note };
  }
  get legacyNotes(): boolean {
    return !!this.observed?.legacyNotes;
  }
  /** `refresh` reads the note file again; otherwise only access is checked. */
  async read(refresh = true): Promise<BrowserNote> {
    const location = await this.location();
    if (location.kind === "unselected")
      throw fail("Open a Markdown file or folder to begin.", "source");
    const observed =
      this.observed?.sourceId === location.id ? this.observed : null;
    try {
      if (!refresh && observed) {
        await permission(observed.root, "read");
        if (observed.root.kind === "file") await observed.root.getFile();
        return this.snapshot();
      }
      return await this.inspect(
        location.id!,
        observed?.root ?? (await this.handle(location.id!)),
      );
    } catch (error) {
      if (error instanceof BrowserFileError) throw error;
      throw fail(
        missing(error)
          ? "The original file or folder was moved or deleted. It was not recreated."
          : "Could not read the original files. Reconnect file access and try again.",
      );
    }
  }
  private async inspect(
    sourceId: string,
    root: BrowserMarkdownHandle,
  ): Promise<BrowserNote> {
    await permission(root, "read");
    const filePath =
      root.kind === "file" ? validateMarkdownPath(root.name) : NOTE_FILE;
    const handle =
      root.kind === "file"
        ? root
        : await maybeEntry(() => root.getFileHandle(NOTE_FILE));
    // A missing note file is an empty note; viewing it creates nothing.
    const markdown = handle ? await readText(handle) : "";
    const note: BrowserNote = {
      id: `file-${(await digest(filePath)).slice(0, 32)}`,
      filePath,
      markdown,
      revision: revision(await digest(markdown)),
    };
    const legacyNotes =
      root.kind === "directory" &&
      !!(await maybeEntry(() => root.getDirectoryHandle(".aic")));
    this.observed = { sourceId, root, handle, note, legacyNotes };
    return { ...note };
  }
  /** Compare-and-swap of the whole note file; nothing else is written. */
  async save(
    id: string,
    markdown: string,
    expectedRevision: number,
  ): Promise<BrowserNote> {
    validateSave(id, markdown, expectedRevision);
    const location = await this.location();
    const observed = this.observed;
    if (!observed || observed.sourceId !== location.id)
      throw fail("Reopen the files before saving.", "source");
    if (id !== observed.note.id)
      throw new LibraryError("invalid", "Invalid browser note data.");
    if (expectedRevision !== observed.note.revision)
      throw new LibraryError(
        "conflict",
        "This note changed elsewhere. Reload it before saving.",
      );
    if (markdown !== observed.note.markdown) {
      await permission(observed.root, "readwrite");
      let handle = observed.handle;
      if (!handle) {
        if (observed.root.kind !== "directory")
          throw fail("Reopen the files before saving.", "source");
        handle = await observed.root.getFileHandle(NOTE_FILE, { create: true });
      }
      // A file another window created meanwhile is not empty: that is a conflict.
      await writeText(
        handle,
        markdown,
        observed.handle ? observed.note.markdown : null,
      );
      observed.handle = handle;
    }
    observed.note = {
      ...observed.note,
      markdown,
      revision: revision(await digest(markdown)),
    };
    return { ...observed.note };
  }
}
