import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPwaFile,
  fileBytes,
  fileText,
  type WorkspacePayload,
} from "../src/pwa/model";
import type { PwaRepository } from "../src/pwa/controller";
import type { MemoryPwaPersistence } from "../src/pwa/storage";
import type { FileSelectionOptions, PickedFiles } from "../src/pwa/files";
import type { MarkdownFileHandle, MarkdownSelection } from "../src/pwa/disk";

const state = vi.hoisted(() => ({
  repository: null as PwaRepository | null,
  persistence: null as MemoryPwaPersistence | null,
  failCache: false,
  failDisk: false,
  nativeAccess: true,
  pauseDiskWrite: null as (() => Promise<void>) | null,
  saveAsName: null as string | null,
  diskBindings: new Map<string, MarkdownSelection>(),
  diskFiles: new Map<string, { handle: MarkdownFileHandle; text(): string }>(),
  pauseLocalWrite: null as (() => Promise<void>) | null,
  pauseLocalList: null as (() => Promise<void>) | null,
  pickedFiles: null as PickedFiles | null,
  pickSelection: null as
    ((options: FileSelectionOptions) => Promise<PickedFiles | null>) | null,
  downloads: [] as Blob[],
}));

function nativeFile(
  path: string,
  initial = new Uint8Array(),
): MarkdownFileHandle {
  let bytes = Uint8Array.from(initial);
  let modified = 1;
  const handle: MarkdownFileHandle = {
    kind: "file",
    name: path.split("/").at(-1)!,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () => {
      const snapshot = Uint8Array.from(bytes);
      return {
        size: snapshot.length,
        type: "text/markdown",
        lastModified: modified,
        arrayBuffer: async () => snapshot.buffer,
      };
    },
    createWritable: async () => {
      let pending = bytes;
      return {
        write: async (next) => {
          pending = Uint8Array.from(next);
        },
        close: async () => {
          await state.pauseDiskWrite?.();
          if (state.failDisk)
            throw new Error("Synthetic original-file write failure");
          bytes = pending;
          modified += 1;
        },
        abort: async () => {},
      };
    },
  };
  state.diskFiles.set(path, {
    handle,
    text: () => new TextDecoder().decode(bytes),
  });
  return handle;
}

function bindSelection(selection: PickedFiles | null): PickedFiles | null {
  if (!selection || selection.disk || !state.nativeAccess) return selection;
  return {
    ...selection,
    disk: {
      files: selection.files.map((file) => ({
        id: file.id,
        path: file.path,
        handle: nativeFile(file.path, fileBytes(file)),
      })),
    },
  };
}

vi.mock("../src/pwa/disk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pwa/disk")>();
  return {
    ...actual,
    MarkdownDisk: class extends actual.MarkdownDisk {
      constructor() {
        super({
          read: async (id) => state.diskBindings.get(id) ?? null,
          write: async (id, selection) => {
            state.diskBindings.set(id, selection);
          },
          remove: async (id) => {
            state.diskBindings.delete(id);
          },
        });
      }
    },
  };
});

vi.mock("../src/pwa/controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pwa/controller")>();
  const { MemoryPwaPersistence } = await import("../src/pwa/storage");
  return {
    ...actual,
    PwaRepository: class extends actual.PwaRepository {
      constructor() {
        const persistence = new MemoryPwaPersistence();
        super({
          listLocal: async () => {
            await state.pauseLocalList?.();
            return persistence.listLocal();
          },
          readLocal: (id) => persistence.readLocal(id),
          writeLocal: async (entity, expected) => {
            await state.pauseLocalWrite?.();
            return state.failCache
              ? Promise.reject(new Error("Synthetic device cache failure"))
              : persistence.writeLocal(entity, expected);
          },
          removeLocal: (id, expected) => persistence.removeLocal(id, expected),
        });
        state.repository = this;
        state.persistence = persistence;
      }
    },
  };
});

vi.mock("../src/pwa/ai-controls", () => ({
  attachLocalAI: () => ({ cancel() {}, dispose() {} }),
}));
vi.mock("../src/pwa/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pwa/files")>();
  const pick = async (options: FileSelectionOptions) =>
    bindSelection(
      state.pickSelection
        ? await state.pickSelection({
            ...options,
            onBatch:
              options.onBatch &&
              ((batch, checkpoint) =>
                options.onBatch!(bindSelection(batch)!, checkpoint)),
          })
        : state.pickedFiles,
    );
  return {
    ...actual,
    pickFiles: pick,
    pickFolder: pick,
  };
});
vi.mock("../src/editor", () => ({
  AicEditor: class {
    private readonly field: HTMLTextAreaElement;
    constructor(
      container: HTMLElement,
      options: {
        initialText: string;
        readOnly?: boolean;
        onChange(text: string): void;
      },
    ) {
      this.field = document.createElement("textarea");
      this.field.className = "synthetic-editor";
      this.field.value = options.initialText;
      this.field.readOnly = !!options.readOnly;
      this.field.addEventListener("input", () => {
        if (!this.field.readOnly) options.onChange(this.field.value);
      });
      container.append(this.field);
    }
    switchDocument(id: string, text: string) {
      this.field.dataset.documentId = id;
      this.field.value = text;
    }
    setReadOnly(readOnly: boolean) {
      this.field.readOnly = readOnly;
    }
    setSaveState(value: string) {
      this.field.dataset.saveState = value;
    }
    destroy() {
      this.field.remove();
    }
  },
}));

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
const listeners: {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}[] = [];
const urlCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const urlRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const dialogShow = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const dialogClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

function control(label: string): HTMLButtonElement {
  if (label === "Rename entity") label = "Rename workspace";
  const opens = ["Open files", "Open folder"];
  let found = [...document.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === label,
  );
  if (!found && !["Note options", "Workspace options"].includes(label)) {
    const menu = opens.includes(label)
      ? "Workspace options"
      : [
            "Rename note",
            "Advanced note path",
            "Export Markdown",
            "Note details",
            "Save to file",
            "Save a copy",
          ].includes(label)
        ? "Note options"
        : "Workspace options";
    [...document.querySelectorAll("button")]
      .find((element) => element.getAttribute("aria-label") === menu)
      ?.click();
    found = [...document.querySelectorAll("button")].find(
      (element) => element.getAttribute("aria-label") === label,
    );
  }
  if (!found) throw new Error(`Missing action: ${label}`);
  return found;
}

async function idle() {
  await vi.waitFor(() =>
    expect(document.querySelector("main")?.hasAttribute("aria-busy")).toBe(
      false,
    ),
  );
}

async function answer(values: Record<string, string>) {
  await vi.waitFor(() =>
    expect(document.querySelector("dialog form")).not.toBeNull(),
  );
  const form = document.querySelector<HTMLFormElement>("dialog form")!;
  for (const [name, value] of Object.entries(values)) {
    const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (!input) throw new Error("Missing dialog field");
    input.value = value;
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function newNote(path: string) {
  state.saveAsName = path;
  control("New note").click();
  await idle();
  state.saveAsName = null;
  const title = document.querySelector(".pwa-title");
  if ((title?.getAttribute("title") ?? title?.textContent) !== path) {
    control("Advanced note path").click();
    await answer({ name: path });
    await idle();
  }
}

function editorField(): HTMLTextAreaElement {
  const field =
    document.querySelector<HTMLTextAreaElement>(".synthetic-editor");
  if (!field) throw new Error("No active editor");
  return field;
}

function type(text: string): boolean {
  const field = editorField();
  if (field.readOnly || field.disabled) return false;
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

async function saveShortcut() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await idle();
}

async function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeEach(async () => {
  vi.resetModules();
  state.repository = null;
  state.persistence = null;
  state.failCache = false;
  state.failDisk = false;
  state.nativeAccess = true;
  state.pauseDiskWrite = null;
  state.saveAsName = null;
  state.diskBindings.clear();
  state.diskFiles.clear();
  state.pauseLocalWrite = null;
  state.pauseLocalList = null;
  state.pickedFiles = null;
  state.pickSelection = null;
  state.downloads = [];
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(globalThis, "setInterval").mockReturnValue(
    0 as unknown as ReturnType<typeof setInterval>,
  );
  const originalTimeout = globalThis.setTimeout.bind(globalThis);
  vi.spyOn(globalThis, "setTimeout").mockImplementation(
    (callback, delay, ...args) =>
      delay === 60000
        ? (0 as unknown as ReturnType<typeof setTimeout>)
        : originalTimeout(callback, delay, ...args),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (blob: Blob) => {
      state.downloads.push(blob);
      return "blob:synthetic-download";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    value: async ({ suggestedName }: { suggestedName: string }) =>
      nativeFile(state.saveAsName ?? suggestedName),
  });
  const addWindow = window.addEventListener.bind(window);
  const addDocument = document.addEventListener.bind(document);
  vi.spyOn(window, "addEventListener").mockImplementation(
    (event, listener, options) => {
      listeners.push({ target: window, type: event, listener, options });
      addWindow(event, listener, options);
    },
  );
  vi.spyOn(document, "addEventListener").mockImplementation(
    (event, listener, options) => {
      listeners.push({ target: document, type: event, listener, options });
      addDocument(event, listener, options);
    },
  );
  await import("../src/pwa/main");
  await vi.waitFor(() =>
    expect(document.querySelector(".pwa-empty")).not.toBeNull(),
  );
});

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  for (const entry of listeners.splice(0))
    entry.target.removeEventListener(entry.type, entry.listener, entry.options);
  Reflect.deleteProperty(window, "showSaveFilePicker");
  Reflect.deleteProperty(window, "showOpenFilePicker");
  if (urlCreate) Object.defineProperty(URL, "createObjectURL", urlCreate);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (urlRevoke) Object.defineProperty(URL, "revokeObjectURL", urlRevoke);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
  if (dialogShow)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", dialogShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (dialogClose)
    Object.defineProperty(HTMLDialogElement.prototype, "close", dialogClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("PWA direct Markdown workspaces", () => {
  it("edits and downloads Markdown when native writable files are unavailable without claiming a disk save", async () => {
    Reflect.deleteProperty(window, "showSaveFilePicker");
    control("New note").click();
    await idle();
    expect(editorField().value).toBe("");
    expect(editorField().readOnly).toBe(false);
    expect(type("# Download-only note")).toBe(true);
    await saveShortcut();
    expect(document.querySelector(".pwa-status")?.textContent).toBe(
      "Browser draft · download to save",
    );
    expect(state.diskFiles.size).toBe(0);
    const record = (await state.repository!.listLocal())[0]!;
    expect(fileText(record.payload.files[0]!)).toBe("# Download-only note");
    control("Save a copy").click();
    await idle();
    expect(await readBlob(state.downloads.at(-1)!)).toBe(
      "# Download-only note",
    );
    expect(document.querySelector(".pwa-status")?.textContent).not.toBe(
      "Saved to file",
    );
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("keeps imported copies read-only until Save to file selects an original destination", async () => {
    state.nativeAccess = false;
    state.pickedFiles = {
      files: [
        createPwaFile("copy.md", new TextEncoder().encode("Imported copy")),
      ],
      directories: [],
    };
    control("Open files").click();
    await idle();
    expect(editorField().readOnly).toBe(true);
    expect(type("Must not silently save in browser storage")).toBe(false);
    expect(document.querySelector(".pwa-status")?.textContent).toBe(
      "Browser copy · choose a file",
    );
    control("Save to file").click();
    await idle();
    expect(editorField().readOnly).toBe(false);
    expect(state.diskFiles.get("copy.md")?.text()).toBe("Imported copy");
    expect(type("Written to selected file")).toBe(true);
    await saveShortcut();
    expect(state.diskFiles.get("copy.md")?.text()).toBe(
      "Written to selected file",
    );
    expect(document.querySelector(".pwa-status")?.textContent).toBe(
      "Saved to file",
    );
  });

  it("acknowledges the original file when its secondary cache cannot be updated", async () => {
    await newNote("original.md");
    state.failCache = true;
    expect(type("Durable original-file content")).toBe(true);
    await saveShortcut();
    expect(state.diskFiles.get("original.md")?.text()).toBe(
      "Durable original-file content",
    );
    expect(document.querySelector(".pwa-status")?.textContent).toBe(
      "Saved to file",
    );
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "browser cache could not be updated",
    );
    const cached = (await state.persistence!.listLocal())[0] as {
      payload: WorkspacePayload;
    };
    expect(fileText(cached.payload.files[0]!)).toBe("");
    expect(control("Retry save").hidden).toBe(true);
  });

  it("opens a folder without a passphrase and displays only Markdown files", async () => {
    state.pickedFiles = {
      files: [
        createPwaFile(
          "project/nested/README.MD",
          new TextEncoder().encode("# Folder note"),
        ),
        createPwaFile("project/image.png", new Uint8Array([0, 255])),
      ],
      directories: [],
    };
    control("Open folder").click();
    await idle();
    expect(document.querySelector("dialog")).toBeNull();
    expect(editorField().value).toBe("# Folder note");
    expect(document.querySelector(".pwa-details")?.textContent).toBe(
      "project/nested/README.MD",
    );
    expect(document.querySelector(".pwa-status")?.textContent).toBe(
      "Saved to file",
    );
    expect(
      [...document.querySelectorAll(".pwa-files__item")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["README.MD"]);
    const records = await state.repository!.listLocal();
    expect(records).toHaveLength(1);
    expect(records[0]!.payload.files[0]!.path).toBe("project/nested/README.MD");
    expect(records[0]!.payload.label).toBe("project");
    control("Workspace options").click();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(
      document.querySelector('[aria-label="Save encrypted copy"]'),
    ).toBeNull();
    expect(
      document.querySelector('[aria-label="Create protected workspace"]'),
    ).toBeNull();
  });

  it("adds Markdown notes without charging existing implied parents to the workspace quota", async () => {
    state.pickedFiles = {
      files: Array.from({ length: 900 }, (_, index) =>
        createPwaFile(
          `project/folder-${index}/note.md`,
          new TextEncoder().encode(`Note ${index}`),
        ),
      ),
      directories: [
        "project",
        ...Array.from({ length: 900 }, (_, index) => `project/folder-${index}`),
        "project/empty",
      ],
    };
    control("Open files").click();
    await idle();
    state.pickedFiles = {
      files: Array.from({ length: 1100 }, (_, index) =>
        createPwaFile(
          `second/folder-${index}/note.md`,
          new TextEncoder().encode(`New note ${index}`),
        ),
      ),
      directories: [],
    };
    control("Add folder").click();
    await idle();
    const saved = (await state.repository!.listLocal())[0]!;
    // Exactly 2000 notes plus an explicitly retained empty folder exceeds the
    // unchanged bundle quota: the current valid workspace must remain intact.
    expect(saved.payload.files).toHaveLength(900);
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "Existing files count too",
    );
    state.pickedFiles.files.pop();
    control("Add folder").click();
    await idle();
    const accepted = (await state.repository!.listLocal())[0]!;
    expect(accepted.payload.files).toHaveLength(1999);
    expect(accepted.payload.directories).toEqual(["project/empty"]);
    expect(fileText(accepted.payload.files[0]!)).toBe("Note 0");
    expect(document.querySelector(".pwa-title")?.textContent).toBe("note.md");
    expect(document.querySelector(".pwa-title")?.getAttribute("title")).toBe(
      "second/folder-0/note.md",
    );
    state.pickedFiles = {
      files: [createPwaFile("project/empty/final.md", new Uint8Array())],
      directories: [],
    };
    control("Add files").click();
    await idle();
    const completed = (await state.repository!.listLocal())[0]!;
    expect(completed.payload.files).toHaveLength(2000);
    expect(completed.payload.directories).toEqual([]);
  });

  it("pages and searches a large Markdown list without replacing the editor or losing its draft", async () => {
    state.pickedFiles = {
      files: Array.from({ length: 250 }, (_, index) =>
        createPwaFile(
          `project/note-${String(index).padStart(3, "0")}.md`,
          new TextEncoder().encode(`Note ${index}`),
        ),
      ),
      directories: [],
    };
    control("Open folder").click();
    await idle();
    expect(document.querySelectorAll(".pwa-files__item")).toHaveLength(100);
    const editor = editorField();
    type("# Draft preserved while browsing");
    control("Show more Markdown files").click();
    await idle();
    expect(document.querySelectorAll(".pwa-files__item")).toHaveLength(200);
    expect(editorField()).toBe(editor);
    const search = document.querySelector<HTMLInputElement>(
      '[aria-label="Find Markdown file"]',
    )!;
    search.value = "note-249";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll(".pwa-files__item")).toHaveLength(1);
    expect(editorField()).toBe(editor);
    expect(editor.value).toBe("# Draft preserved while browsing");
    expect(document.querySelector(".pwa-status")?.textContent).toBe("Unsaved");
    control("Open project/note-249.md").click();
    await idle();
    expect(editorField().value).toBe("Note 249");
    const saved = (await state.repository!.listLocal())[0]!;
    expect(fileText(saved.payload.files[0]!)).toBe(
      "# Draft preserved while browsing",
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(search.hidden).toBe(true);
    expect(search.value).toBe("");
    expect(document.querySelector(".pwa-files__summary")?.textContent).toBe("");
  });

  it("cancels folder opening promptly and ignores late progress without changing the current draft", async () => {
    await newNote("draft.md");
    type("# Existing unsaved draft");
    const editor = editorField();
    let progress: FileSelectionOptions["onProgress"];
    state.pickSelection = (options) => {
      progress = options.onProgress;
      progress?.({ phase: "scanning", scanned: 400, selected: 20, read: 0 });
      return new Promise((resolve) =>
        options.signal!.addEventListener("abort", () => resolve(null), {
          once: true,
        }),
      );
    };
    control("Open folder").click();
    await vi.waitFor(() =>
      expect(control("Cancel folder opening").hidden).toBe(false),
    );
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "400 entries checked",
    );
    control("Cancel folder opening").click();
    await idle();
    expect(control("Cancel folder opening").hidden).toBe(true);
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "Opening canceled",
    );
    expect(editorField()).toBe(editor);
    expect(editor.value).toBe("# Existing unsaved draft");
    expect(editor.readOnly).toBe(false);
    expect(document.querySelector(".pwa-status")?.textContent).toBe("Unsaved");
    expect(await state.repository!.listLocal()).toHaveLength(1);
    expect(
      fileText((await state.repository!.listLocal())[0]!.payload.files[0]!),
    ).toBe("");
    progress?.({
      phase: "reading",
      scanned: 400,
      selected: 20,
      read: 20,
      total: 20,
    });
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "Opening canceled",
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(document.querySelector(".pwa-notice")?.textContent).toBe("");
  });

  it("persists and displays scan batches before the folder traversal finishes", async () => {
    let continueScan!: () => void;
    const checkpoint = {
      root: "project",
      batchIndex: 1,
      scanned: 1000,
      selected: 1,
      read: 1,
      done: false,
    };
    state.pickSelection = async (options) => {
      await options.onBatch!(
        {
          files: [
            createPwaFile(
              "project/first.md",
              new TextEncoder().encode("First saved batch"),
            ),
          ],
          directories: [],
        },
        checkpoint,
      );
      await new Promise<void>((resolve) => {
        continueScan = resolve;
      });
      await options.onBatch!(
        {
          files: [
            createPwaFile(
              "project/second.md",
              new TextEncoder().encode("Second saved batch"),
            ),
          ],
          directories: [],
        },
        { ...checkpoint, batchIndex: 2, scanned: 2000, selected: 2, read: 2 },
      );
      await options.onBatch!(
        { files: [], directories: [] },
        {
          ...checkpoint,
          batchIndex: 3,
          scanned: 2500,
          selected: 2,
          read: 2,
          done: true,
        },
      );
      return { files: [], directories: [], committedFiles: 2 };
    };
    control("Open folder").click();
    await vi.waitFor(() => expect(continueScan).toBeTypeOf("function"));
    expect(editorField().value).toBe("First saved batch");
    const first = (await state.repository!.listLocal())[0]!;
    expect(first.payload.files).toHaveLength(1);
    expect(first.payload.label).toBe("project");
    expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    continueScan();
    await idle();
    const final = (await state.repository!.listLocal())[0]!;
    expect(final.id).toBe(first.id);
    expect(final.payload.files.map((file) => file.path)).toEqual([
      "project/first.md",
      "project/second.md",
    ]);
    expect(editorField().value).toBe("First saved batch");
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "2 Markdown notes opened",
    );
  });

  it("keeps committed notes when the user cancels the remaining folder scan", async () => {
    state.pickSelection = async (options) => {
      await options.onBatch!(
        {
          files: [
            createPwaFile(
              "project/saved.md",
              new TextEncoder().encode("Saved before cancellation"),
            ),
          ],
          directories: [],
        },
        {
          root: "project",
          batchIndex: 1,
          scanned: 1000,
          selected: 1,
          read: 1,
          done: false,
        },
      );
      return new Promise((resolve) =>
        options.signal!.addEventListener("abort", () => resolve(null), {
          once: true,
        }),
      );
    };
    control("Open folder").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".synthetic-editor")).not.toBeNull(),
    );
    control("Cancel folder opening").click();
    await idle();
    expect(
      (await state.repository!.listLocal())[0]!.payload.files,
    ).toHaveLength(1);
    expect(editorField().value).toBe("Saved before cancellation");
    expect(editorField().readOnly).toBe(false);
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "1 notes are saved",
    );
  });

  it("keeps earlier committed batches when a later device write fails", async () => {
    const checkpoint = {
      root: "project",
      batchIndex: 1,
      scanned: 1000,
      selected: 1,
      read: 1,
      done: false,
    };
    state.pickSelection = async (options) => {
      await options.onBatch!(
        {
          files: [
            createPwaFile(
              "project/saved.md",
              new TextEncoder().encode("Committed"),
            ),
          ],
          directories: [],
        },
        checkpoint,
      );
      state.failCache = true;
      await options.onBatch!(
        {
          files: [createPwaFile("project/failed.md", new Uint8Array())],
          directories: [],
        },
        { ...checkpoint, batchIndex: 2, scanned: 2000 },
      );
      throw new Error("The failed save must stop traversal");
    };
    control("Open folder").click();
    await idle();
    expect(
      (await state.repository!.listLocal())[0]!.payload.files.map(
        (file) => file.path,
      ),
    ).toEqual(["project/saved.md"]);
    expect(editorField().value).toBe("Committed");
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "1 notes already saved",
    );
  });

  it("does not commit a late scan batch after the page closes", async () => {
    let continueScan!: () => void;
    const checkpoint = {
      root: "project",
      batchIndex: 1,
      scanned: 1000,
      selected: 1,
      read: 1,
      done: false,
    };
    state.pickSelection = async (options) => {
      await options.onBatch!(
        {
          files: [createPwaFile("project/saved.md", new Uint8Array())],
          directories: [],
        },
        checkpoint,
      );
      await new Promise<void>((resolve) => {
        continueScan = resolve;
      });
      await options.onBatch!(
        {
          files: [createPwaFile("project/late.md", new Uint8Array())],
          directories: [],
        },
        { ...checkpoint, batchIndex: 2 },
      );
      return { files: [], directories: [], committedFiles: 2 };
    };
    control("Open folder").click();
    await vi.waitFor(() => expect(continueScan).toBeTypeOf("function"));
    window.dispatchEvent(new Event("pagehide"));
    continueScan();
    await idle();
    expect((await state.persistence!.listLocal())[0]).toMatchObject({
      payload: { files: [{ path: "project/saved.md" }] },
    });
    expect(document.querySelector(".synthetic-editor")).toBeNull();
    expect(document.querySelector(".pwa-notice")?.textContent).toBe("");
  });

  it("does not create a workspace when file selection is canceled or has no Markdown files", async () => {
    control("Open files").click();
    await idle();
    expect(await state.repository!.listLocal()).toEqual([]);
    state.pickedFiles = { files: [], directories: ["empty"] };
    control("Open folder").click();
    await idle();
    expect(await state.repository!.listLocal()).toEqual([]);
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "no .md files",
    );
  });

  it("saves and reopens an unencrypted note without asking for a password", async () => {
    await newNote("draft.md");
    type("# Local saved content");
    await saveShortcut();
    window.dispatchEvent(new Event("pagehide"));
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);
    await idle();
    await vi.waitFor(() =>
      expect(
        document.querySelector(".pwa-entities__item")?.textContent,
      ).toContain("Workspace 1"),
    );
    control("Open Workspace 1").click();
    await idle();
    expect(document.querySelector("dialog")).toBeNull();
    control("Open draft.md").click();
    await idle();
    expect(editorField().value).toBe("# Local saved content");
    expect(await state.repository!.listLocal()).toHaveLength(1);
  });

  it("does not remount a workspace when its initial save completes after pagehide", async () => {
    let release: (() => void) | undefined;
    state.pauseLocalWrite = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    control("New note").click();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    window.dispatchEvent(new Event("pagehide"));
    release!();
    await idle();
    expect(document.querySelector(".pwa-title")?.textContent).toBe(
      "Start editing",
    );
    expect(document.querySelector(".synthetic-editor")).toBeNull();
    expect(await state.repository!.listLocal()).toHaveLength(1);
    state.pauseLocalWrite = null;
  });

  it("keeps workspace labels and success notices scrubbed when a list read completes after pagehide", async () => {
    let release: (() => void) | undefined;
    state.pauseLocalList = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    state.pickedFiles = {
      files: [
        createPwaFile(
          "Private project/private-note.md",
          new TextEncoder().encode("Private fixture"),
        ),
      ],
      directories: [],
    };
    control("Open folder").click();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    window.dispatchEvent(new Event("pagehide"));
    release!();
    await idle();
    expect(document.querySelectorAll(".pwa-entities__item")).toHaveLength(0);
    expect(document.querySelector(".pwa-title")?.textContent).toBe(
      "Start editing",
    );
    expect(document.querySelector(".pwa-notice")?.textContent).toBe("");
    expect(document.querySelector(".synthetic-editor")).toBeNull();
    state.pauseLocalList = null;
    expect(await state.repository!.listLocal()).toHaveLength(1);
  });

  it("ignores a folder error that completes after pagehide", async () => {
    let fail: ((error: Error) => void) | undefined;
    state.pickSelection = () =>
      new Promise((_, reject) => {
        fail = reject;
      });
    control("Open folder").click();
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
    window.dispatchEvent(new Event("pagehide"));
    fail!(new Error("Private project/private-note.md was unavailable"));
    await idle();
    expect(document.querySelector(".pwa-notice")?.textContent).toBe("");
    expect(control("Cancel folder opening").hidden).toBe(true);
    expect(document.querySelector(".synthetic-editor")).toBeNull();
  });

  it("retains the editable plaintext draft if the original file write fails", async () => {
    await newNote("draft.md");
    state.failDisk = true;
    type("# Unsaved local recovery");
    await saveShortcut();
    expect(editorField().value).toBe("# Unsaved local recovery");
    expect(document.querySelector(".pwa-status")?.textContent).toBe(
      "Save failed",
    );
    expect(control("Retry save").hidden).toBe(false);
    const record = (await state.repository!.listLocal())[0]!;
    expect(fileText(record.payload.files[0]!)).toBe("");
    expect(editorField().readOnly).toBe(false);
  });
  it("starts one editable local note directly and exposes file and folder opening without a menu", async () => {
    const landing = document.querySelector(".pwa-actions")!;
    expect(
      [...landing.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["New note", "Open files", "Open folder"]);
    expect(document.querySelector('[aria-label="Open notes"]')).toBeNull();
    expect(
      document.querySelector(
        '.pwa-note-header__title[aria-label="Rename note"]',
      ),
    ).toBeNull();
    landing
      .querySelector<HTMLButtonElement>('[aria-label="New note"]')!
      .click();
    await idle();
    const workspaces = await state.repository!.listLocal();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!.payload.files).toHaveLength(1);
    expect(fileText(workspaces[0]!.payload.files[0]!)).toBe("");
    expect(editorField().readOnly).toBe(false);
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.querySelector("main")?.dataset.hasNote).toBe("true");
    const status = document.querySelector<HTMLElement>(".pwa-status")!;
    expect(status.textContent).toBe("Saved to file");
    expect(status.dataset.state).toBe("saved");
    expect(status.getAttribute("aria-label")).toBe("Saved to file");
    expect(status.title).toBe("Saved to file");
    expect(
      document.querySelectorAll(
        '.pwa-browser-actions [aria-label="Open files"], .pwa-browser-actions [aria-label="Open folder"]',
      ),
    ).toHaveLength(2);
  });

  it("moves the single notes browser into a modal and restores it on Escape and browser Back without replacing the editor", async () => {
    control("New note").click();
    await idle();
    const sidebar = document.querySelector(".pwa-sidebar")!;
    const field = editorField();
    type("Retained selection");
    field.setSelectionRange(2, 7);
    const origin = control("Browse notes");
    origin.focus();
    origin.click();
    const drawer =
      document.querySelector<HTMLDialogElement>(".pwa-notes-drawer")!;
    expect(drawer.open).toBe(true);
    expect(drawer.querySelector(".pwa-sidebar")).toBe(sidebar);
    expect(document.querySelector(".pwa-layout > .pwa-sidebar")).toBeNull();
    expect(document.querySelectorAll(".synthetic-editor")).toHaveLength(1);
    expect(document.querySelector("main")?.dataset.screen).toBe("editor");
    drawer.dispatchEvent(new Event("cancel", { cancelable: true }));
    await vi.waitFor(() =>
      expect(history.state?.aicNotesDrawer).not.toBe(true),
    );
    expect(document.querySelector(".pwa-layout > .pwa-sidebar")).toBe(sidebar);
    expect(document.activeElement).toBe(origin);
    expect(editorField()).toBe(field);
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(7);
    origin.click();
    history.back();
    await vi.waitFor(() =>
      expect(document.querySelector(".pwa-notes-drawer")).toBeNull(),
    );
    expect(document.querySelector(".pwa-layout > .pwa-sidebar")).toBe(sidebar);
    expect(editorField()).toBe(field);
    expect(document.querySelector("main")?.dataset.screen).toBe("editor");
  });

  it("closes the Notes drawer before Workspace options and returns focus to its editor Back control", async () => {
    control("New note").click();
    await idle();
    const back = control("Browse notes");
    back.focus();
    back.click();
    expect(
      document.querySelector<HTMLDialogElement>(".pwa-notes-drawer")?.open,
    ).toBe(true);

    control("Workspace options").click();
    await idle();
    const sheet = document.querySelector<HTMLDialogElement>(".pwa-sheet")!;
    expect(sheet.open).toBe(true);
    expect(document.querySelector(".pwa-notes-drawer")).toBeNull();
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    await vi.waitFor(() =>
      expect(history.state?.aicNotesDrawer).not.toBe(true),
    );

    control("Close menu").click();
    expect(document.querySelector(".pwa-sheet")).toBeNull();
    expect(document.activeElement).toBe(back);
  });

  it("returns a failed selection save to the unchanged editor with its draft and Retry", async () => {
    control("New note").click();
    await idle();
    control("New note").click();
    await idle();
    const field = editorField();
    const id = field.dataset.documentId;
    type("Recoverable current draft");
    state.failDisk = true;
    control("Browse notes").click();
    expect(
      document.querySelector<HTMLDialogElement>(".pwa-notes-drawer")?.open,
    ).toBe(true);
    control("Open note.md").click();
    await idle();
    expect(document.querySelector(".pwa-notes-drawer")).toBeNull();
    expect(editorField()).toBe(field);
    expect(field.dataset.documentId).toBe(id);
    expect(field.value).toBe("Recoverable current draft");
    expect(field.readOnly).toBe(false);
    expect(control("Retry save").hidden).toBe(false);
    expect(
      document.querySelector<HTMLElement>(".pwa-status")?.dataset.state,
    ).toBe("failed");
  });

  it("preserves the mounted draft and selection through browsing, filtering and menus before saving an explicit copy", async () => {
    control("New note").click();
    await idle();
    const field = editorField();
    type("# Retained draft");
    field.setSelectionRange(2, 8);
    field.scrollTop = 20;
    const id = field.dataset.documentId;
    control("Browse notes").click();
    await idle();
    expect(document.querySelector("main")?.dataset.screen).toBe("editor");
    expect(
      document.querySelector<HTMLDialogElement>(".pwa-notes-drawer")?.open,
    ).toBe(true);
    const search =
      document.querySelector<HTMLInputElement>(".pwa-files__filter")!;
    search.value = "note";
    search.dispatchEvent(new Event("input"));
    control("Open note.md").click();
    await idle();
    expect(editorField()).toBe(field);
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(8);
    state.saveAsName = "Renamed.md";
    control("Save a copy").click();
    await idle();
    expect(editorField()).toBe(field);
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(8);
    expect(editorField().dataset.documentId).toBe(id);
    expect(editorField().value).toBe("# Retained draft");
    expect(state.diskFiles.get("note.md")?.text()).toBe("# Retained draft");
    expect(state.diskFiles.get("Renamed.md")?.text()).toBe("# Retained draft");
    expect(
      (await state.repository!.listLocal())[0]!.payload.files[0]!.path,
    ).toBe("Renamed.md");
    control("Help and about").click();
    expect(document.querySelectorAll("dialog a")).toHaveLength(3);
    control("Close menu").click();
    control("Help and about").click();
    expect(document.querySelectorAll("dialog a")).toHaveLength(3);
  });

  it("creates uniquely named drafts without a path dialog and keeps Open separate from Add", async () => {
    control("New note").click();
    await idle();
    expect(document.querySelector("dialog")).toBeNull();
    control("New note").click();
    await idle();
    const original = (await state.repository!.listLocal())[0]!;
    expect(original.payload.files.map((file) => file.path)).toEqual([
      "note.md",
      "note-2.md",
    ]);
    state.saveAsName = "note.md";
    control("Save a copy").click();
    await idle();
    expect(document.querySelector(".pwa-notice")?.textContent).toContain(
      "already open",
    );
    expect(
      (await state.repository!.listLocal())[0]!.payload.files.map(
        (file) => file.path,
      ),
    ).toEqual(["note.md", "note-2.md"]);
    state.pickedFiles = {
      files: [createPwaFile("opened.md", new Uint8Array())],
      directories: [],
    };
    control("Open files").click();
    await idle();
    expect(await state.repository!.listLocal()).toHaveLength(2);
    state.pickedFiles = {
      files: [createPwaFile("added.md", new Uint8Array())],
      directories: [],
    };
    control("Add files").click();
    await idle();
    const workspaces = await state.repository!.listLocal();
    expect(workspaces).toHaveLength(2);
    expect(
      workspaces.find((item) => item.id === original.id)!.payload.files,
    ).toHaveLength(2);
    expect(
      workspaces
        .find((item) => item.id !== original.id)!
        .payload.files.map((file) => file.path),
    ).toEqual(["opened.md", "added.md"]);
  });

  it("autosaves through the local owner, retains failed drafts and retries explicitly", async () => {
    control("New note").click();
    await idle();
    type("Autosaved");
    await vi.waitFor(
      async () =>
        expect(
          fileText((await state.repository!.listLocal())[0]!.payload.files[0]!),
        ).toBe("Autosaved"),
      { timeout: 2000 },
    );
    state.failDisk = true;
    type("Recoverable");
    await vi.waitFor(
      () =>
        expect(document.querySelector(".pwa-status")?.textContent).toBe(
          "Save failed",
        ),
      { timeout: 2000 },
    );
    const field = editorField();
    expect(field.value).toBe("Recoverable");
    state.failDisk = false;
    control("Retry save").click();
    await idle();
    expect(editorField()).toBe(field);
    expect(document.querySelector(".pwa-status")?.textContent).toBe(
      "Saved to file",
    );
    expect(
      fileText((await state.repository!.listLocal())[0]!.payload.files[0]!),
    ).toBe("Recoverable");
  });

  it("restores saved workspace choices on return and handles browser Back without replacing the editor", async () => {
    control("New note").click();
    await idle();
    type("Survives navigation");
    await saveShortcut();
    const field = editorField();
    window.dispatchEvent(new PopStateEvent("popstate"));
    await idle();
    expect(document.querySelector("main")?.dataset.screen).toBe("browser");
    expect(editorField()).toBe(field);
    window.dispatchEvent(new Event("pagehide"));
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);
    await vi.waitFor(() =>
      expect(document.querySelector("main")?.dataset.hasWorkspaces).toBe(
        "true",
      ),
    );
    const selector = document.querySelector<HTMLSelectElement>(
      ".pwa-workspace-select",
    )!;
    await vi.waitFor(() =>
      expect(
        [...selector.options].map((option) => option.textContent),
      ).toContain("Workspace 1"),
    );
    selector.value = [...selector.options].find(
      (option) => option.textContent === "Workspace 1",
    )!.value;
    selector.dispatchEvent(new Event("change"));
    await idle();
    control("Open note.md").click();
    await idle();
    expect(editorField().value).toBe("Survives navigation");
  });

  it("does not resurrect a failed save or plaintext UI after pagehide", async () => {
    control("New note").click();
    await idle();
    let release: (() => void) | undefined;
    state.pauseDiskWrite = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    state.failDisk = true;
    type("Private draft");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    window.dispatchEvent(new Event("pagehide"));
    release!();
    await idle();
    expect(document.querySelector(".synthetic-editor")).toBeNull();
    expect(document.querySelector(".pwa-notice")?.textContent).toBe("");
    expect(document.querySelector(".pwa-status")?.textContent).not.toBe(
      "Save failed",
    );
  });

  it("chooses a unique draft name against case-insensitive existing paths", async () => {
    state.pickedFiles = {
      files: [createPwaFile("NOTE.md", new Uint8Array())],
      directories: [],
    };
    control("Open files").click();
    await idle();
    control("New note").click();
    await idle();
    expect(
      (await state.repository!.listLocal())[0]!.payload.files.map(
        (file) => file.path,
      ),
    ).toEqual(["NOTE.md", "note-2.md"]);
  });
  it("focuses one file scope, saves its own file, preserves editors and refuses a failed scope switch", async () => {
    const paths = ["app/src/current.md", "app/src.note.md", "app/app.note.md"];
    state.pickedFiles = {
      files: paths.map((path) =>
        createPwaFile(path, new TextEncoder().encode(path)),
      ),
      directories: [],
    };
    control("Open folder").click();
    await idle();
    const current = editorField();
    current.selectionStart = 2;
    current.selectionEnd = 5;
    const tab = (name: string) =>
      document.querySelector<HTMLButtonElement>(
        `[role="tab"][aria-label="${name}"]`,
      )!;
    tab("Shared").click();
    await vi.waitFor(() =>
      expect(tab("Shared").getAttribute("aria-selected")).toBe("true"),
    );
    const shared = document.querySelector<HTMLTextAreaElement>(
      '[role="tabpanel"]:not([hidden]) .synthetic-editor',
    )!;
    expect(shared.value).toBe("app/src.note.md");
    expect(current.closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    state.failDisk = true;
    shared.value = "Changed shared folder note";
    shared.dispatchEvent(new Event("input", { bubbles: true }));
    tab("Global").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".pwa-status")?.textContent).toBe(
        "Save failed",
      ),
    );
    expect(tab("Shared").getAttribute("aria-selected")).toBe("true");
    state.failDisk = false;
    control("Retry save").click();
    await idle();
    tab("Global").click();
    await vi.waitFor(() =>
      expect(tab("Global").getAttribute("aria-selected")).toBe("true"),
    );
    expect(
      document.querySelector<HTMLTextAreaElement>(
        '[role="tabpanel"]:not([hidden]) .synthetic-editor',
      )?.value,
    ).toBe("app/app.note.md");
    tab("Current").click();
    await vi.waitFor(() =>
      expect(tab("Current").getAttribute("aria-selected")).toBe("true"),
    );
    expect(editorField()).toBe(current);
    expect(current.selectionStart).toBe(2);
    expect(current.selectionEnd).toBe(5);
    const saved = (await state.repository!.listLocal())[0]!.payload;
    expect(saved.files.map(fileText)).toEqual([
      paths[0],
      "Changed shared folder note",
      paths[2],
    ]);
    expect(document.querySelectorAll(".pwa-folder summary")).toHaveLength(2);
    window.dispatchEvent(new Event("pagehide"));
    expect(document.querySelectorAll(".synthetic-editor")).toHaveLength(0);
  });
});
