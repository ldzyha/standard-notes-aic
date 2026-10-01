import { PwaError } from "./model";
import { validateEntityId } from "./storage";

export const MAX_ENCRYPTED_SOURCE_BYTES = 9 * 1024 * 1024;

export interface EncryptedSource {
  readonly name?: string;
  read(): Promise<string>;
  /** null can create an empty file only; existing files require exact ciphertext. */
  write(ciphertext: string, expected: string | null): Promise<void>;
}

export interface SourceHost {
  readSource(): Promise<string>;
  /** The host must compare the expected ciphertext before replacing its file. */
  writeSource(ciphertext: string, expected: string): Promise<void>;
}

interface EncryptedWritable {
  write(ciphertext: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface EncryptedFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<{ size: number; text(): Promise<string> }>;
  createWritable(options?: {
    keepExistingData: boolean;
    mode: "exclusive";
  }): Promise<EncryptedWritable>;
  queryPermission?(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(options: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}

interface SourcePickerWindow {
  showOpenFilePicker?: (options: {
    multiple: false;
    mode: "readwrite";
  }) => Promise<EncryptedFileHandle[]>;
  showSaveFilePicker?: (options: {
    suggestedName: string;
  }) => Promise<EncryptedFileHandle>;
}

export interface SourceBindingPersistence {
  read(entityId: string): Promise<unknown | null>;
  write(entityId: string, handle: EncryptedFileHandle): Promise<void>;
}

const handles = new WeakMap<EncryptedSource, EncryptedFileHandle>();
const encoder = new TextEncoder();
const conflict = () =>
  new PwaError(
    "conflict",
    "The shared file changed elsewhere. Open its latest version before saving.",
  );
const denied = () =>
  new PwaError(
    "storage",
    "File access needs permission. Select the shared file again before saving.",
  );
const unsupported = () =>
  new PwaError(
    "storage",
    "This browser cannot keep a writable shared file. Use encrypted import and download.",
  );

function validateText(value: unknown): string {
  if (typeof value !== "string")
    throw new PwaError(
      "invalid",
      "The shared source did not return an encrypted file.",
    );
  if (
    value.length > MAX_ENCRYPTED_SOURCE_BYTES ||
    encoder.encode(value).length > MAX_ENCRYPTED_SOURCE_BYTES
  )
    throw new PwaError("limit", "This encrypted file is too large.");
  return value;
}

function isHandle(value: unknown): value is EncryptedFileHandle {
  if (!value || typeof value !== "object") return false;
  const handle = value as Partial<EncryptedFileHandle>;
  return (
    handle.kind === "file" &&
    typeof handle.name === "string" &&
    typeof handle.getFile === "function" &&
    typeof handle.createWritable === "function"
  );
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    error.name === "AbortError"
  );
}

async function hasPermission(
  handle: EncryptedFileHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  // Browsers lacking the Permissions extension still enforce permissions at I/O.
  return (
    !handle.queryPermission ||
    (await handle.queryPermission({ mode })) === "granted"
  );
}

/** Call directly from a user action before awaiting crypto or other work. */
export async function requestSourcePermission(
  source: EncryptedSource,
): Promise<boolean> {
  const handle = handles.get(source);
  if (!handle) return true;
  if (await hasPermission(handle, "readwrite")) return true;
  return (
    !!handle.requestPermission &&
    (await handle.requestPermission({ mode: "readwrite" })) === "granted"
  );
}

export function sourceFromHandle(handle: EncryptedFileHandle): EncryptedSource {
  if (!isHandle(handle))
    throw new PwaError("invalid", "Choose a supported encrypted file.");
  const read = async () => {
    if (!(await hasPermission(handle, "read"))) throw denied();
    const file = await handle.getFile();
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_ENCRYPTED_SOURCE_BYTES
    )
      throw new PwaError("limit", "This encrypted file is too large.");
    const text = validateText(await file.text());
    // A source is exact UTF-8 ciphertext, never a lossy replacement of binary data.
    if (encoder.encode(text).length !== file.size)
      throw new PwaError(
        "invalid",
        "This source is not an exact UTF-8 encrypted file.",
      );
    return text;
  };
  const source: EncryptedSource = {
    name: handle.name,
    read,
    async write(ciphertext, expected) {
      validateText(ciphertext);
      if (expected !== null) validateText(expected);
      if (!(await hasPermission(handle, "readwrite"))) throw denied();
      const observed = await read();
      if (expected === null ? observed !== "" : observed !== expected)
        throw conflict();
      // Native exclusive writers prevent two supported browser writers sharing one file.
      const writable = await handle.createWritable({
        keepExistingData: false,
        mode: "exclusive",
      });
      let closed = false;
      try {
        if ((await read()) !== observed) throw conflict();
        await writable.write(ciphertext);
        // Writes are buffered until close: another app's change must not be overwritten.
        if ((await read()) !== observed) throw conflict();
        await writable.close();
        closed = true;
      } finally {
        if (!closed) {
          try {
            await writable.abort?.();
          } catch {
            /* Retain the original failure. */
          }
        }
      }
    },
  };
  handles.set(source, handle);
  return source;
}

/** The bridge retains filesystem authority; the browser never receives a path or key. */
export function sourceFromHost(
  host: SourceHost,
  name?: string,
): EncryptedSource {
  return {
    ...(name === undefined ? {} : { name }),
    read: async () => validateText(await host.readSource()),
    async write(ciphertext, expected) {
      validateText(ciphertext);
      if (expected !== null) validateText(expected);
      const current = validateText(await host.readSource());
      if (expected === null ? current !== "" : current !== expected)
        throw conflict();
      await host.writeSource(ciphertext, current);
    },
  };
}

export async function openEncryptedSource(): Promise<EncryptedSource | null> {
  const picker = (window as unknown as SourcePickerWindow).showOpenFilePicker;
  if (!picker) throw unsupported();
  try {
    const selected = await picker.call(window, {
      multiple: false,
      mode: "readwrite",
    });
    if (selected.length !== 1 || !selected[0])
      throw new PwaError("invalid", "Choose one encrypted AIC file.");
    return sourceFromHandle(selected[0]);
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

export async function createEncryptedSource(): Promise<EncryptedSource | null> {
  const picker = (window as unknown as SourcePickerWindow).showSaveFilePicker;
  if (!picker) throw unsupported();
  try {
    return sourceFromHandle(
      await picker.call(window, { suggestedName: "aic-notes.aicnotes" }),
    );
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Separate database: handles are local capabilities, never portable file payloads. */
export class IndexedDbSourceBindings implements SourceBindingPersistence {
  constructor(
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
  ) {}

  private database(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(unsupported());
    return new Promise((resolve, reject) => {
      const request = this.factory!.open("aic-notes-pwa-source-bindings", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("sources", { keyPath: "entityId" });
      request.onerror = request.onblocked = () =>
        reject(
          new PwaError(
            "storage",
            "The browser could not remember shared file access.",
          ),
        );
      request.onsuccess = () => resolve(request.result);
    });
  }

  async read(entityId: string): Promise<unknown | null> {
    validateEntityId(entityId);
    const database = await this.database();
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction("sources", "readonly");
        const request = transaction.objectStore("sources").get(entityId);
        let result: unknown = null;
        request.onsuccess = () => {
          const binding: unknown = request.result;
          if (binding === undefined) return;
          if (
            !binding ||
            typeof binding !== "object" ||
            Reflect.ownKeys(binding).length !== 2 ||
            !Object.hasOwn(binding, "entityId") ||
            !Object.hasOwn(binding, "handle") ||
            (binding as { entityId: unknown }).entityId !== entityId
          ) {
            transaction.abort();
            return;
          }
          result = (binding as { handle: unknown }).handle;
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () =>
          reject(
            new PwaError(
              "storage",
              "The browser could not restore shared file access.",
            ),
          );
      });
    } finally {
      database.close();
    }
  }

  async write(entityId: string, handle: EncryptedFileHandle): Promise<void> {
    validateEntityId(entityId);
    if (!isHandle(handle))
      throw new PwaError("invalid", "Cannot remember an unsupported source.");
    const database = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("sources", "readwrite");
        transaction.objectStore("sources").put({ entityId, handle });
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(
            new PwaError(
              "storage",
              "The browser could not remember shared file access.",
            ),
          );
      });
    } finally {
      database.close();
    }
  }
}

export async function rememberSource(
  entityId: string,
  source: EncryptedSource,
  persistence: SourceBindingPersistence = new IndexedDbSourceBindings(),
): Promise<boolean> {
  validateEntityId(entityId);
  const handle = handles.get(source);
  if (!handle) return false;
  await persistence.write(entityId, handle);
  return true;
}

/** Restoration queries existing permission only. It never opens a prompt on app startup. */
export async function reopenSource(
  entityId: string,
  persistence: SourceBindingPersistence = new IndexedDbSourceBindings(),
): Promise<EncryptedSource | null> {
  validateEntityId(entityId);
  const handle = await persistence.read(entityId);
  if (handle === null) return null;
  if (!isHandle(handle))
    throw new PwaError(
      "invalid",
      "Remembered shared file access is unsupported.",
    );
  if (
    handle.queryPermission &&
    (await handle.queryPermission({ mode: "readwrite" })) !== "granted"
  )
    return null;
  // Without queryPermission there is no way to prove an old handle can be reopened silently.
  if (!handle.queryPermission) return null;
  return sourceFromHandle(handle);
}
