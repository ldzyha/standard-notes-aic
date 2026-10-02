import { BrowserFileError } from "./file-errors";
import {
  normalizeDomainOrigin,
  normalizePageUrl,
  validateBrowserLibrary,
  validateMarkdownPath,
  type BrowserLibrary,
} from "./library";
import { FolderIgnore } from "../pwa/folder-ignore";

export const FILE_SOURCE_KEY = "aic-browser-markdown-source";
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
  warnings?: string[];
  scan?: BrowserScan;
}
export interface BrowserScan {
  id: string;
  sourceId: string;
  phase: "scanning" | "reading" | "complete" | "cancelled" | "failed";
  inspected: number;
  found: number;
  loaded: number;
  path: string;
  revision: number;
  error?: string;
}
export interface ScanNoteSummary {
  id: string;
  filePath: string;
  title: string;
  url: string;
  scope: "current" | "shared" | "global";
}
export interface BrowserScanStatus {
  scan: BrowserScan | null;
  notes: ScanNoteSummary[];
  next: number;
}
const SCAN_IO_TIMEOUT_MS = 30_000;
class ScanCancelled extends Error {}
/** A scan owns only local candidates until its caller publishes the observation. */
class ScanJob {
  readonly controller = new AbortController();
  readonly notes: ScanNoteSummary[] = [];
  readonly warnings: string[] = [];
  readonly progress: BrowserScan;
  private yieldAt = Date.now();
  constructor(sourceId: string) {
    this.progress = {
      id: crypto.randomUUID(),
      sourceId,
      phase: "scanning",
      inspected: 0,
      found: 0,
      loaded: 0,
      path: "",
      revision: 1,
    };
  }
  check(): void {
    if (this.controller.signal.aborted) throw new ScanCancelled();
  }
  update(values: Partial<BrowserScan>): void {
    this.check();
    Object.assign(this.progress, values);
    this.progress.revision += 1;
  }
  cancel(): void {
    if (
      this.progress.phase === "scanning" ||
      this.progress.phase === "reading"
    ) {
      this.progress.phase = "cancelled";
      this.progress.revision += 1;
      this.controller.abort();
    }
  }
  async yield(): Promise<void> {
    this.check();
    if (
      Date.now() - this.yieldAt >= 16 ||
      this.progress.inspected % 256 === 0
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.yieldAt = Date.now();
      this.check();
    }
  }
}
/** Native filesystem promises cannot be cancelled; race them and ignore late results. */
function scanRead<T>(
  job: ScanJob | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!job) return operation();
  job.check();
  return new Promise<T>((resolve, reject) => {
    const signal = job.controller.signal;
    let settled = false;
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(new ScanCancelled());
    const timer = setTimeout(
      () =>
        finish(
          fail(
            `Reading ${job.progress.path || "folder"} timed out. Other notes remain available.`,
          ),
        ),
      SCAN_IO_TIMEOUT_MS,
    );
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        job.check();
        return operation();
      })
      .then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
  });
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
type IndexEntry = {
  id: string;
  path: string;
  scope: "current" | "shared" | "global";
  url?: string;
  title?: string;
  origin?: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  fingerprint: string;
};
interface LinksIndex {
  format: "aic-markdown-links";
  version: 1;
  entries: IndexEntry[];
}
interface ObservedFile {
  path: string;
  handle: BrowserMarkdownFile;
  text: string;
  fingerprint: string;
}
interface Observation {
  sourceId: string;
  root: BrowserMarkdownHandle;
  library: BrowserLibrary;
  files: Map<string, ObservedFile>;
  index: LinksIndex;
  indexText: string | null;
  pendingText: string | null;
  pendingBlocked: boolean;
}
interface PendingIndex {
  format: "aic-links-pending";
  version: 1;
  baseText: string | null;
  nextText: string;
  writes: { path: string; fingerprint: string }[];
}
const encoder = new TextEncoder();
const empty = (): BrowserLibrary => ({
  version: 3,
  notes: [],
  history: [],
  domains: [],
  global: null,
});
const emptyIndex = (): LinksIndex => ({
  format: "aic-markdown-links",
  version: 1,
  entries: [],
});
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
async function readText(
  handle: BrowserMarkdownFile,
  max = 512 * 1024,
  job?: ScanJob,
): Promise<string> {
  await scanRead(job, () => permission(handle, "read"));
  const file = await scanRead(job, () => handle.getFile());
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > max)
    throw fail("This Markdown file is too large to open.", "invalid");
  const text = file.arrayBuffer
    ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await scanRead(job, () => file.arrayBuffer!()),
      )
    : await scanRead(job, () => file.text());
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
    const actual = await readText(
      handle,
      Math.max(1024 * 1024, encoder.encode(text).length),
    );
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

async function pathHandle(
  root: BrowserMarkdownDirectory,
  path: string,
  create = false,
): Promise<BrowserMarkdownFile> {
  const parts = path.split("/");
  let directory = root;
  for (const name of parts.slice(0, -1))
    directory = await directory.getDirectoryHandle(name, { create });
  return directory.getFileHandle(parts.at(-1)!, { create });
}
async function maybeFile(
  root: BrowserMarkdownDirectory,
  path: string,
): Promise<BrowserMarkdownFile | null> {
  try {
    return await pathHandle(root, path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
function parseIndex(text: string | null): LinksIndex {
  if (text === null) return emptyIndex();
  try {
    const value = JSON.parse(text) as LinksIndex;
    if (
      value.format !== "aic-markdown-links" ||
      value.version !== 1 ||
      !Array.isArray(value.entries)
    )
      throw new Error();
    const paths = new Set<string>();
    const ids = new Set<string>();
    const urls = new Set<string>();
    const origins = new Set<string>();
    let global = false;
    for (const item of value.entries) {
      validateMarkdownPath(item.path);
      if (
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 128 ||
        paths.has(item.path) ||
        ids.has(item.id) ||
        !Number.isSafeInteger(item.revision) ||
        item.revision < 1 ||
        !Number.isSafeInteger(item.createdAt) ||
        item.createdAt < 0 ||
        !Number.isSafeInteger(item.updatedAt) ||
        item.updatedAt < item.createdAt ||
        !/^[a-f0-9]{64}$/u.test(item.fingerprint)
      )
        throw new Error();
      paths.add(item.path);
      ids.add(item.id);
      if (item.scope === "current") {
        if (
          typeof item.title !== "string" ||
          encoder.encode(item.title).length > 1024
        )
          throw new Error();
        if (item.url) {
          if (normalizePageUrl(item.url) !== item.url || urls.has(item.url))
            throw new Error();
          urls.add(item.url);
        }
      } else if (item.scope === "shared") {
        if (!item.origin || origins.has(normalizeDomainOrigin(item.origin)))
          throw new Error();
        origins.add(item.origin);
      } else if (item.scope === "global") {
        if (global) throw new Error();
        global = true;
      } else throw new Error();
    }
    return value;
  } catch {
    throw fail(
      "The folder's .aic/links.json is invalid. It was not overwritten.",
      "invalid",
    );
  }
}

/** One worker owner; Markdown files are authoritative and never replaced by a cache. */
export class BrowserMarkdownStorage {
  private observed: Observation | null = null;
  private scanJob: ScanJob | null = null;
  readonly warnings: string[] = [];
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
  scanStatus(id?: string, after = 0): BrowserScanStatus {
    const job = this.scanJob;
    if (!job) return { scan: null, notes: [], next: 0 };
    const offset =
      id === job.progress.id && Number.isSafeInteger(after) && after >= 0
        ? Math.min(after, job.notes.length)
        : 0;
    const notes = job.notes.slice(offset, offset + 128);
    return {
      scan: { ...job.progress },
      notes: structuredClone(notes),
      next: offset + notes.length,
    };
  }
  cancelScan(id: string): BrowserScanStatus {
    if (this.scanJob?.progress.id === id) this.scanJob.cancel();
    return this.scanStatus(id);
  }
  private beginScan(sourceId: string): ScanJob {
    this.scanJob?.cancel();
    this.scanJob = new ScanJob(sourceId);
    return this.scanJob;
  }
  private scanFailed(job: ScanJob, error: unknown): void {
    if (this.scanJob !== job || error instanceof ScanCancelled) return;
    job.update({
      phase: "failed",
      error: error instanceof Error ? error.message : "Could not read files.",
    });
  }
  async connect(id: string): Promise<void> {
    const job = this.beginScan(bindingId(id));
    const previous = this.observed;
    try {
      const handle = await scanRead(job, () => this.handle(id));
      job.update({ path: handle.name });
      await scanRead(job, () => permission(handle, "readwrite"));
      await this.inspect(id, handle, job, previous?.sourceId === id);
      if (this.scanJob !== job) throw new ScanCancelled();
      await this.local.set({
        [FILE_SOURCE_KEY]: { id, kind: handle.kind, name: handle.name },
      });
    } catch (error) {
      if (this.scanJob === job) this.observed = previous;
      if (error instanceof ScanCancelled) return;
      this.scanFailed(job, error);
      throw error;
    }
  }
  snapshot(): BrowserLibrary {
    if (!this.observed) throw fail("Open the original files first.", "source");
    return structuredClone(this.observed.library);
  }
  async read(refresh = true): Promise<BrowserLibrary> {
    const location = await this.location();
    if (location.kind === "unselected")
      throw fail("Open a Markdown file or folder to begin.", "source");
    let job: ScanJob | undefined;
    try {
      if (!refresh && this.observed && this.observed.sourceId === location.id) {
        await permission(this.observed.root, "read");
        if (this.observed.root.kind === "file")
          await this.observed.root.getFile();
        return this.snapshot();
      }
      job = this.beginScan(location.id!);
      const handle = await scanRead(job, () => this.handle(location.id!));
      job.update({ path: handle.name });
      return await this.inspect(location.id!, handle, job, true);
    } catch (error) {
      if (job) this.scanFailed(job, error);
      if (
        error instanceof ScanCancelled &&
        this.observed?.sourceId === location.id
      )
        return this.snapshot();
      if (error instanceof BrowserFileError) throw error;
      throw fail(
        error instanceof ScanCancelled
          ? "Folder scan stopped. Scan again to open notes."
          : missing(error)
            ? "The original file or folder was moved or deleted. It was not recreated."
            : "Could not read the original files. Reconnect file access and try again.",
      );
    }
  }
  private async restoreIndex(
    root: BrowserMarkdownDirectory,
    indexText: string | null,
    mutate = false,
    job?: ScanJob,
  ): Promise<{
    index: LinksIndex;
    indexText: string | null;
    pendingText: string | null;
    pendingBlocked: boolean;
  }> {
    const pendingHandle = await scanRead(job, () =>
      maybeFile(root, ".aic/links.pending.json"),
    );
    const pendingText = pendingHandle
      ? await readText(pendingHandle, 3 * 1024 * 1024, job)
      : null;
    if (!pendingText)
      return {
        index: parseIndex(indexText),
        indexText,
        pendingText,
        pendingBlocked: false,
      };
    let pending: PendingIndex;
    try {
      pending = JSON.parse(pendingText) as PendingIndex;
      if (
        pending.format !== "aic-links-pending" ||
        pending.version !== 1 ||
        (pending.baseText !== null && typeof pending.baseText !== "string") ||
        typeof pending.nextText !== "string" ||
        !Array.isArray(pending.writes)
      )
        throw new Error();
      parseIndex(pending.nextText);
      for (const write of pending.writes) {
        validateMarkdownPath(write.path);
        if (!/^[a-f0-9]{64}$/u.test(write.fingerprint)) throw new Error();
      }
    } catch {
      throw fail(
        "The pending folder metadata is invalid. It was preserved for recovery.",
        "invalid",
      );
    }
    if (indexText === pending.nextText) {
      if (!mutate)
        return {
          index: parseIndex(indexText),
          indexText,
          pendingText,
          pendingBlocked: false,
        };
      try {
        await writeText(pendingHandle!, "", pendingText);
        return {
          index: parseIndex(indexText),
          indexText,
          pendingText: "",
          pendingBlocked: false,
        };
      } catch {
        /* Already committed; only journal cleanup remains. */
      }
      return {
        index: parseIndex(indexText),
        indexText,
        pendingText,
        pendingBlocked: false,
      };
    }
    const matchesBase =
      indexText === pending.baseText ||
      (pending.baseText === null && indexText === "");
    let committed = matchesBase;
    for (const write of pending.writes) {
      job?.update({ phase: "reading", path: write.path });
      try {
        const handle = await scanRead(job, () => maybeFile(root, write.path));
        if (
          !handle ||
          (await scanRead(job, async () =>
            digest(await readText(handle, undefined, job)),
          )) !== write.fingerprint
        )
          committed = false;
      } catch (error) {
        if (error instanceof ScanCancelled) throw error;
        committed = false;
      }
    }
    if (!matchesBase) {
      (job?.warnings ?? this.warnings).push(
        "Folder links changed while a save was pending. Reconcile .aic/links.pending.json before changing links; Markdown files were preserved.",
      );
      return {
        index: parseIndex(indexText),
        indexText,
        pendingText,
        pendingBlocked: true,
      };
    }
    if (!committed) {
      // A body write failed. The unchanged index remains authoritative; the
      // existing draft journal owns unsaved text, never this metadata journal.
      return {
        index: parseIndex(
          indexText === "" && pending.baseText === null ? null : indexText,
        ),
        indexText,
        pendingText,
        pendingBlocked: false,
      };
    }
    const index = parseIndex(pending.nextText);
    if (!mutate) {
      (job?.warnings ?? this.warnings).push(
        "Notes are saved. Folder link metadata will be finalized with the next save.",
      );
      return { index, indexText, pendingText, pendingBlocked: false };
    }
    try {
      const handle =
        (await maybeFile(root, ".aic/links.json")) ??
        (await pathHandle(root, ".aic/links.json", true));
      await writeText(handle, pending.nextText, indexText);
      indexText = pending.nextText;
      try {
        await writeText(pendingHandle!, "", pendingText);
        return { index, indexText, pendingText: "", pendingBlocked: false };
      } catch {
        /* Metadata already committed. */
      }
    } catch {
      (job?.warnings ?? this.warnings).push(
        "Notes are saved. Folder link metadata is queued for retry.",
      );
    }
    return { index, indexText, pendingText, pendingBlocked: false };
  }
  private async inspect(
    sourceId: string,
    root: BrowserMarkdownHandle,
    job: ScanJob,
    allowEmptyCancellation: boolean,
  ): Promise<BrowserLibrary> {
    const previous =
      this.observed?.sourceId === sourceId ? this.observed : null;
    const library = empty();
    const files = new Map<string, ObservedFile>();
    let restored = {
      index: emptyIndex(),
      indexText: null as string | null,
      pendingText: null as string | null,
      pendingBlocked: false,
    };
    const ignore = new FolderIgnore();
    let metadataReady = false;
    let incomplete = false;
    const check = () => {
      job.check();
      if (this.scanJob !== job) throw new ScanCancelled();
    };
    try {
      await scanRead(job, () => permission(root, "read"));
      if (root.kind === "directory") {
        job.update({ phase: "reading", path: ".aic/links.json" });
        const metadata = await scanRead(job, () =>
          maybeFile(root, ".aic/links.json"),
        );
        const indexText = metadata
          ? await readText(metadata, 1024 * 1024, job)
          : null;
        restored = await this.restoreIndex(root, indexText, false, job);
      }
      check();
      metadataReady = true;
      const links = new Map(
        restored.index.entries.map((entry) => [entry.path, entry]),
      );
      const open = async (path: string, handle: BrowserMarkdownFile) => {
        job.update({ phase: "reading", path, found: job.progress.found + 1 });
        try {
          const text = await readText(handle, undefined, job);
          const fingerprint = await scanRead(job, () => digest(text));
          const link = links.get(path);
          const id =
            link?.id ??
            `file-${(await scanRead(job, () => digest(path))).slice(0, 32)}`;
          check();
          const fields = {
            id,
            markdown: text,
            filePath: path,
            revision:
              link?.fingerprint === fingerprint
                ? link.revision
                : revision(fingerprint),
            createdAt: link?.createdAt ?? 0,
            updatedAt: link?.updatedAt ?? 0,
          };
          const candidate = empty();
          if (link?.scope === "global")
            candidate.global = { ...fields, scope: "global" };
          else if (link?.scope === "shared")
            candidate.domains.push({ ...fields, origin: link.origin! });
          else
            candidate.notes.push({
              ...fields,
              url: link?.url ?? "",
              title: link?.title ?? path.split("/").at(-1)!,
            });
          // Invalid standalone records must not discard already usable notes.
          validateBrowserLibrary(candidate);
          files.set(id, { path, handle, text, fingerprint });
          library.notes.push(...candidate.notes);
          library.domains.push(...candidate.domains);
          if (candidate.global) library.global = candidate.global;
          job.notes.push({
            id,
            filePath: path,
            title: link?.title ?? path.split("/").at(-1)!,
            url: link?.url ?? "",
            scope: link?.scope ?? "current",
          });
          job.update({ loaded: job.progress.loaded + 1 });
        } catch (error) {
          if (error instanceof ScanCancelled || root.kind === "file")
            throw error;
          incomplete = true;
          job.warnings.push(
            `Could not open ${path}: ${error instanceof Error ? error.message : "file unavailable"}`,
          );
        }
        await job.yield();
      };
      if (root.kind === "file") {
        job.update({ inspected: 1 });
        await open(validateMarkdownPath(root.name), root);
      } else {
        const walk = async (
          directory: BrowserMarkdownDirectory,
          prefix: string,
        ) => {
          job.update({ phase: "reading", path: prefix || root.name });
          try {
            for (const name of [".gitignore", ".ignore"] as const) {
              const rule = await scanRead(job, () =>
                maybeFile(directory, name),
              );
              if (rule)
                ignore.addRules(
                  prefix,
                  name,
                  await readText(rule, 64 * 1024, job),
                );
            }
          } catch (error) {
            if (error instanceof ScanCancelled) throw error;
            incomplete = true;
            job.warnings.push(
              `Could not read ignore rules in ${prefix || root.name}; that folder was skipped.`,
            );
            return;
          }
          let iterator:
            ReturnType<BrowserMarkdownDirectory["values"]> | undefined;
          try {
            iterator = directory.values();
            while (true) {
              job.update({ phase: "scanning", path: prefix || root.name });
              const result = await scanRead(job, () => iterator!.next());
              check();
              if (result.done) break;
              const handle = result.value;
              const path = prefix ? `${prefix}/${handle.name}` : handle.name;
              job.update({ inspected: job.progress.inspected + 1, path });
              await job.yield();
              if (
                handle.name === ".aic" ||
                ignore.isIgnored(path, handle.kind === "directory")
              )
                continue;
              if (handle.kind === "directory") await walk(handle, path);
              else if (/\.md$/iu.test(handle.name)) {
                try {
                  await open(validateMarkdownPath(path), handle);
                } catch (error) {
                  if (error instanceof ScanCancelled) throw error;
                  incomplete = true;
                  job.warnings.push(
                    `Could not open ${path}: ${error instanceof Error ? error.message : "file unavailable"}`,
                  );
                }
              }
            }
          } catch (error) {
            if (error instanceof ScanCancelled) throw error;
            incomplete = true;
            job.warnings.push(
              `Could not read folder ${prefix || root.name}: ${error instanceof Error ? error.message : "folder unavailable"}`,
            );
          } finally {
            // A stalled native iterator must not hold cancellation hostage.
            try {
              void iterator?.return?.().catch(() => {});
            } catch {
              /* Best effort disposal. */
            }
          }
        };
        await walk(root, "");
      }
      check();
      job.update({ phase: "complete" });
    } catch (error) {
      if (!(error instanceof ScanCancelled)) throw error;
      if (this.scanJob !== job || (!allowEmptyCancellation && files.size === 0))
        throw error;
      incomplete = true;
      job.warnings.push(
        "Folder scan stopped. Loaded notes are available; scan again to find the rest.",
      );
    }
    if (this.scanJob !== job) throw new ScanCancelled();
    if (!metadataReady) {
      // Do not replace validated metadata with an empty index when cancelled before it was read.
      if (previous) return this.snapshot();
      throw new ScanCancelled();
    }
    if (incomplete && previous) {
      // Unvisited originals keep their exact prior baseline. A later edit still
      // checks current disk bytes and cannot recreate an externally deleted file.
      const usedPaths = new Set([...files.values()].map((file) => file.path));
      for (const record of [
        ...previous.library.notes,
        ...previous.library.domains,
        ...(previous.library.global ? [previous.library.global] : []),
      ]) {
        const file = previous.files.get(record.id);
        if (!file || files.has(record.id) || usedPaths.has(file.path)) continue;
        if (ignore.isIgnored(file.path)) continue;
        const oldLink = previous.index.entries.find(
          (entry) => entry.path === file.path,
        );
        const newLink = restored.index.entries.find(
          (entry) => entry.path === file.path,
        );
        if (JSON.stringify(oldLink) !== JSON.stringify(newLink)) {
          job.warnings.push(
            `Links for ${file.path} changed elsewhere. Scan again to load its current association.`,
          );
          continue;
        }
        if (
          "url" in record &&
          record.url &&
          library.notes.some((note) => note.url === record.url)
        )
          continue;
        if (
          "origin" in record &&
          library.domains.some((note) => note.origin === record.origin)
        )
          continue;
        if ("scope" in record && library.global) continue;
        files.set(record.id, file);
        if ("url" in record) library.notes.push(record);
        else if ("origin" in record) library.domains.push(record);
        else library.global = record;
      }
    }
    if (incomplete && files.size === 0 && !allowEmptyCancellation)
      throw fail(
        job.warnings[0] ??
          "No readable notes were found before scanning stopped. Scan again to reconnect this folder.",
      );
    const validated = validateBrowserLibrary(library);
    this.observed = { sourceId, root, library: validated, files, ...restored };
    this.warnings.splice(0, this.warnings.length, ...job.warnings);
    return structuredClone(validated);
  }
  async write(next: BrowserLibrary): Promise<void> {
    const root = this.observed?.root;
    if (!root || root.kind === "file") return this.writeObserved(next);
    await permission(root, "readwrite");
    // Hold one native exclusive writer for the entire multi-file transaction.
    // It is a zero-content lock file, not the metadata journal or user document.
    const lockHandle = await pathHandle(root, ".aic/write.lock", true);
    let lock: Awaited<ReturnType<BrowserMarkdownFile["createWritable"]>>;
    try {
      lock = await lockHandle.createWritable({
        keepExistingData: true,
        mode: "exclusive",
      });
    } catch {
      throw fail(
        "Another AIC window is saving this folder. Retry after it finishes.",
        "conflict",
      );
    }
    try {
      await this.writeObserved(next);
    } finally {
      try {
        if (lock.abort) await lock.abort();
        else await lock.close();
      } catch {
        /* Never replace an acknowledged save or its original error with lock cleanup. */
      }
    }
  }
  private async writeObserved(next: BrowserLibrary): Promise<void> {
    const location = await this.location();
    const observed = this.observed;
    if (!observed || observed.sourceId !== location.id)
      throw fail("Reopen the files before saving.", "source");
    const validated = validateBrowserLibrary(next);
    const records = [
      ...validated.notes.map((note) => ({
        ...note,
        scope: "current" as const,
      })),
      ...validated.domains.map((note) => ({
        ...note,
        scope: "shared" as const,
      })),
      ...(validated.global ? [validated.global] : []),
    ];
    if (observed.root.kind === "file") {
      if (
        records.length !== 1 ||
        records[0]!.id !== observed.library.notes[0]?.id ||
        records[0]!.scope !== "current" ||
        (records[0] as { url?: string }).url
      )
        throw fail(
          "Open a folder to create more notes or save portable URL links.",
          "source",
        );
      const record = records[0]!;
      const original = observed.files.get(record.id)!;
      if (record.markdown !== original.text)
        await writeText(original.handle, record.markdown, original.text);
      const fingerprint = await digest(record.markdown);
      observed.files.set(record.id, {
        ...original,
        text: record.markdown,
        fingerprint,
      });
      validated.notes[0]!.revision = revision(fingerprint);
      observed.library = validated;
      return;
    }
    const root = observed.root;
    await permission(root, "readwrite");
    const currentIndex = await maybeFile(root, ".aic/links.json");
    let actualIndexText = currentIndex
      ? await readText(currentIndex, 1024 * 1024)
      : null;
    const restored = await this.restoreIndex(root, actualIndexText, true);
    if (restored.pendingBlocked)
      throw fail(
        "Folder metadata changed during a pending save. Reconcile the pending links before editing.",
        "conflict",
      );
    if (JSON.stringify(restored.index) !== JSON.stringify(observed.index))
      throw fail(
        "Folder links changed elsewhere. Reopen the folder before saving.",
        "conflict",
      );
    actualIndexText = restored.indexText;
    observed.indexText = actualIndexText;
    observed.pendingText = restored.pendingText;
    let indexEntries: IndexEntry[] = observed.index.entries.filter(
      (entry) => !observed.files.has(entry.id),
    );
    const changes: {
      id: string;
      path: string;
      text: string;
      original?: ObservedFile;
      handle?: BrowserMarkdownFile;
    }[] = [];
    const paths = new Map<string, string>();
    for (const record of records) {
      const original = observed.files.get(record.id);
      const path = validateMarkdownPath(
        record.filePath ??
          (record.scope === "current"
            ? `pages/${record.id}.md`
            : record.scope === "shared"
              ? `shared/${record.id}.md`
              : "global.md"),
      );
      if (original && original.path !== path)
        throw fail(
          "Renaming original files is not supported here. Save a copy instead.",
          "source",
        );
      paths.set(record.id, path);
      if (!original) {
        const superseded = indexEntries.filter(
          (entry) =>
            entry.path === path ||
            (entry.scope === "global" && record.scope === "global") ||
            (entry.scope === "shared" &&
              record.scope === "shared" &&
              entry.origin === record.origin) ||
            (entry.scope === "current" &&
              record.scope === "current" &&
              !!record.url &&
              entry.url === record.url),
        );
        for (const entry of superseded) {
          if (await maybeFile(root, entry.path))
            throw fail(
              "That page or scope is already linked to an excluded file. Open the original file instead.",
              "conflict",
            );
          // Only explicit creation can replace a confirmed-missing association.
          // Existing-note saves always keep their original handle and fail if missing.
          indexEntries = indexEntries.filter((item) => item !== entry);
        }
        if (await maybeFile(root, path))
          throw fail(
            `The file ${path} already exists. Open it instead.`,
            "conflict",
          );
        changes.push({ id: record.id, path, text: record.markdown });
      } else if (record.markdown !== original.text) {
        if ((await readText(original.handle)) !== original.text)
          throw fail(
            "This file changed on disk. Keep or export your draft before reopening it.",
            "conflict",
          );
        changes.push({
          id: record.id,
          path,
          text: record.markdown,
          original,
          handle: original.handle,
        });
      }
      indexEntries.push({
        id: record.id,
        path,
        scope: record.scope,
        ...(record.scope === "current"
          ? { url: record.url, title: record.title }
          : record.scope === "shared"
            ? { origin: record.origin }
            : {}),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        revision: record.revision,
        fingerprint:
          original?.text === record.markdown
            ? original.fingerprint
            : await digest(record.markdown),
      });
    }
    const index: LinksIndex = {
      format: "aic-markdown-links",
      version: 1,
      entries: indexEntries,
    };
    const text = JSON.stringify(index, null, 2);
    parseIndex(text); // Detect path/scope collisions before creating or changing files.
    if (encoder.encode(text).length > 1024 * 1024)
      throw fail(
        "Folder link metadata exceeds 1 MiB. Open the individual file to edit it directly.",
        "invalid",
      );
    const pending: PendingIndex = {
      format: "aic-links-pending",
      version: 1,
      baseText: actualIndexText,
      nextText: text,
      writes: changes.map((item) => ({
        path: item.path,
        fingerprint: indexEntries.find((entry) => entry.id === item.id)!
          .fingerprint,
      })),
    };
    const pendingText = JSON.stringify(pending);
    if (encoder.encode(pendingText).length > 3 * 1024 * 1024)
      throw fail(
        "Pending folder metadata exceeds 3 MiB. No note content was changed.",
        "invalid",
      );
    const pendingHandle =
      (await maybeFile(root, ".aic/links.pending.json")) ??
      (await pathHandle(root, ".aic/links.pending.json", true));
    await writeText(pendingHandle, pendingText, restored.pendingText);
    observed.pendingText = pendingText;
    for (const change of changes) {
      change.handle ??= await pathHandle(root, change.path, true);
      await writeText(
        change.handle,
        change.text,
        change.original?.text ?? null,
      );
    }
    // Markdown + metadata intent are now durable. A final metadata write failure
    // must not pretend the body was lost or cause a retry to duplicate that note.
    for (const change of changes)
      observed.files.set(change.id, {
        path: change.path,
        handle: change.handle!,
        text: change.text,
        fingerprint: indexEntries.find((entry) => entry.id === change.id)!
          .fingerprint,
      });
    for (const note of validated.notes) note.filePath = paths.get(note.id)!;
    for (const note of validated.domains) note.filePath = paths.get(note.id)!;
    if (validated.global)
      validated.global.filePath = paths.get(validated.global.id)!;
    observed.library = validated;
    observed.index = index;
    try {
      const indexHandle =
        currentIndex ?? (await pathHandle(root, ".aic/links.json", true));
      await writeText(indexHandle, text, actualIndexText);
      observed.indexText = text;
      try {
        await writeText(pendingHandle, "", pendingText);
        observed.pendingText = "";
      } catch {
        this.warnings.push(
          "Notes are saved. Completed folder metadata awaits cleanup.",
        );
      }
    } catch {
      const currentPending = await readText(pendingHandle, 3 * 1024 * 1024);
      const currentMetadata = await maybeFile(root, ".aic/links.json");
      const committedIndex = currentMetadata
        ? await readText(currentMetadata, 1024 * 1024)
        : null;
      if (currentPending !== pendingText && committedIndex !== text)
        throw fail(
          "The note body was saved but folder links changed concurrently. Keep your recovery copy and reopen the folder.",
          "conflict",
        );
      this.warnings.push(
        "Notes are saved. Folder link metadata is queued for retry.",
      );
    }
  }
}
