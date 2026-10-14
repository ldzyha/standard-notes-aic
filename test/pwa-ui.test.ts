import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteFileHandle } from "../src/pwa/disk";

const state = vi.hoisted(() => ({
  records: null as unknown,
  openTarget: null as ((target: string) => void) | null,
  canOpenTarget: null as ((target: string) => boolean) | null,
}));

vi.mock("../src/pwa/disk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pwa/disk")>();
  return {
    ...actual,
    PwaNote: class extends actual.PwaNote {
      constructor() {
        super(
          state.records as InstanceType<typeof actual.MemoryNoteRecords>,
          window as never,
        );
      }
    },
  };
});
vi.mock("../src/pwa/ai-controls", () => ({
  attachLocalAI: () => ({ dispose() {} }),
}));
vi.mock("../src/editor", () => ({
  AicEditor: class {
    private readonly field: HTMLTextAreaElement;
    constructor(
      container: HTMLElement,
      options: {
        initialText: string;
        readOnly?: boolean;
        onChange(text: string): void;
        onOpenTarget?(target: string): void;
        canOpenTarget?(target: string): boolean;
      },
    ) {
      state.openTarget = options.onOpenTarget ?? null;
      state.canOpenTarget = options.canOpenTarget ?? null;
      this.field = document.createElement("textarea");
      this.field.className = "synthetic-editor";
      this.field.value = options.initialText;
      this.field.readOnly = !!options.readOnly;
      this.field.addEventListener("input", () => {
        if (!this.field.readOnly) options.onChange(this.field.value);
      });
      container.append(this.field);
    }
    switchDocument(_id: string, text: string) {
      this.field.value = text;
    }
    setReadOnly(readOnly: boolean) {
      this.field.readOnly = readOnly;
    }
    setSaveState() {}
    destroy() {
      this.field.remove();
    }
  },
}));

const { MemoryNoteRecords } = await import("../src/pwa/disk");

function file(text: string) {
  let bytes = new TextEncoder().encode(text);
  let permission: PermissionState = "granted";
  let missing = false;
  const handle: NoteFileHandle = {
    kind: "file",
    name: "aic.md",
    getFile: async () => {
      if (missing) throw new DOMException("Gone", "NotFoundError");
      return {
        size: bytes.length,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
    createWritable: async () => {
      let next = new Uint8Array();
      return {
        write: async (data: Uint8Array<ArrayBuffer>) => {
          next = data.slice();
        },
        close: async () => {
          bytes = next;
        },
      };
    },
    queryPermission: async () => permission,
    requestPermission: vi.fn(
      async (): Promise<PermissionState> => (permission = "granted"),
    ),
  };
  return {
    handle,
    text: () => new TextDecoder().decode(bytes),
    replace: (next: string) => {
      bytes = new TextEncoder().encode(next);
    },
    revoke: () => {
      permission = "prompt";
    },
    remove: () => {
      missing = true;
    },
  };
}

const listeners: [EventTarget, string, EventListenerOrEventListenerObject][] =
  [];
let disk = file(
  "# Note\n\n--- https://example.com\nWeb\n\n--- /home/me/a.ts\nCode",
);
let downloads: Blob[] = [];

function control(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === label && !item.hidden,
  );
  if (!found) throw new Error(`Missing action: ${label}`);
  return found;
}
function has(label: string): boolean {
  return [...document.querySelectorAll("button")].some(
    (item) => item.getAttribute("aria-label") === label && !item.hidden,
  );
}
function read(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}
async function idle() {
  await vi.waitFor(() =>
    expect(document.querySelector("main")?.hasAttribute("aria-busy")).toBe(
      false,
    ),
  );
}
async function click(label: string) {
  control(label).click();
  await idle();
}
function field(): HTMLTextAreaElement {
  const found =
    document.querySelector<HTMLTextAreaElement>(".synthetic-editor");
  if (!found) throw new Error("No editor");
  return found;
}
function type(text: string) {
  field().value = text;
  field().dispatchEvent(new Event("input", { bubbles: true }));
}
async function saveShortcut() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
  );
  await idle();
}
function status() {
  return document.querySelector(".pwa-status")?.textContent;
}
async function launch() {
  window.dispatchEvent(new Event("pagehide"));
  for (const [target, type, listener] of listeners.splice(0))
    target.removeEventListener(type, listener);
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await import("../src/pwa/main");
  await vi.waitFor(() =>
    expect(
      document.querySelector(".pwa-start, .synthetic-editor"),
    ).not.toBeNull(),
  );
}
function fileAccess(enabled: boolean) {
  if (!enabled) {
    Reflect.deleteProperty(window, "showOpenFilePicker");
    Reflect.deleteProperty(window, "showSaveFilePicker");
    return;
  }
  Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true,
    value: vi.fn(async () => [disk.handle]),
  });
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    value: vi.fn(async () => disk.handle),
  });
}

beforeEach(async () => {
  state.records = new MemoryNoteRecords();
  disk = file(
    "# Note\n\n--- https://example.com\nWeb\n\n--- /home/me/a.ts\nCode",
  );
  downloads = [];
  fileAccess(true);
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation(
      (type, listener, options) => {
        listeners.push([target, type, listener!]);
        add(type, listener, options);
      },
    );
  }
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    downloads.push(blob as Blob);
    return "blob:note";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  await launch();
});

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  for (const [target, type, listener] of listeners.splice(0))
    target.removeEventListener(type, listener);
  fileAccess(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("PWA one note", () => {
  it("asks once for the note file, then shows the whole note and saves to it", async () => {
    expect(document.querySelector(".pwa-title")?.textContent).toBe(
      "Choose your note file",
    );
    expect(has("Note options")).toBe(false);
    expect(has("Create new note")).toBe(true);
    await click("Open note file");
    expect(field().value).toContain("--- /home/me/a.ts");
    expect(status()).toBe("Saved to aic.md");
    type("# Edited");
    expect(status()).toBe("Unsaved");
    await saveShortcut();
    expect(disk.text()).toBe("# Edited");
    expect(status()).toBe("Saved to aic.md");
    // Every launch opens the same file; it is never asked for again.
    disk.replace("# Changed elsewhere");
    await launch();
    expect(document.querySelector(".pwa-start")).toBeNull();
    expect(field().value).toBe("# Changed elsewhere");
  });

  it("creates a new note file named aic.md", async () => {
    disk.replace("");
    await click("Create new note");
    expect(Reflect.get(window, "showSaveFilePicker")).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "aic.md" }),
    );
    expect(field().value).toBe("");
  });

  it("shows the stored copy read-only until the file is reconnected", async () => {
    await click("Open note file");
    disk.revoke();
    disk.replace("# Newer on disk");
    await launch();
    expect(field().readOnly).toBe(true);
    expect(field().value).toContain("# Note");
    expect(status()).toBe("aic.md · read-only copy");
    await click("Reconnect note file");
    expect(disk.handle.requestPermission).toHaveBeenCalled();
    expect(field().readOnly).toBe(false);
    expect(field().value).toBe("# Newer on disk");
    expect(has("Reconnect note file")).toBe(false);
  });

  it("keeps the draft when the file changed elsewhere and reloads it on request", async () => {
    await click("Open note file");
    disk.replace("# Outside edit");
    type("# My draft");
    await saveShortcut();
    expect(disk.text()).toBe("# Outside edit");
    expect(field().value).toBe("# My draft");
    expect(document.querySelector(".pwa-notice")?.textContent).toMatch(
      "changed outside",
    );
    control("Note options").click();
    await click("Download note");
    expect(await read(downloads[0]!)).toBe("# My draft");
    vi.stubGlobal("confirm", () => true);
    await click("Reload note file");
    expect(field().value).toBe("# Outside edit");
    expect(status()).toBe("Saved to aic.md");
  });

  it("returns to the chooser when the bound file is gone", async () => {
    await click("Open note file");
    disk.remove();
    await launch();
    expect(document.querySelector(".pwa-start")).not.toBeNull();
    expect(document.querySelector(".pwa-notice")?.textContent).toMatch(
      "moved or deleted",
    );
  });

  it("opens URL targets in a new tab and offers nothing for file paths", async () => {
    await click("Open note file");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(state.canOpenTarget!("https://example.com")).toBe(true);
    expect(state.canOpenTarget!("/home/me/a.ts")).toBe(false);
    state.openTarget!("https://example.com");
    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener",
    );
  });
});

describe("PWA one note without file access", () => {
  beforeEach(async () => {
    fileAccess(false);
    await launch();
  });

  it("keeps the note in this browser with Download and Replace from file", async () => {
    expect(document.querySelector(".pwa-empty")?.textContent).toMatch(
      "its own storage",
    );
    await click("Create new note");
    type("# Browser note");
    await saveShortcut();
    expect(status()).toBe("Saved in this browser");
    await launch();
    expect(field().value).toBe("# Browser note");
    control("Note options").click();
    await click("Download note");
    expect(await read(downloads[0]!)).toBe("# Browser note");
    vi.stubGlobal("confirm", () => true);
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, "files", {
        value: [{ name: "aic.md", size: 11, text: async () => "# From file" }],
      });
      this.dispatchEvent(new Event("change"));
    });
    control("Note options").click();
    await click("Replace from file…");
    await vi.waitFor(() => expect(field().value).toBe("# From file"));
  });
});
