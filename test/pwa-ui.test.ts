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
    expect(has("Note options")).toBe(true);
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
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, "files", {
        value: [{ name: "aic.md", size: 11, text: async () => "# From file" }],
      });
      this.dispatchEvent(new Event("change"));
    });
    control("Note options").click();
    control("Replace from file…").click();
    await vi.waitFor(() => expect(has("Replace note text")).toBe(true));
    await click("Replace note text");
    await vi.waitFor(() => expect(field().value).toBe("# From file"));
  });
});

describe("PWA reconnect keeps the draft", () => {
  it("saves a dirty draft after access returns and the file is unchanged", async () => {
    await click("Open note file");
    type("# My draft");
    disk.revoke();
    await saveShortcut();
    expect(document.querySelector(".pwa-notice")?.textContent).toMatch(
      "draft is kept",
    );
    await click("Reconnect note file");
    expect(field().value).toBe("# My draft");
    expect(disk.text()).toBe("# My draft");
    expect(status()).toBe("Saved to aic.md");
  });

  it("asks before replacing the draft when the file changed meanwhile", async () => {
    await click("Open note file");
    type("# My draft");
    disk.revoke();
    await saveShortcut();
    disk.replace("# Newer on disk");
    const ask = vi.fn(() => false);
    vi.stubGlobal("confirm", ask);
    await click("Reconnect note file");
    expect(ask).toHaveBeenCalledOnce();
    expect(field().value).toBe("# My draft");
    expect(disk.text()).toBe("# Newer on disk");
    expect(has("Reload note file")).toBe(true);
    ask.mockReturnValue(true);
    await click("Reload note file");
    expect(field().value).toBe("# Newer on disk");
  });

  it("makes the editor read-only as soon as an autosave loses access", async () => {
    await click("Open note file");
    disk.revoke();
    type("# Typed");
    await vi.waitFor(() => expect(status()).toBe("Save failed"), {
      timeout: 3000,
    });
    expect(field().readOnly).toBe(true);
    expect(status()).toBe("Save failed");
    expect(has("Reconnect note file")).toBe(true);
  });
});

describe("PWA second window", () => {
  it("offers Reload after another window saved and keeps the draft until then", async () => {
    fileAccess(false);
    await launch();
    await click("Create new note");
    type("# Mine");
    await saveShortcut();
    const records = state.records as InstanceType<typeof MemoryNoteRecords>;
    const stored = records.record!;
    await records.write(
      { text: "# Other window", revision: stored.revision + 1 },
      stored.revision,
    );
    type("# Mine, edited");
    await saveShortcut();
    expect(document.querySelector(".pwa-notice")?.textContent).toMatch(
      "another window",
    );
    expect(has("Reload note file")).toBe(true);
    expect(has("Retry save")).toBe(false);
    expect(field().value).toBe("# Mine, edited");
    vi.stubGlobal("confirm", () => true);
    await click("Reload note file");
    expect(field().value).toBe("# Other window");
    expect(status()).toBe("Saved in this browser");
  });
});

describe("PWA unsaved draft", () => {
  const records = () => state.records as InstanceType<typeof MemoryNoteRecords>;
  it("stores typing at once, restores it after a killed page and clears it on save", async () => {
    await click("Open note file");
    disk.revoke();
    type("# Typed, never saved");
    await vi.waitFor(() =>
      expect(records().draft?.text).toBe("# Typed, never saved"),
    );
    expect(records().draft?.baseText).toContain("# Note");
    await launch();
    expect(field().value).toBe("# Typed, never saved");
    expect(field().readOnly).toBe(true);
    expect(status()).toBe("Unsaved");
    await click("Reconnect note file");
    expect(disk.text()).toBe("# Typed, never saved");
    await vi.waitFor(() => expect(records().draft).toBeNull());
  });

  it("writes the draft synchronously when the page is hidden", async () => {
    await click("Open note file");
    disk.revoke();
    type("# Last words");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Reflect.deleteProperty(document, "visibilityState");
    expect(records().draft?.text).toBe("# Last words");
  });

  it("drops a draft that equals the note", async () => {
    await click("Open note file");
    records().draft = { text: disk.text(), baseText: "x", savedAt: 5 };
    await launch();
    expect(records().draft).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
  });

  describe("when the note changed meanwhile", () => {
    beforeEach(async () => {
      await click("Open note file");
      records().draft = { text: "# Lost text", baseText: "# Old", savedAt: 5 };
      await launch();
    });
    it("asks, keeps the text on Escape and never overwrites the note", async () => {
      const dialog = document.querySelector("dialog")!;
      expect(dialog.getAttribute("aria-label")).toBe("Recover unsaved text");
      const escape = new Event("cancel", { cancelable: true });
      dialog.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(field().value).toContain("# Note");
      expect(records().draft?.text).toBe("# Lost text");
    });
    it("downloads the text", async () => {
      await click("Download unsaved text");
      expect(await read(downloads[0]!)).toBe("# Lost text");
      expect(records().draft?.text).toBe("# Lost text");
    });
    it("opens the text as a copy on a new page, unsaved", async () => {
      await click("Open as a copy");
      expect(field().value).toBe(`${disk.text()}\n\n---\n# Lost text`);
      expect(status()).toBe("Unsaved");
      expect(document.querySelector("dialog")).toBeNull();
      await new Promise((done) => setTimeout(done, 800));
      expect(disk.text()).not.toContain("# Lost text");
    });
    it("discards the text on request", async () => {
      await click("Discard unsaved text");
      expect(records().draft).toBeNull();
      expect(document.querySelector("dialog")).toBeNull();
    });
  });
});

describe("PWA another file after the bound file is gone", () => {
  it("offers a download of the old text and replaces it only on request", async () => {
    await click("Open note file");
    const old = field().value;
    disk.remove();
    await launch();
    expect(document.querySelector(".pwa-notice")?.textContent).toMatch(
      "empty file starts with the last saved text",
    );
    const other = file("# Another file");
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: vi.fn(async () => [other.handle]),
    });
    control("Open note file").click();
    await vi.waitFor(() => expect(has("Replace note text")).toBe(true));
    control("Download previous text").click();
    expect(await read(downloads[0]!)).toBe(old);
    await click("Keep previous text");
    expect(document.querySelector(".pwa-start")).not.toBeNull();
    expect(has("Replace note text")).toBe(false);
    control("Open note file").click();
    await vi.waitFor(() => expect(has("Replace note text")).toBe(true));
    await click("Replace note text");
    expect(field().value).toBe("# Another file");
  });

  it("says when Create opened a file that already had text", async () => {
    await click("Create new note");
    expect(field().value).toContain("--- /home/me/a.ts");
    expect(document.querySelector(".pwa-notice")?.textContent).toMatch(
      "already has text",
    );
    expect(disk.text()).toContain("--- /home/me/a.ts");
  });
});
