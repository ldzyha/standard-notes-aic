/**
 * The one PWA note. Its text always lives in this browser (IndexedDB); where
 * the browser can write files it is also bound to one Markdown file handle,
 * which then holds the authoritative text. One store, one optional handle.
 */

export const MAX_NOTE_BYTES = 4 * 1024 * 1024;

export interface NoteFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(options?: {
    keepExistingData: boolean;
    mode: "exclusive";
  }): Promise<{
    write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}

/** Text is the last text written to the file, or the note itself without one. */
export interface NoteRecord {
  text: string;
  revision: number;
  handle?: NoteFileHandle;
}

/** Text typed but not yet saved, kept so a killed page does not lose it. */
export interface NoteDraft {
  text: string;
  /** The note text the draft was typed against. */
  baseText: string;
  savedAt: number;
}

export interface NoteRecords {
  read(): Promise<NoteRecord | null>;
  /** Writes when the stored revision is still `expected`; returns false otherwise. */
  write(record: NoteRecord, expected: number): Promise<boolean>;
  readDraft(): Promise<NoteDraft | null>;
  /** Replaces the stored draft. Starts its write before returning. */
  writeDraft(draft: NoteDraft): Promise<void>;
  /** Removes the stored draft only when it was written at `savedAt`. */
  clearDraft(savedAt: number): Promise<void>;
}

const KEY = "note";
const DRAFT_KEY = "draft";

export class IndexedDbNoteRecords implements NoteRecords {
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory = globalThis.indexedDB) {}
  /** One shared connection, so a write on page hide starts without waiting. */
  private open(): Promise<IDBDatabase> {
    if (!this.factory) throw new Error("This browser cannot store the note.");
    const factory = this.factory;
    return (this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      // A new database: workspaces of earlier versions stay where they are.
      const request = factory.open("aic-notes-pwa-note", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("note");
      request.onsuccess = () => {
        const database = request.result;
        const drop = () => {
          database.close();
          if (this.database === database) this.database = this.opening = null;
        };
        database.onversionchange = database.onclose = drop;
        this.database = database;
        resolve(database);
      };
      request.onerror = request.onblocked = () => {
        this.opening = null;
        reject(new Error("This browser cannot store the note."));
      };
    }));
  }
  private async transact<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, done: (value: T) => void) => void,
  ): Promise<T> {
    const database = this.database ?? (await this.open());
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("note", mode);
      let result: T;
      operation(transaction.objectStore("note"), (value) => {
        result = value;
      });
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () =>
        reject(new Error("The note could not be stored in this browser."));
    });
  }
  read(): Promise<NoteRecord | null> {
    return this.transact("readonly", (store, done) => {
      const request = store.get(KEY);
      request.onsuccess = () => done(valid(request.result));
    });
  }
  write(record: NoteRecord, expected: number): Promise<boolean> {
    return this.transact("readwrite", (store, done) => {
      const request = store.get(KEY);
      request.onsuccess = () => {
        const revision = valid(request.result)?.revision ?? 0;
        done(revision === expected);
        if (revision === expected) store.put(record, KEY);
      };
    });
  }
  readDraft(): Promise<NoteDraft | null> {
    return this.transact("readonly", (store, done) => {
      const request = store.get(DRAFT_KEY);
      request.onsuccess = () => done(validDraft(request.result));
    });
  }
  writeDraft(draft: NoteDraft): Promise<void> {
    return this.transact("readwrite", (store) => {
      store.put(draft, DRAFT_KEY);
    });
  }
  clearDraft(savedAt: number): Promise<void> {
    return this.transact("readwrite", (store) => {
      const request = store.get(DRAFT_KEY);
      request.onsuccess = () => {
        if (validDraft(request.result)?.savedAt === savedAt)
          store.delete(DRAFT_KEY);
      };
    });
  }
}

export class MemoryNoteRecords implements NoteRecords {
  record: NoteRecord | null = null;
  draft: NoteDraft | null = null;
  async readDraft() {
    return this.draft && { ...this.draft };
  }
  async writeDraft(draft: NoteDraft) {
    this.draft = { ...draft };
  }
  async clearDraft(savedAt: number) {
    if (this.draft?.savedAt === savedAt) this.draft = null;
  }
  async read() {
    return this.record && { ...this.record };
  }
  async write(record: NoteRecord, expected: number) {
    if ((this.record?.revision ?? 0) !== expected) return false;
    this.record = { ...record };
    return true;
  }
}

function valid(value: unknown): NoteRecord | null {
  const record = value as NoteRecord | undefined;
  return record &&
    typeof record.text === "string" &&
    Number.isSafeInteger(record.revision) &&
    (record.handle === undefined ||
      (record.handle?.kind === "file" &&
        typeof record.handle.getFile === "function"))
    ? record
    : null;
}

function validDraft(value: unknown): NoteDraft | null {
  const draft = value as NoteDraft | undefined;
  return draft &&
    typeof draft.text === "string" &&
    typeof draft.baseText === "string" &&
    Number.isFinite(draft.savedAt)
    ? draft
    : null;
}

async function readFile(handle: NoteFileHandle): Promise<string> {
  const file = await handle.getFile(); // A missing file is never recreated here.
  if (file.size > MAX_NOTE_BYTES)
    throw new Error("The note file must be 4 MiB or smaller.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error("The note file is not UTF-8 text.");
  }
}

export type NoteAccess = "ready" | "reconnect" | "missing";

type Pickers = {
  showOpenFilePicker?(options: object): Promise<NoteFileHandle[]>;
  showSaveFilePicker?(options: object): Promise<NoteFileHandle>;
};
const MARKDOWN = [
  { description: "Markdown", accept: { "text/markdown": [".md"] } },
];

/** True where this browser can bind the note to a file it writes directly. */
export function canBindFile(host: object = window): boolean {
  return "showOpenFilePicker" in host && "showSaveFilePicker" in host;
}

function canceled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Text of a file chosen with a plain file input; null when canceled. */
export function pickTextFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,text/markdown,text/plain";
    input.addEventListener("cancel", () => resolve(null));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > MAX_NOTE_BYTES)
        return reject(new Error("The note file must be 4 MiB or smaller."));
      file.text().then((text) => resolve({ name: file.name, text }), reject);
    });
    input.click();
  });
}

/** Saves the text through the browser's download. */
export function downloadNote(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** One owner of the note: every read, file write and stored copy goes here. */
export class PwaNote {
  text = "";
  revision = 0;
  handle: NoteFileHandle | null = null;
  access: NoteAccess = "ready";
  /** False until the user has chosen or created the note. */
  exists = false;
  private draftStamp = 0;
  constructor(
    private readonly records: NoteRecords = new IndexedDbNoteRecords(),
    private readonly host: Pickers = window as unknown as Pickers,
  ) {}

  get name(): string {
    return this.handle?.name ?? "aic.md";
  }

  /** Opens the stored note; a bound file is read when access is granted. */
  async load(): Promise<void> {
    const record = await this.records.read();
    if (!record) return;
    this.exists = true;
    this.text = record.text;
    this.revision = record.revision;
    this.handle = record.handle ?? null;
    if (!this.handle) return;
    const state = await this.handle.queryPermission?.({ mode: "readwrite" });
    this.access = !state || state === "granted" ? "ready" : "reconnect";
    if (this.access === "ready") await this.refresh();
  }

  /** Asks again for file access; call it first in a click handler. */
  async reconnect(): Promise<void> {
    if (!this.handle) return;
    const state = await this.handle.requestPermission?.({ mode: "readwrite" });
    if (state && state !== "granted")
      throw new Error("Access to the note file was not granted.");
    this.access = "ready";
    await this.refresh();
  }

  /** Reads the bound file; it replaces the stored copy when they differ. */
  private async refresh(): Promise<void> {
    // Another window may have saved or chosen a file since this one loaded.
    const current = await this.records.read();
    if (current) {
      this.revision = current.revision;
      this.handle = current.handle ?? this.handle;
    }
    try {
      const text = await readFile(this.handle!);
      if (text !== this.text) await this.store(text, this.handle!);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        this.access = "missing";
        return;
      }
      throw error;
    }
  }

  /** Keeps unsaved text beside the note. Its write starts before this returns. */
  keepDraft(text: string): Promise<void> {
    // The fraction tells windows apart: only the writer removes its draft.
    this.draftStamp = Math.max(Date.now() + Math.random(), this.draftStamp + 1);
    return this.records.writeDraft({
      text,
      baseText: this.text,
      savedAt: this.draftStamp,
    });
  }

  /** The draft left by an earlier page, if any. */
  savedDraft(): Promise<NoteDraft | null> {
    return this.records.readDraft();
  }

  /** Removes this window's draft, or `draft` when it is the stored one. */
  dropDraft(draft?: NoteDraft): Promise<void> {
    return this.records.clearDraft(draft?.savedAt ?? this.draftStamp);
  }

  /** Makes a stored draft this window's own, so saving it clears it. */
  adoptDraft(draft: NoteDraft): void {
    this.draftStamp = draft.savedAt;
  }

  /**
   * Lets the user choose the note: an existing file (`create` false) or a new
   * one. Where files cannot be bound, the chosen file's text becomes the note
   * and a new note starts empty. Returns false when the user cancels. Call it
   * first in a click handler.
   */
  async choose(create: boolean): Promise<boolean> {
    if (!canBindFile(this.host as object)) {
      const picked = create ? { text: "" } : await pickTextFile();
      if (!picked) return false;
      await this.store(picked.text);
      return true;
    }
    let handle: NoteFileHandle;
    try {
      handle = create
        ? await this.host.showSaveFilePicker!({
            suggestedName: "aic.md",
            types: MARKDOWN,
          })
        : (await this.host.showOpenFilePicker!({ types: MARKDOWN }))[0]!;
    } catch (error) {
      if (canceled(error)) return false;
      throw error;
    }
    let text = await readFile(handle).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotFoundError")
        return "";
      throw error;
    });
    // A new file starts with the text of a note whose file went missing.
    if (create && !text && this.access === "missing" && this.text) {
      text = this.text;
      await write(handle, null, text);
    }
    this.access = "ready";
    await this.store(text, handle);
    return true;
  }

  /**
   * Saves the text. With a bound file the file is written first, only while it
   * still holds the text last read or written (compare and swap); the stored
   * copy follows and its failure is returned as a warning.
   */
  async save(text: string): Promise<string | undefined> {
    if (text === this.text) return undefined;
    if (this.handle) {
      const state = await this.handle.queryPermission?.({ mode: "readwrite" });
      if (state && state !== "granted") this.access = "reconnect";
      if (this.access !== "ready")
        throw new Error("Reconnect the note file first. Your draft is kept.");
      await write(this.handle, this.text, text);
      try {
        await this.store(text, this.handle);
      } catch {
        this.text = text;
        return "The note file is saved; this browser's copy could not be updated.";
      }
      return undefined;
    }
    await this.store(text);
    return undefined;
  }

  private async store(text: string, handle?: NoteFileHandle): Promise<void> {
    for (let retry = true; ; retry = false) {
      const record: NoteRecord = {
        text,
        revision: this.revision + 1,
        ...(handle ? { handle } : {}),
      };
      if (await this.records.write(record, this.revision)) {
        this.exists = true;
        this.text = text;
        this.revision = record.revision;
        this.handle = handle ?? null;
        return;
      }
      // Another window only moved the revision: continue from it, once.
      const current = await this.records.read();
      if (!retry || current?.text !== this.text) throw new NoteConflictError();
      this.revision = current.revision;
    }
  }
}

/** The stored note was changed by another window. */
export class NoteConflictError extends Error {
  constructor() {
    super(
      "The note changed in another window. Reload the note file to continue.",
    );
    this.name = "NoteConflictError";
  }
}

/** Writes `text` only while the file still holds `expected` (null: a new file). */
async function write(
  handle: NoteFileHandle,
  expected: string | null,
  text: string,
): Promise<void> {
  const unchanged = async () => {
    if (expected !== null && (await readFile(handle)) !== expected)
      throw new Error(
        "The note file changed outside AIC Notes. Your draft is kept: download it, then reload the note file.",
      );
  };
  await unchanged();
  const writable = await handle.createWritable({
    keepExistingData: false,
    mode: "exclusive",
  });
  let closed = false;
  try {
    await unchanged();
    await writable.write(new TextEncoder().encode(text));
    await unchanged();
    await writable.close();
    closed = true;
  } finally {
    if (!closed) await writable.abort?.().catch(() => {});
  }
}
