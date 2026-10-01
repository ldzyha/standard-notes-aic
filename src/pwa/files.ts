/** User-selected filesystem access. Note contents remain opaque bytes. */
import { MAX_VAULT_PLAINTEXT_BYTES } from "../browser/vault-crypto";
import { FolderIgnore, isHardExcludedPath } from "./folder-ignore";
import {
  MAX_PWA_ENTRIES,
  MAX_PWA_FILE_BYTES,
  createPwaFile,
  createWorkspace,
  fileBytes,
  serializePayload,
  validateRelativePath,
  type PwaFile,
} from "./model";

export interface PickedFiles {
  files: PwaFile[];
  directories: string[];
}

export interface FileSelectionOptions {
  markdownOnly?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: FileSelectionProgress) => void;
}

export interface FileSelectionProgress {
  phase: "scanning" | "reading";
  scanned: number;
  selected: number;
  read: number;
  total?: number;
}

const MAX_SCAN_ENTRIES = 5 * MAX_PWA_ENTRIES;
const MAX_RESTORE_ENTRIES = 60_000;
const READ_CONCURRENCY = 4;
const READ_TIMEOUT_MS = 30_000;
const IGNORE_FILES = [".gitignore", ".ignore"] as const;
const MAX_IGNORE_FILE_BYTES = 64 * 1024;
const MAX_IGNORE_TOTAL_BYTES = 1024 * 1024;
const MAX_IGNORE_FILES = 256;
const MAX_IGNORE_LINES = 10_000;
const DIRECTORY_PREFIX_SIZE = 64;

/** Filename filtering only; contents remain opaque bytes in this adapter. */
export function isMarkdownPath(path: string): boolean {
  return /\.md$/iu.test(path);
}

function scanLimit(): never {
  throw new Error(
    `The selection exceeds ${MAX_SCAN_ENTRIES.toLocaleString("en-US")} inspected entries after exclusions. Add folder rules to .gitignore or .ignore, or choose a smaller folder.`,
  );
}

function selectionLimit(options: FileSelectionOptions): never {
  throw new Error(
    options.markdownOnly
      ? `Choose at most ${MAX_PWA_ENTRIES} Markdown files.`
      : `Choose at most ${MAX_PWA_ENTRIES} files and folders.`,
  );
}

function restoreLimit(): never {
  throw new Error(
    `Folder export exceeds ${MAX_RESTORE_ENTRIES.toLocaleString("en-US")} restored files and folders.`,
  );
}

function abortError(): DOMException {
  return new DOMException("Opening files was canceled.", "AbortError");
}

function checkAbort(options: FileSelectionOptions): void {
  if (options.signal?.aborted) throw abortError();
}

/** Race pending platform I/O without pretending to cancel the underlying OS operation. */
function readOperation<T>(
  invoke: () => Promise<T>,
  options: FileSelectionOptions,
  path?: string,
): Promise<T> {
  checkAbort(options);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", aborted);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const aborted = () => fail(abortError());
    options.signal?.addEventListener("abort", aborted, { once: true });
    if (path !== undefined) {
      timer = setTimeout(
        () =>
          fail(
            new Error(
              `Reading ${path} took longer than 30 seconds. Check that the file is available on this device, then retry or choose a smaller folder.`,
            ),
          ),
        READ_TIMEOUT_MS,
      );
    }
    try {
      // Invoke synchronously so picker calls keep the originating user activation.
      invoke().then((value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }, fail);
    } catch (error) {
      fail(error);
    }
  });
}

class SelectionProgress {
  private readonly value: FileSelectionProgress = {
    phase: "scanning",
    scanned: 0,
    selected: 0,
    read: 0,
  };
  private active = true;
  private lastNotice = -Infinity;
  private lastYield = performance.now();
  private entriesSinceYield = 0;

  constructor(private readonly options: FileSelectionOptions) {
    this.emit(true);
  }

  private emit(force = false): void {
    if (!this.active || this.options.signal?.aborted) return;
    const now = performance.now();
    if (!force && now - this.lastNotice < 50) return;
    this.lastNotice = now;
    // Progress is advisory; a host's display callback cannot invalidate a selection.
    try {
      this.options.onProgress?.({ ...this.value });
    } catch {
      /* Host owns its UI. */
    }
  }

  async checkpoint(): Promise<void> {
    checkAbort(this.options);
    if (!this.active) return;
    const now = performance.now();
    if (++this.entriesSinceYield < 256 && now - this.lastYield < 16) return;
    this.entriesSinceYield = 0;
    this.lastYield = now;
    this.emit(true);
    await readOperation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      this.options,
    );
    checkAbort(this.options);
  }

  async scanned(selected: boolean): Promise<void> {
    this.value.scanned += 1;
    if (selected) this.value.selected += 1;
    this.emit();
    await this.checkpoint();
  }

  reading(total: number): void {
    this.value.phase = "reading";
    this.value.total = total;
    this.emit(true);
  }

  async read(): Promise<void> {
    this.value.read += 1;
    this.emit();
    await this.checkpoint();
  }

  finish(): void {
    checkAbort(this.options);
    this.emit(true);
    checkAbort(this.options);
    this.active = false;
  }

  stop(): void {
    this.active = false;
  }
}

/** Ignore files are bounded import configuration, never imported note content. */
class IgnoreReader {
  private files = 0;
  private bytes = 0;
  private lines = 0;

  async read(
    file: File,
    path: string,
    options: FileSelectionOptions,
  ): Promise<string> {
    checkAbort(options);
    if (++this.files > MAX_IGNORE_FILES)
      throw new Error(
        "A folder selection supports at most 256 applicable ignore files.",
      );
    if (file.size > MAX_IGNORE_FILE_BYTES)
      throw new Error(
        `Ignore file ${path} exceeds 64 KiB. Choose a smaller folder or simplify its rules.`,
      );
    this.bytes += file.size;
    if (this.bytes > MAX_IGNORE_TOTAL_BYTES)
      throw new Error("The selection exceeds 1 MiB of ignore rules.");
    const bytes = await readOperation(() => file.arrayBuffer(), options, path);
    if (bytes.byteLength !== file.size)
      throw new Error(`Ignore file ${path} changed while it was being read.`);
    checkAbort(options);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`Ignore file ${path} must contain UTF-8 text.`);
    }
    this.lines += text.split(/\r?\n/u).length;
    if (this.lines > MAX_IGNORE_LINES)
      throw new Error("The selection exceeds 10,000 lines of ignore rules.");
    return text;
  }
}

function folderPath(relative: string): { root: string; path: string } | null {
  const separator = relative.indexOf("/");
  return separator < 0
    ? null
    : {
        root: relative.slice(0, separator),
        path: relative.slice(separator + 1),
      };
}

async function inputFolderRules(
  files: FileList,
  options: FileSelectionOptions,
  progress: SelectionProgress,
): Promise<Map<string, FolderIgnore>> {
  const roots = new Map<string, FolderIgnore>();
  const candidates: {
    file: File;
    root: string;
    scope: string;
    path: string;
    name: (typeof IGNORE_FILES)[number];
  }[] = [];
  // A folder input is already enumerated by the browser. Inspect names without
  // allocating file bytes or charging excluded dependency trees to the quota.
  for (const file of files) {
    await progress.checkpoint();
    const entry = folderPath(file.webkitRelativePath);
    if (!entry || isHardExcludedPath(entry.path)) continue;
    const name = entry.path.split("/").at(-1)!;
    if (name !== ".gitignore" && name !== ".ignore") continue;
    const scope = entry.path.slice(0, -name.length).replace(/\/$/u, "");
    candidates.push({ file, ...entry, scope, name });
  }
  // Rules higher in the tree must prune candidate rule files in excluded folders
  // before those files are read. Sibling order and FileList order are irrelevant.
  candidates.sort(
    (a, b) =>
      (a.scope ? a.scope.split("/").length : 0) -
        (b.scope ? b.scope.split("/").length : 0) ||
      a.path.localeCompare(b.path),
  );
  const reader = new IgnoreReader();
  for (const candidate of candidates) {
    await progress.checkpoint();
    let rules = roots.get(candidate.root);
    if (!rules) roots.set(candidate.root, (rules = new FolderIgnore()));
    if (rules.isIgnored(candidate.scope, true)) continue;
    rules.addRules(
      candidate.scope,
      candidate.name,
      await reader.read(
        candidate.file,
        candidate.file.webkitRelativePath,
        options,
      ),
    );
  }
  return roots;
}

async function nativeFolderRules(
  directory: NativeDirectoryHandle,
  entries: (NativeFileHandle | NativeDirectoryHandle)[],
  complete: boolean,
  scope: string,
  displayPath: string,
  rules: FolderIgnore,
  reader: IgnoreReader,
  options: FileSelectionOptions,
  progress: SelectionProgress,
): Promise<void> {
  for (const name of IGNORE_FILES) {
    await progress.checkpoint();
    const path = `${displayPath}/${name}`;
    let handle = entries.find((entry) => entry.name === name);
    if (handle?.kind === "directory" || (!handle && complete)) continue;
    if (!handle) {
      try {
        handle = await readOperation(
          () => directory.getFileHandle(name),
          options,
          path,
        );
      } catch (error) {
        if (
          isNamedError(error, "NotFoundError") ||
          isNamedError(error, "TypeMismatchError")
        )
          continue;
        throw error;
      }
    }
    const file = await readOperation(() => handle.getFile(), options, path);
    rules.addRules(scope, name, await reader.read(file, path, options));
  }
}

async function mapBounded<T, R>(
  values: T[],
  operation: (value: T, laneOptions: FileSelectionOptions) => Promise<R>,
  options: FileSelectionOptions,
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  let failed = false;
  const pendingReads = new AbortController();
  const aborted = () => pendingReads.abort();
  options.signal?.addEventListener("abort", aborted, { once: true });
  if (options.signal?.aborted) pendingReads.abort();
  const laneOptions = { ...options, signal: pendingReads.signal };
  const lane = async () => {
    while (!failed && next < values.length) {
      checkAbort(options);
      const index = next++;
      try {
        results[index] = await operation(values[index]!, laneOptions);
      } catch (error) {
        failed = true;
        // Stop sibling waits and clear their deadlines after any retained read fails.
        pendingReads.abort();
        throw error;
      }
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(READ_CONCURRENCY, values.length) }, lane),
    );
  } finally {
    options.signal?.removeEventListener("abort", aborted);
  }
  checkAbort(options);
  return results;
}

interface NativeFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}

interface NativeDirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<NativeFileHandle | NativeDirectoryHandle>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<NativeDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<NativeFileHandle>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}

interface PickerWindow {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<NativeFileHandle[]>;
  showSaveFilePicker?: (options: {
    suggestedName: string;
  }) => Promise<NativeFileHandle>;
  showDirectoryPicker?: (options: {
    mode: "read" | "readwrite";
  }) => Promise<NativeDirectoryHandle>;
}

function pickers(): PickerWindow {
  return window as unknown as PickerWindow;
}

function isNamedError(error: unknown, name: string): boolean {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    error.name === name
  );
}

function validateSelection(selection: PickedFiles): PickedFiles {
  const workspace = {
    ...createWorkspace(),
    files: selection.files,
    directories: selection.directories,
  };
  // Check the actual JSON UTF-8 size, including base64 and path metadata.
  serializePayload(workspace);
  return selection;
}

function directoryAncestors(path: string): string[] {
  const parts = validateRelativePath(path).split("/");
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** Retain empty leaf folders without storing parents already implied by paths twice. */
export function retainEmptyDirectories(
  files: PwaFile[],
  directories: string[],
): string[] {
  const implied = new Set(
    [...files.map((file) => file.path), ...directories].flatMap(
      directoryAncestors,
    ),
  );
  return directories.filter((path) => !implied.has(validateRelativePath(path)));
}

async function readFiles(
  selected: { file: File; path: string }[],
  directories: string[],
  options: FileSelectionOptions,
  progress: SelectionProgress,
): Promise<PickedFiles> {
  checkAbort(options);
  if (selected.length + directories.length > MAX_PWA_ENTRIES) {
    selectionLimit(options);
  }
  let encodedBytes = 0;
  // Bound the aggregate before allocating any file's contents.
  for (const { file, path } of selected) {
    checkAbort(options);
    validateRelativePath(path);
    if (file.size > MAX_PWA_FILE_BYTES) {
      throw new Error("Each file must be 4 MiB or smaller.");
    }
    encodedBytes += 4 * Math.ceil(file.size / 3);
    if (encodedBytes > MAX_VAULT_PLAINTEXT_BYTES) {
      throw new Error("The selection exceeds the 6 MiB encoded bundle limit.");
    }
  }
  progress.reading(selected.length);
  try {
    const files = await mapBounded(
      selected,
      async ({ file, path }, laneOptions) => {
        const bytes = new Uint8Array(
          await readOperation(() => file.arrayBuffer(), laneOptions, path),
        );
        if (bytes.length !== file.size) {
          throw new Error("A selected file changed while it was being read.");
        }
        checkAbort(laneOptions);
        const portable = createPwaFile(
          path,
          bytes,
          file.type,
          file.lastModified,
        );
        await progress.read();
        return portable;
      },
      options,
    );
    await progress.checkpoint();
    const selection = validateSelection({ files, directories });
    progress.finish();
    return selection;
  } catch (error) {
    progress.stop();
    throw error;
  }
}

async function readHandles(
  selected: { handle: NativeFileHandle; path: string }[],
  directories: string[],
  options: FileSelectionOptions,
  progress: SelectionProgress,
): Promise<PickedFiles> {
  try {
    const files = await mapBounded(
      selected,
      async ({ handle, path }, laneOptions) => {
        const file = await readOperation(
          () => handle.getFile(),
          laneOptions,
          path,
        );
        checkAbort(laneOptions);
        await progress.checkpoint();
        return { file, path };
      },
      options,
    );
    // Every metadata read and aggregate-size check completes before byte allocation.
    return await readFiles(files, directories, options, progress);
  } catch (error) {
    progress.stop();
    throw error;
  }
}

function pickWithInput(
  folder: boolean,
  options: FileSelectionOptions,
): Promise<PickedFiles | null> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve(null);
      return;
    }
    const progress = new SelectionProgress(options);
    if (options.signal?.aborted) {
      progress.stop();
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (options.markdownOnly)
      input.accept = folder ? ".md,.gitignore,.ignore" : ".md";
    input.tabIndex = -1;
    input.style.cssText = "position:fixed;left:-9999px;opacity:0";
    if (folder) input.setAttribute("webkitdirectory", "");
    let finished = false;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      finished = true;
      clearTimeout(focusTimer);
      window.removeEventListener("focus", returnedToWindow);
      options.signal?.removeEventListener("abort", cancel);
      input.remove();
    };
    const cancel = () => {
      if (finished) return;
      cleanup();
      progress.stop();
      resolve(null);
    };
    // Older file dialogs lack `cancel`; change fires after focus on some hosts.
    const returnedToWindow = () => {
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        if (!input.files?.length) cancel();
      }, 500);
    };
    input.addEventListener("cancel", cancel, { once: true });
    input.addEventListener(
      "change",
      () => {
        if (finished) return;
        const selectedInput = async () => {
          checkAbort(options);
          const inputFiles = input.files;
          if (
            options.markdownOnly &&
            !folder &&
            (inputFiles?.length ?? 0) > MAX_SCAN_ENTRIES
          )
            scanLimit();
          if (
            !options.markdownOnly &&
            (inputFiles?.length ?? 0) > MAX_PWA_ENTRIES
          ) {
            selectionLimit(options);
          }
          const roots = new Set<string>();
          const selected: { file: File; path: string }[] = [];
          const rules =
            folder && options.markdownOnly && inputFiles
              ? await inputFolderRules(inputFiles, options, progress)
              : new Map<string, FolderIgnore>();
          const defaults = new FolderIgnore();
          let inspectedEntries = 0;
          for (const file of inputFiles ?? []) {
            await progress.checkpoint();
            const relative = file.webkitRelativePath;
            const path = folder && relative ? relative : file.name;
            if (folder && relative)
              roots.add(validateRelativePath(relative.split("/")[0]!));
            const entry = folder ? folderPath(relative) : null;
            if (
              options.markdownOnly &&
              entry &&
              (rules.get(entry.root) ?? defaults).isIgnored(entry.path)
            )
              continue;
            if (
              folder &&
              options.markdownOnly &&
              (file.name === ".gitignore" || file.name === ".ignore")
            )
              continue;
            if (options.markdownOnly && ++inspectedEntries > MAX_SCAN_ENTRIES)
              scanLimit();
            const allowed = !options.markdownOnly || isMarkdownPath(path);
            await progress.scanned(allowed);
            if (!allowed) continue;
            if (folder && relative) validateRelativePath(relative);
            if (selected.length >= MAX_PWA_ENTRIES) selectionLimit(options);
            selected.push({
              file,
              // Retain the selected project root so several projects can share
              // an entity even when they contain identical relative filenames.
              path,
            });
          }
          cleanup();
          if (!inputFiles?.length) {
            progress.stop();
            return null;
          }
          // Markdown paths already retain their root and every parent. Explicit
          // directory records are needed only by generic imports/empty roots.
          const directories = !folder
            ? []
            : options.markdownOnly
              ? selected.length
                ? []
                : [...roots]
              : [
                  ...new Set([
                    ...roots,
                    ...selected.flatMap(({ path }) => directoryAncestors(path)),
                  ]),
                ];
          return readFiles(selected, directories, options, progress);
        };
        void selectedInput().then(resolve, (error: unknown) => {
          cleanup();
          progress.stop();
          if (isNamedError(error, "AbortError")) resolve(null);
          else reject(error);
        });
      },
      { once: true },
    );
    window.addEventListener("focus", returnedToWindow);
    options.signal?.addEventListener("abort", cancel, { once: true });
    document.body.append(input);
    // Keep the picker inside the calling button's user activation.
    try {
      input.click();
    } catch (error) {
      cleanup();
      progress.stop();
      reject(error);
    }
  });
}

export async function pickFiles(
  options: FileSelectionOptions = {},
): Promise<PickedFiles | null> {
  const native = pickers().showOpenFilePicker;
  if (!native) return pickWithInput(false, options);
  const progress = new SelectionProgress(options);
  try {
    const handles = await readOperation(
      () =>
        native.call(
          window,
          options.markdownOnly
            ? {
                multiple: true,
                types: [
                  {
                    description: "Markdown",
                    accept: { "text/markdown": [".md"] },
                  },
                ],
                excludeAcceptAllOption: true,
              }
            : { multiple: true },
        ),
      options,
    );
    if (options.markdownOnly && handles.length > MAX_SCAN_ENTRIES) scanLimit();
    const selected: { handle: NativeFileHandle; path: string }[] = [];
    for (const handle of handles) {
      const allowed = !options.markdownOnly || isMarkdownPath(handle.name);
      await progress.scanned(allowed);
      if (!allowed) continue;
      if (selected.length >= MAX_PWA_ENTRIES) selectionLimit(options);
      selected.push({ handle, path: validateRelativePath(handle.name) });
    }
    return await readHandles(selected, [], options, progress);
  } catch (error) {
    progress.stop();
    if (isNamedError(error, "AbortError")) return null;
    throw error;
  }
}

export async function pickFolder(
  options: FileSelectionOptions = {},
): Promise<PickedFiles | null> {
  const native = pickers().showDirectoryPicker;
  if (!native) return pickWithInput(true, options);
  const progress = new SelectionProgress(options);
  try {
    const root = await readOperation(
      () => native.call(window, { mode: "read" }),
      options,
    );
    const rootPath = validateRelativePath(root.name);
    const selected: { handle: NativeFileHandle; path: string }[] = [];
    const directories: string[] = options.markdownOnly ? [] : [rootPath];
    const rules = new FolderIgnore();
    const ignoreReader = new IgnoreReader();
    let inspectedEntries = 0;
    const walk = async (directory: NativeDirectoryHandle, prefix: string) => {
      const iterator = directory.values()[Symbol.asyncIterator]();
      try {
        const buffered: (NativeFileHandle | NativeDirectoryHandle)[] = [];
        let complete = false;
        let bufferIndex = 0;
        if (options.markdownOnly) {
          // Most project directories are small. Reuse their listing for rule
          // discovery instead of issuing two absent-file lookups per directory.
          // Large directories retain streaming traversal and bounded buffering.
          while (buffered.length <= DIRECTORY_PREFIX_SIZE) {
            const item = await readOperation(
              () => iterator.next(),
              options,
              `folder ${prefix.slice(0, -1)}`,
            );
            if (item.done) {
              complete = true;
              break;
            }
            buffered.push(item.value);
            await progress.checkpoint();
          }
          await nativeFolderRules(
            directory,
            buffered,
            complete,
            prefix.slice(rootPath.length + 1).replace(/\/$/u, ""),
            prefix.slice(0, -1),
            rules,
            ignoreReader,
            options,
            progress,
          );
        }
        while (true) {
          let handle = buffered[bufferIndex++];
          if (!handle) {
            if (complete) break;
            // Abort releases the UI even while a platform directory iterator waits.
            const item = await readOperation(
              () => iterator.next(),
              options,
              `folder ${prefix.slice(0, -1)}`,
            );
            if (item.done) break;
            handle = item.value;
          }
          if (
            options.markdownOnly &&
            handle.kind === "file" &&
            (handle.name === ".gitignore" || handle.name === ".ignore")
          )
            continue;
          if (
            options.markdownOnly &&
            rules.isIgnored(
              `${prefix.slice(rootPath.length + 1)}${handle.name}`,
              handle.kind === "directory",
            )
          ) {
            await progress.checkpoint();
            continue;
          }
          await progress.scanned(
            handle.kind === "file" &&
              (!options.markdownOnly || isMarkdownPath(handle.name)),
          );
          if (options.markdownOnly) {
            if (++inspectedEntries > MAX_SCAN_ENTRIES) scanLimit();
            if (handle.kind === "file" && !isMarkdownPath(handle.name))
              continue;
          }
          const path = validateRelativePath(`${prefix}${handle.name}`);
          if (handle.kind === "directory") {
            if (!options.markdownOnly) {
              if (selected.length + directories.length >= MAX_PWA_ENTRIES)
                selectionLimit(options);
              directories.push(path);
            }
            await walk(handle, `${path}/`);
          } else {
            if (selected.length + directories.length >= MAX_PWA_ENTRIES)
              selectionLimit(options);
            selected.push({ handle, path });
          }
        }
      } catch (error) {
        try {
          void iterator.return?.().catch(() => {});
        } catch {
          /* Platform iterator cleanup is best effort. */
        }
        throw error;
      }
    };
    await walk(root, `${rootPath}/`);
    return await readHandles(
      selected,
      options.markdownOnly && !selected.length ? [rootPath] : directories,
      options,
      progress,
    );
  } catch (error) {
    progress.stop();
    if (isNamedError(error, "AbortError")) return null;
    throw error;
  }
}

export function downloadBytes(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  mediaType = "application/octet-stream",
): void {
  const blob = new Blob([bytes], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Delay revocation so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function exportPlainFile(file: PwaFile): Promise<boolean> {
  validateSelection({ files: [file], directories: [] });
  const bytes = fileBytes(file);
  const name = file.path.split("/").at(-1)!;
  const native = pickers().showSaveFilePicker;
  if (!native) {
    downloadBytes(bytes, name, file.mediaType || "application/octet-stream");
    return true;
  }
  let writable:
    Awaited<ReturnType<NativeFileHandle["createWritable"]>> | undefined;
  try {
    const handle = await native.call(window, { suggestedName: name });
    writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return true;
  } catch (error) {
    await writable?.abort?.().catch(() => undefined);
    if (!writable && isNamedError(error, "AbortError")) return false;
    throw error;
  }
}

function restoreDirectories(files: PwaFile[], directories: string[]): string[] {
  const paths = new Set(directories);
  for (const path of [...directories, ...files.map((file) => file.path)]) {
    for (const ancestor of directoryAncestors(path)) {
      paths.add(ancestor);
      if (paths.size + files.length > MAX_RESTORE_ENTRIES) restoreLimit();
    }
  }
  return [...paths].sort((a, b) => a.split("/").length - b.split("/").length);
}

function validateRestore(files: PwaFile[], directories: string[]): string[] {
  validateSelection({ files, directories });
  const paths = restoreDirectories(files, directories);
  const names = new Set<string>();
  // A portable bundle must also restore safely on case-insensitive filesystems.
  for (const path of [...paths, ...files.map((file) => file.path)]) {
    const portable = path.normalize("NFC").toLowerCase();
    if (names.has(portable)) {
      throw new Error("Folder paths collide on a case-insensitive filesystem.");
    }
    names.add(portable);
  }
  return paths;
}

function splitParent(path: string): { parent: string; name: string } {
  const offset = path.lastIndexOf("/");
  return {
    parent: path.slice(0, offset < 0 ? 0 : offset),
    name: path.slice(offset + 1),
  };
}

async function checkWritable(root: NativeDirectoryHandle): Promise<void> {
  if (!root.queryPermission) return; // The readwrite picker grants its own access.
  let permission = await root.queryPermission({ mode: "readwrite" });
  if (permission === "prompt" && root.requestPermission) {
    permission = await root.requestPermission({ mode: "readwrite" });
  }
  if (permission !== "granted") {
    throw new Error("Folder write permission was not granted.");
  }
}

async function refuseExistingFile(
  directory: NativeDirectoryHandle,
  name: string,
  path: string,
): Promise<void> {
  try {
    await directory.getFileHandle(name);
  } catch (error) {
    if (isNamedError(error, "NotFoundError")) return;
    if (!isNamedError(error, "TypeMismatchError")) throw error;
  }
  throw new Error(`Restore would replace an existing path: ${path}`);
}

export async function restoreFolder(
  files: PwaFile[],
  directories: string[] = [],
): Promise<"directory" | "zip" | null> {
  const paths = validateRestore(files, directories);
  const bytes = files.map(fileBytes);
  const native = pickers().showDirectoryPicker;
  if (!native) {
    downloadBytes(
      createStoredZip(files, directories),
      "aic-notes.zip",
      "application/zip",
    );
    return "zip";
  }
  let root: NativeDirectoryHandle;
  try {
    root = await native.call(window, { mode: "readwrite" });
  } catch (error) {
    if (isNamedError(error, "AbortError")) return null;
    throw error;
  }
  await checkWritable(root);
  const handles = new Map<string, NativeDirectoryHandle | null>([["", root]]);
  // Validate every existing destination before creating anything.
  for (const path of paths) {
    const { parent, name } = splitParent(path);
    const directory = handles.get(parent);
    if (!directory) {
      handles.set(path, null);
      continue;
    }
    try {
      handles.set(path, await directory.getDirectoryHandle(name));
    } catch (error) {
      if (isNamedError(error, "NotFoundError")) handles.set(path, null);
      else if (isNamedError(error, "TypeMismatchError")) {
        throw new Error(`Restore would replace an existing path: ${path}`, {
          cause: error,
        });
      } else throw error;
    }
  }
  for (const file of files) {
    const { parent, name } = splitParent(file.path);
    const directory = handles.get(parent);
    if (directory) await refuseExistingFile(directory, name, file.path);
  }
  for (const path of paths) {
    if (handles.get(path)) continue;
    const { parent, name } = splitParent(path);
    handles.set(
      path,
      await handles.get(parent)!.getDirectoryHandle(name, { create: true }),
    );
  }
  for (const [index, file] of files.entries()) {
    const { parent, name } = splitParent(file.path);
    const directory = handles.get(parent)!;
    // Check again after preflight. Browser APIs cannot offer exclusive creation
    // against changes made concurrently by another application.
    await refuseExistingFile(directory, name, file.path);
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(bytes[index]!);
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch(() => undefined);
      throw error;
    }
  }
  return "directory";
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Bounded ZIP using stored entries, CRC32, and UTF-8 names; no compression. */
export function createStoredZip(
  files: PwaFile[],
  directories: string[] = [],
): Uint8Array<ArrayBuffer> {
  const paths = validateRestore(files, directories);
  const encoder = new TextEncoder();
  const entries = [
    ...paths.map((path) => ({
      path: `${path}/`,
      bytes: new Uint8Array(0),
      directory: true,
    })),
    ...files.map((file) => ({
      path: file.path,
      bytes: fileBytes(file),
      directory: false,
    })),
  ].map((entry) => ({
    ...entry,
    name: encoder.encode(entry.path),
    crc: crc32(entry.bytes),
  }));
  if (entries.length > MAX_RESTORE_ENTRIES) restoreLimit();
  let total = 22;
  for (const entry of entries) {
    if (entry.name.length > 65535)
      throw new Error("A folder path is too long for ZIP export.");
    total += 76 + 2 * entry.name.length + entry.bytes.length;
  }
  if (total > 2 * MAX_VAULT_PLAINTEXT_BYTES) {
    throw new Error("The folder exceeds the supported ZIP export size.");
  }
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const offsets: number[] = [];
  let position = 0;
  for (const entry of entries) {
    offsets.push(position);
    view.setUint32(position, 0x04034b50, true);
    view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 0x0800, true); // UTF-8 filenames.
    view.setUint16(position + 12, 0x0021, true); // 1980-01-01, fixed DOS date.
    view.setUint32(position + 14, entry.crc, true);
    view.setUint32(position + 18, entry.bytes.length, true);
    view.setUint32(position + 22, entry.bytes.length, true);
    view.setUint16(position + 26, entry.name.length, true);
    bytes.set(entry.name, position + 30);
    bytes.set(entry.bytes, position + 30 + entry.name.length);
    position += 30 + entry.name.length + entry.bytes.length;
  }
  const centralOffset = position;
  for (const [index, entry] of entries.entries()) {
    view.setUint32(position, 0x02014b50, true);
    view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 20, true);
    view.setUint16(position + 8, 0x0800, true);
    view.setUint16(position + 14, 0x0021, true);
    view.setUint32(position + 16, entry.crc, true);
    view.setUint32(position + 20, entry.bytes.length, true);
    view.setUint32(position + 24, entry.bytes.length, true);
    view.setUint16(position + 28, entry.name.length, true);
    view.setUint32(position + 38, entry.directory ? 0x10 : 0, true);
    view.setUint32(position + 42, offsets[index]!, true);
    bytes.set(entry.name, position + 46);
    position += 46 + entry.name.length;
  }
  view.setUint32(position, 0x06054b50, true);
  view.setUint16(position + 8, entries.length, true);
  view.setUint16(position + 10, entries.length, true);
  view.setUint32(position + 12, position - centralOffset, true);
  view.setUint32(position + 16, centralOffset, true);
  return bytes;
}
