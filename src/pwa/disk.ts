/** Device-only file capabilities. Portable note bytes never contain filesystem handles. */
import {
  createPwaFile,
  fileBytes,
  MAX_PWA_FILE_BYTES,
  type PwaFile,
  type WorkspacePayload,
} from "./model";

export interface MarkdownFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<{
    size: number;
    type: string;
    lastModified: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  createWritable(options?: {
    keepExistingData: boolean;
    mode: "exclusive";
  }): Promise<{
    write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
  queryPermission?(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}
export interface MarkdownDirectoryHandle {
  kind: "directory";
  name: string;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MarkdownFileHandle>;
  queryPermission?(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}
export interface MarkdownBinding {
  id: string;
  path: string;
  handle: MarkdownFileHandle;
}
export interface MarkdownSelection {
  files: MarkdownBinding[];
  root?: MarkdownDirectoryHandle;
}
interface DiskRecord extends MarkdownSelection {
  workspaceId: string;
}
export interface MarkdownBindingPersistence {
  read(workspaceId: string): Promise<MarkdownSelection | null>;
  write(workspaceId: string, selection: MarkdownSelection): Promise<void>;
  remove(workspaceId: string): Promise<void>;
}

export class IndexedDbMarkdownBindings implements MarkdownBindingPersistence {
  constructor(private readonly factory = globalThis.indexedDB) {}
  private async transact<T>(
    id: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    if (!this.factory)
      throw new Error(
        "This browser cannot remember file access. Reopen your files next time.",
      );
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open("aic-notes-pwa-markdown-bindings", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("workspaces", {
          keyPath: "workspaceId",
        });
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () =>
        reject(
          new Error(
            "File access could not be remembered. Reopen your files next time.",
          ),
        );
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction("workspaces", mode);
        const request = operation(transaction.objectStore("workspaces"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () =>
          reject(
            new Error(
              `File access for ${id} is unavailable. Reopen your files.`,
            ),
          );
      });
    } finally {
      database.close();
    }
  }
  async read(id: string): Promise<MarkdownSelection | null> {
    const value = await this.transact<DiskRecord | undefined>(
      id,
      "readonly",
      (store) => store.get(id),
    );
    if (!value) return null;
    if (
      value.workspaceId !== id ||
      !Array.isArray(value.files) ||
      value.files.some(
        (file) =>
          !file ||
          typeof file.id !== "string" ||
          typeof file.path !== "string" ||
          file.handle?.kind !== "file" ||
          typeof file.handle.getFile !== "function",
      )
    )
      throw new Error("Saved file access is invalid. Reopen your files.");
    return value;
  }
  async write(id: string, selection: MarkdownSelection): Promise<void> {
    await this.transact(id, "readwrite", (store) =>
      store.put({ workspaceId: id, ...selection }),
    );
  }
  async remove(id: string): Promise<void> {
    await this.transact(id, "readwrite", (store) => store.delete(id));
  }
}

async function permission(
  handle: MarkdownFileHandle | MarkdownDirectoryHandle,
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
  throw new Error(
    "File access needs permission. Use Reconnect files, then retry. Your draft is unchanged.",
  );
}
async function read(binding: MarkdownBinding): Promise<PwaFile> {
  await permission(binding.handle, "read");
  const file = await binding.handle.getFile(); // A missing original must never be recreated here.
  if (file.size > MAX_PWA_FILE_BYTES)
    throw new Error("Each Markdown file must be 4 MiB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size)
    throw new Error("The file changed while reading. Reopen it.");
  return {
    ...createPwaFile(binding.path, bytes, file.type, file.lastModified),
    id: binding.id,
  };
}

/** One save owner calls this adapter; successful individual writes advance their baselines. */
export class MarkdownDisk {
  private readonly workspaces = new Map<string, MarkdownSelection>();
  private readonly baselines = new Map<string, Map<string, string>>();
  private readonly unavailable = new Map<string, Set<string>>();
  constructor(
    private readonly persistence: MarkdownBindingPersistence = new IndexedDbMarkdownBindings(),
  ) {}
  has(id: string, fileId: string): boolean {
    return !!this.workspaces.get(id)?.files.some((file) => file.id === fileId);
  }
  ready(id: string, fileId: string): boolean {
    return (
      this.baselines.get(id)?.has(fileId) === true &&
      !this.unavailable.get(id)?.has(fileId)
    );
  }
  root(id: string): MarkdownDirectoryHandle | undefined {
    return this.workspaces.get(id)?.root;
  }
  async attach(
    id: string,
    selection: MarkdownSelection,
    files: PwaFile[],
  ): Promise<void> {
    const old = this.workspaces.get(id);
    const merged = new Map(old?.files.map((file) => [file.id, file]));
    for (const binding of selection.files) merged.set(binding.id, binding);
    const next = {
      files: [...merged.values()],
      ...(old?.root || selection.root
        ? { root: old?.root ?? selection.root }
        : {}),
    };
    this.workspaces.set(id, next);
    const baselines = this.baselines.get(id) ?? new Map<string, string>();
    for (const file of files)
      if (selection.files.some((binding) => binding.id === file.id))
        baselines.set(file.id, file.data);
    this.baselines.set(id, baselines);
    for (const binding of selection.files)
      this.unavailable.get(id)?.delete(binding.id);
    await this.persistence.write(id, next);
  }
  async restore(id: string): Promise<boolean> {
    if (this.workspaces.has(id)) return true;
    const selection = await this.persistence.read(id);
    if (!selection) return false;
    this.workspaces.set(id, selection);
    this.baselines.set(id, new Map());
    return true;
  }
  async requestPermission(id: string): Promise<void> {
    const selection = this.workspaces.get(id);
    if (!selection)
      throw new Error(
        "Reconnect this workspace by opening its folder or files.",
      );
    if (selection.root) await permission(selection.root, "readwrite", true);
    else
      for (const binding of selection.files)
        await permission(binding.handle, "readwrite", true);
  }
  async refresh(
    id: string,
    value: WorkspacePayload,
    ids?: Set<string>,
  ): Promise<WorkspacePayload> {
    const bindings = this.workspaces.get(id);
    if (!bindings)
      throw new Error(
        "Reconnect the original files. Cached notes are available as recovery copies.",
      );
    const next = structuredClone(value);
    const baselines = this.baselines.get(id)!;
    const refreshed = new Map<string, string>();
    const unavailable = this.unavailable.get(id) ?? new Set<string>();
    this.unavailable.set(id, unavailable);
    for (const binding of bindings.files)
      if (!ids || ids.has(binding.id)) unavailable.add(binding.id);
    for (const binding of bindings.files) {
      if (ids && !ids.has(binding.id)) continue;
      const index = next.files.findIndex((file) => file.id === binding.id);
      if (index < 0) continue;
      const latest = await read(binding);
      next.files[index] = latest;
      refreshed.set(binding.id, latest.data);
    }
    // Commit expectations only after every required read succeeds. A partial refresh
    // must never turn stale cached bytes into an intentional edit of a newer file.
    for (const [fileId, data] of refreshed) {
      baselines.set(fileId, data);
      unavailable.delete(fileId);
    }
    return next;
  }
  async save(
    id: string,
    value: WorkspacePayload,
    previous?: WorkspacePayload,
  ): Promise<void> {
    const selection = this.workspaces.get(id);
    if (!selection)
      throw new Error(
        "Choose an original file with Save to file before editing this browser copy.",
      );
    const baselines = this.baselines.get(id)!;
    for (const file of value.files) {
      const expected = baselines.get(file.id);
      const binding = selection.files.find((item) => item.id === file.id);
      if (binding && binding.path !== file.path)
        throw new Error(
          "This browser cannot rename the original file. Use Save a copy.",
        );
      if (expected === file.data) continue;
      if (
        expected === undefined &&
        previous?.files.some(
          (old) =>
            old.id === file.id &&
            old.data === file.data &&
            old.path === file.path,
        )
      )
        continue;
      if (!binding || expected === undefined)
        throw new Error(
          `Choose a destination for ${file.path} with Save to file. Your draft is unchanged.`,
        );
      await permission(binding.handle, "readwrite");
      const assertUnchanged = async () => {
        if ((await read(binding)).data !== expected)
          throw new Error(
            `${file.path} changed on disk. Your draft is kept; save a copy before reopening the original.`,
          );
      };
      await assertUnchanged();
      const writable = await binding.handle.createWritable({
        keepExistingData: false,
        mode: "exclusive",
      });
      let closed = false;
      try {
        await assertUnchanged();
        await writable.write(fileBytes(file));
        await assertUnchanged();
        await writable.close();
        closed = true;
        baselines.set(file.id, file.data);
      } finally {
        if (!closed) {
          try {
            await writable.abort?.();
          } catch {
            /* Preserve the original failure. */
          }
        }
      }
    }
  }
  async disconnect(id: string): Promise<void> {
    this.workspaces.delete(id);
    this.baselines.delete(id);
    this.unavailable.delete(id);
    await this.persistence.remove(id); // Access metadata only. User files are untouched.
  }
}

export function chooseMarkdownDestination(
  name: string,
): Promise<MarkdownFileHandle | null> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<MarkdownFileHandle>;
    }
  ).showSaveFilePicker;
  if (!picker)
    return Promise.reject(
      new Error(
        "Direct file saving is unavailable in this browser. Export a copy, or use a browser with filesystem access.",
      ),
    );
  return picker
    .call(window, {
      suggestedName: name.split("/").at(-1)!,
      types: [
        { description: "Markdown", accept: { "text/markdown": [".md"] } },
      ],
    })
    .catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError")
        return null;
      throw error;
    });
}

/** Save As is explicit; it may replace the selected file only if its observed bytes still match. */
export async function writeMarkdownDestination(
  handle: MarkdownFileHandle,
  file: PwaFile,
  options: { newOnly?: boolean } = {},
): Promise<PwaFile> {
  if (!/\.md$/iu.test(handle.name)) throw new Error("Choose a .md filename.");
  const binding = { id: file.id, path: handle.name, handle };
  const observed = await read(binding);
  if (options.newOnly && observed.data !== "")
    throw new Error(
      "That file already contains data. Open it instead of creating a new note.",
    );
  const temporary = new MarkdownDisk({
    read: async () => null,
    write: async () => {},
    remove: async () => {},
  });
  await temporary.attach("save-as", { files: [binding] }, [observed]);
  const written = { ...file, path: handle.name };
  await temporary.save("save-as", {
    format: "aic-notes-pwa",
    version: 1,
    kind: "workspace",
    files: [written],
    directories: [],
  });
  return written;
}
