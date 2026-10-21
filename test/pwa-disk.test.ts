import { describe, expect, it, vi } from "vitest";
import {
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
