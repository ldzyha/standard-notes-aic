import { describe, expect, it, vi } from "vitest";
import {
  IndexedDbNoteRecords,
  MemoryNoteRecords,
  PwaNote,
  type NoteFileHandle,
} from "../src/pwa/disk";

function fixture(text = "# Original\r\n") {
  let bytes = new TextEncoder().encode(text);
  let missing = false;
  let permission: PermissionState = "granted";
  let failClose = false;
  let buffered: Uint8Array<ArrayBuffer> | null = null;
  const close = vi.fn(async () => {
    if (failClose) throw new Error("Synthetic close failed");
    bytes = buffered!;
    missing = false;
  });
  const abort = vi.fn(async () => {
    buffered = null;
  });
  const handle: NoteFileHandle = {
    kind: "file",
    name: "aic.md",
    getFile: vi.fn(async () => {
      if (missing)
        throw new DOMException("Synthetic file deleted", "NotFoundError");
      return {
        size: bytes.length,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    }),
    createWritable: vi.fn(async () => ({
      write: async (data: Uint8Array<ArrayBuffer>) => {
        buffered = data.slice();
      },
      close,
      abort,
    })),
    queryPermission: async () => permission,
    requestPermission: vi.fn(async () => {
      permission = "granted";
      return permission;
    }),
  };
  const records = new MemoryNoteRecords();
  const host = {
    showOpenFilePicker: vi.fn(async () => [handle]),
    showSaveFilePicker: vi.fn(async () => handle),
  };
  return {
    handle,
    records,
    host,
    close,
    abort,
    note: () => new PwaNote(records, host),
    content: () => new TextDecoder().decode(bytes),
    replace: (next: string) => {
      bytes = new TextEncoder().encode(next);
    },
    remove: () => {
      missing = true;
    },
    revoke: () => {
      permission = "prompt";
    },
    failClose: (value: boolean) => {
      failClose = value;
    },
  };
}

describe("PWA note file", () => {
  it("opens the chosen file, writes it directly and reopens it on launch", async () => {
    const f = fixture();
    const note = f.note();
    await note.load();
    expect(note.exists).toBe(false);
    expect(await note.choose(false)).toBe(true);
    expect([note.text, note.name, note.access]).toEqual([
      "# Original\r\n",
      "aic.md",
      "ready",
    ]);
    await note.save("# Original\r\n");
    expect(f.handle.createWritable).not.toHaveBeenCalled();
    await note.save("# Changed");
    expect(f.content()).toBe("# Changed");
    expect(f.handle.createWritable).toHaveBeenCalledWith({
      mode: "exclusive",
      keepExistingData: false,
    });
    f.replace("# From another editor");
    const relaunched = f.note();
    await relaunched.load();
    expect([relaunched.exists, relaunched.text]).toEqual([
      true,
      "# From another editor",
    ]);
    expect(f.records.record?.text).toBe("# From another editor");
  });

  it("creates a new file, or opens the file the user picked when it has text", async () => {
    const f = fixture("");
    f.remove();
    const note = f.note();
    expect(await note.choose(true)).toBe(true);
    expect(f.host.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "aic.md" }),
    );
    expect(note.text).toBe("");
    const g = fixture("# Kept");
    const other = g.note();
    await other.choose(true);
    expect([other.text, g.content()]).toEqual(["# Kept", "# Kept"]);
  });

  it("returns false and changes nothing when the picker is canceled", async () => {
    const f = fixture();
    f.host.showOpenFilePicker.mockRejectedValueOnce(
      new DOMException("Canceled", "AbortError"),
    );
    const note = f.note();
    expect(await note.choose(false)).toBe(false);
    expect(note.exists).toBe(false);
    expect(f.records.record).toBeNull();
  });

  it("rejects an external edit without overwriting the file or the draft", async () => {
    const f = fixture();
    const note = f.note();
    await note.choose(false);
    f.replace("# Outside edit");
    await expect(note.save("# My draft")).rejects.toThrow("changed outside");
    expect(f.content()).toBe("# Outside edit");
    expect(note.text).toBe("# Original\r\n");
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });

  it("rechecks the file after a writer is opened and aborts it", async () => {
    const f = fixture();
    const note = f.note();
    await note.choose(false);
    const original = f.handle.createWritable;
    f.handle.createWritable = async (options) => {
      const writer = await original(options);
      f.replace("# Concurrent editor");
      return writer;
    };
    await expect(note.save("# Draft")).rejects.toThrow("changed outside");
    expect(f.content()).toBe("# Concurrent editor");
    expect(f.abort).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
  });

  it("aborts a failed close and retries against the same text", async () => {
    const f = fixture();
    const note = f.note();
    await note.choose(false);
    f.failClose(true);
    await expect(note.save("# Retry")).rejects.toThrow("close failed");
    expect(f.content()).toBe("# Original\r\n");
    expect(f.abort).toHaveBeenCalledOnce();
    f.failClose(false);
    await note.save("# Retry");
    expect(f.content()).toBe("# Retry");
  });

  it("does not recreate a deleted file and offers to choose it again", async () => {
    const f = fixture();
    await f.note().choose(false);
    f.remove();
    const note = f.note();
    await note.load();
    expect([note.access, note.text]).toEqual(["missing", "# Original\r\n"]);
    await expect(note.save("# Draft")).rejects.toThrow("Reconnect");
    expect(f.handle.createWritable).not.toHaveBeenCalled();
    // A new file chosen for a missing note starts with its stored text.
    expect(await note.choose(true)).toBe(true);
    expect([note.access, f.content()]).toEqual(["ready", "# Original\r\n"]);
  });

  it("keeps the stored copy read-only until access is granted again", async () => {
    const f = fixture();
    await f.note().choose(false);
    f.revoke();
    const note = f.note();
    await note.load();
    expect([note.access, note.text]).toEqual(["reconnect", "# Original\r\n"]);
    await expect(note.save("# Draft")).rejects.toThrow("Reconnect");
    f.replace("# Newer on disk");
    await note.reconnect();
    expect(f.handle.requestPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
    expect([note.access, note.text]).toEqual(["ready", "# Newer on disk"]);
  });

  it("keeps a saved file when only the browser copy fails", async () => {
    const f = fixture();
    const note = f.note();
    await note.choose(false);
    vi.spyOn(f.records, "write").mockRejectedValueOnce(new Error("Full"));
    expect(await note.save("# On disk")).toMatch("browser's copy");
    expect(f.content()).toBe("# On disk");
    await note.save("# Later");
    expect(f.content()).toBe("# Later");
  });
});

describe("PWA note without file access", () => {
  it("keeps the note in browser storage and starts a new note empty", async () => {
    const records = new MemoryNoteRecords();
    const note = new PwaNote(records, {});
    expect(await note.choose(true)).toBe(true);
    await note.save("# Browser note");
    const relaunched = new PwaNote(records, {});
    await relaunched.load();
    expect([relaunched.exists, relaunched.text, relaunched.handle]).toEqual([
      true,
      "# Browser note",
      null,
    ]);
  });

  it("refuses a save after another window stored a newer note", async () => {
    const records = new MemoryNoteRecords();
    const first = new PwaNote(records, {});
    await first.choose(true);
    const second = new PwaNote(records, {});
    await second.load();
    await second.save("# Second window");
    await expect(first.save("# First window")).rejects.toThrow(
      "another window",
    );
    expect(records.record?.text).toBe("# Second window");
  });
});

describe("PWA note in two windows", () => {
  it("continues after another window only moved the revision", async () => {
    const records = new MemoryNoteRecords();
    const note = new PwaNote(records, {});
    await note.choose(true);
    await note.save("# One");
    const stored = records.record!;
    await records.write(
      { ...stored, revision: stored.revision + 1 },
      stored.revision,
    );
    await note.save("# Two");
    expect(records.record?.text).toBe("# Two");
    expect(note.text).toBe("# Two");
  });

  it("reloads a file another window saved without a stale revision", async () => {
    const f = fixture();
    const first = f.note();
    await first.choose(false);
    const second = f.note();
    await second.load();
    await second.save("# From the second window");
    await first.reconnect();
    expect(first.text).toBe("# From the second window");
    await first.save("# Then the first");
    expect(f.content()).toBe("# Then the first");
  });
});

describe("PWA unsaved draft", () => {
  it("keeps the draft beside the note and removes only its own copy", async () => {
    const records = new MemoryNoteRecords();
    const note = new PwaNote(records, {});
    await note.choose(true);
    await note.save("# Saved");
    await note.keepDraft("# Typed");
    expect(await note.savedDraft()).toMatchObject({
      text: "# Typed",
      baseText: "# Saved",
    });
    // Another window's later draft is not removed by this window.
    const other = new PwaNote(records, {});
    await other.load();
    await other.keepDraft("# Typed elsewhere");
    await note.dropDraft();
    expect((await note.savedDraft())?.text).toBe("# Typed elsewhere");
    await other.dropDraft();
    expect(await note.savedDraft()).toBeNull();
  });

  it("starts the browser write at once on page hide and reuses one connection", async () => {
    const data = new Map<string, unknown>();
    let opened = 0;
    const factory = {
      open() {
        opened++;
        const request: Record<string, any> = {};
        queueMicrotask(() => {
          const database = {
            close() {},
            createObjectStore() {},
            transaction() {
              const transaction: Record<string, any> = {};
              setTimeout(() => transaction.oncomplete?.(), 0);
              transaction.objectStore = () => ({
                get(key: string) {
                  const get: Record<string, any> = {};
                  queueMicrotask(() => {
                    get.result = data.get(key);
                    get.onsuccess?.();
                  });
                  return get;
                },
                put: (value: unknown, key: string) => data.set(key, value),
                delete: (key: string) => data.delete(key),
              });
              return transaction;
            },
          };
          request.result = database;
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    } as unknown as IDBFactory;
    const records = new IndexedDbNoteRecords(factory);
    await records.writeDraft({ text: "a", baseText: "", savedAt: 1 });
    const pending = records.writeDraft({ text: "b", baseText: "", savedAt: 2 });
    // The transaction is created before any await.
    expect((data.get("draft") as { text: string }).text).toBe("b");
    await pending;
    await records.clearDraft(1);
    expect((await records.readDraft())?.text).toBe("b");
    await records.clearDraft(2);
    expect(await records.readDraft()).toBeNull();
    expect(opened).toBe(1);
  });
});

describe("PWA choosing another file", () => {
  async function missingNote() {
    const f = fixture("# Last saved");
    await f.note().choose(false);
    f.remove();
    const note = f.note();
    await note.load();
    const other = fixture("# Another file");
    const choosing = new PwaNote(f.records, other.host);
    await choosing.load();
    return { f, other, note: choosing };
  }

  it("keeps the last text unless replacing it is approved", async () => {
    const { f, note } = await missingNote();
    expect(note.access).toBe("missing");
    expect(await note.choose(false)).toBe(false);
    expect([note.text, f.records.record?.text]).toEqual([
      "# Last saved",
      "# Last saved",
    ]);
    const approve = vi.fn(() => true);
    expect(await note.choose(false, approve)).toBe(true);
    expect(approve).toHaveBeenCalledWith("# Last saved");
    expect(note.text).toBe("# Another file");
  });

  it("asks before a non-empty file picked with Create replaces the last text", async () => {
    const { other, note } = await missingNote();
    const declined = vi.fn(() => false);
    expect(await note.choose(true, declined)).toBe(false);
    expect(note.text).toBe("# Last saved");
    expect(await note.choose(true, () => true)).toBe(true);
    // The file is opened, never written over.
    expect(other.handle.createWritable).not.toHaveBeenCalled();
    expect([note.text, other.content(), note.adoptedExisting]).toEqual([
      "# Another file",
      "# Another file",
      true,
    ]);
  });

  it("carries the last text into an empty file without asking", async () => {
    const f = fixture("# Last saved");
    await f.note().choose(false);
    f.remove();
    const empty = fixture("");
    const note = new PwaNote(f.records, empty.host);
    await note.load();
    expect(await note.choose(true)).toBe(true);
    expect([empty.content(), note.adoptedExisting]).toEqual([
      "# Last saved",
      false,
    ]);
  });
});

describe("PWA save after another window chose a different file", () => {
  it("surfaces a conflict and writes neither file", async () => {
    const f = fixture("# First file");
    const first = f.note();
    await first.choose(false);
    const g = fixture("# Second file");
    const second = new PwaNote(f.records, g.host);
    await second.load();
    expect(await second.choose(false, () => true)).toBe(true);
    await expect(first.save("# Edited")).rejects.toThrow("another window");
    expect(f.content()).toBe("# First file");
    expect(f.handle.createWritable).not.toHaveBeenCalled();
    expect(f.records.record?.text).toBe("# Second file");
  });

  it("still reports only the browser copy failing as a warning", async () => {
    const f = fixture();
    const note = f.note();
    await note.choose(false);
    vi.spyOn(f.records, "write").mockRejectedValueOnce(new Error("Full"));
    expect(await note.save("# Saved")).toMatch("browser's copy");
  });
});
