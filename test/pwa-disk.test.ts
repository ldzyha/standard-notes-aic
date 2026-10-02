import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  MarkdownDisk,
  writeMarkdownDestination,
  type MarkdownFileHandle,
  type MarkdownSelection,
  type MarkdownBindingPersistence,
} from "../src/pwa/disk";
import {
  createPwaFile,
  createWorkspace,
  fileText,
  type WorkspacePayload,
} from "../src/pwa/model";
import { PwaRepository } from "../src/pwa/controller";
import {
  MemoryPwaPersistence,
  validateStoredLocalWorkspace,
} from "../src/pwa/storage";
const cryptoModule = "node:crypto";
beforeAll(async () => {
  const { webcrypto } = await import(cryptoModule);
  vi.stubGlobal("crypto", webcrypto);
});
function fixture(text = "# Original\r\n") {
  let bytes = new TextEncoder().encode(text);
  let missing = false;
  let permission: PermissionState = "granted";
  let failClose = false;
  let buffered: Uint8Array<ArrayBuffer> | null = null;
  const close = vi.fn(async () => {
    if (failClose) throw new Error("Synthetic close failed");
    bytes = buffered!;
  });
  const abort = vi.fn(async () => {
    buffered = null;
  });
  const handle: MarkdownFileHandle = {
    kind: "file",
    name: "note.md",
    getFile: vi.fn(async () => {
      if (missing)
        throw new DOMException("Synthetic file deleted", "NotFoundError");
      return {
        size: bytes.length,
        type: "text/markdown",
        lastModified: 1,
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
    requestPermission: async () => permission,
  };
  const file = createPwaFile("project/note.md", bytes, "text/markdown", 1);
  const payload: WorkspacePayload = {
    ...createWorkspace(),
    files: [file],
    directories: [],
  };
  const records = new Map<string, MarkdownSelection>();
  const persistence: MarkdownBindingPersistence = {
    read: async (id) => records.get(id) ?? null,
    write: async (id, value) => {
      records.set(id, value);
    },
    remove: async (id) => {
      records.delete(id);
    },
  };
  const disk = new MarkdownDisk(persistence);
  const attach = () =>
    disk.attach(
      "workspace",
      { files: [{ id: file.id, path: file.path, handle }] },
      [file],
    );
  const edited = (text: string) => ({
    ...payload,
    files: [
      {
        ...createPwaFile(
          file.path,
          new TextEncoder().encode(text),
          file.mediaType,
          2,
        ),
        id: file.id,
      },
    ],
  });
  return {
    disk,
    persistence,
    handle,
    file,
    payload,
    attach,
    edited,
    close,
    abort,
    content: () => new TextDecoder().decode(bytes),
    replace: (text: string) => {
      bytes = new TextEncoder().encode(text);
    },
    remove: () => {
      missing = true;
    },
    revoke: () => {
      permission = "denied";
    },
    failClose: () => {
      failClose = true;
    },
    allowClose: () => {
      failClose = false;
    },
  };
}
describe("Markdown original-file editing", () => {
  it("writes the selected original and does not rewrite untouched bytes", async () => {
    const f = fixture("\uFEFF# Exact\r\n");
    await f.attach();
    await f.disk.save("workspace", f.payload);
    expect(f.handle.createWritable).not.toHaveBeenCalled();
    await f.disk.save("workspace", f.edited("# Changed\r\n"));
    expect(f.content()).toBe("# Changed\r\n");
    expect(f.handle.createWritable).toHaveBeenCalledWith({
      mode: "exclusive",
      keepExistingData: false,
    });
    await f.disk.save("workspace", f.edited("# Changed\r\n"));
    expect(f.handle.createWritable).toHaveBeenCalledTimes(1);
  });
  it("reloads authoritative disk content instead of cached snapshots", async () => {
    const f = fixture();
    await f.attach();
    f.replace("# From VS Code");
    const reopened = new MarkdownDisk(f.persistence);
    expect(await reopened.restore("workspace")).toBe(true);
    const current = await reopened.refresh("workspace", f.payload);
    expect(fileText(current.files[0]!)).toBe("# From VS Code");
    expect(current.files[0]!.id).toBe(f.file.id);
    await reopened.save("workspace", f.edited("# Next edit"));
    expect(f.content()).toBe("# Next edit");
  });
  it("does not advance a partial refresh baseline if another required scope disappears", async () => {
    const first = fixture("# First"),
      second = fixture("# Shared");
    await first.attach();
    const secondFile = { ...second.file, path: "project/shared.md" };
    await first.disk.attach(
      "workspace",
      {
        files: [
          { id: secondFile.id, path: secondFile.path, handle: second.handle },
        ],
      },
      [secondFile],
    );
    const payload = { ...first.payload, files: [first.file, secondFile] };
    first.replace("# Outside edit");
    second.remove();
    await expect(first.disk.refresh("workspace", payload)).rejects.toThrow(
      "deleted",
    );
    expect(first.disk.ready("workspace", first.file.id)).toBe(false);
    // A failed refresh leaves the old cache untouched; an unrelated save must not
    // reinterpret that old cache as a request to overwrite newly observed bytes.
    await first.disk.save("workspace", payload);
    expect(first.content()).toBe("# Outside edit");
    expect(first.handle.createWritable).not.toHaveBeenCalled();
  });

  it("rejects an external edit without overwriting either draft or original", async () => {
    const f = fixture();
    await f.attach();
    const draft = f.edited("# My draft");
    f.replace("# Outside edit");
    await expect(f.disk.save("workspace", draft)).rejects.toThrow(
      "changed on disk",
    );
    expect(f.content()).toBe("# Outside edit");
    expect(fileText(draft.files[0]!)).toBe("# My draft");
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });
  it("does not recreate a deleted original", async () => {
    const f = fixture();
    await f.attach();
    f.remove();
    await expect(f.disk.save("workspace", f.edited("# Draft"))).rejects.toThrow(
      "deleted",
    );
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });
  it("preserves a draft when permission is revoked", async () => {
    const f = fixture();
    await f.attach();
    f.revoke();
    await expect(f.disk.save("workspace", f.edited("# Draft"))).rejects.toThrow(
      "permission",
    );
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });
  it("aborts a failed close and retries against the original baseline", async () => {
    const f = fixture();
    await f.attach();
    f.failClose();
    await expect(f.disk.save("workspace", f.edited("# Retry"))).rejects.toThrow(
      "close failed",
    );
    expect(f.content()).toBe("# Original\r\n");
    expect(f.abort).toHaveBeenCalledOnce();
    f.allowClose();
    await f.disk.save("workspace", f.edited("# Retry"));
    expect(f.content()).toBe("# Retry");
  });
  it("rechecks the original after a writer is opened", async () => {
    const f = fixture();
    await f.attach();
    const original = f.handle.createWritable;
    f.handle.createWritable = async (options) => {
      const writer = await original(options);
      f.replace("# Concurrent editor");
      return writer;
    };
    await expect(f.disk.save("workspace", f.edited("# Draft"))).rejects.toThrow(
      "changed on disk",
    );
    expect(f.content()).toBe("# Concurrent editor");
    expect(f.abort).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
  });
  it("requires a destination for a new file and does not pretend to rename", async () => {
    const f = fixture();
    await f.attach();
    await expect(
      f.disk.save("workspace", {
        ...f.payload,
        files: [...f.payload.files, createPwaFile("new.md", new Uint8Array())],
      }),
    ).rejects.toThrow("destination");
    await expect(
      f.disk.save("workspace", {
        ...f.edited("changed"),
        files: [{ ...f.edited("changed").files[0]!, path: "renamed.md" }],
      }),
    ).rejects.toThrow("cannot rename");
  });
  it("disconnects only access metadata", async () => {
    const f = fixture();
    await f.attach();
    await f.disk.disconnect("workspace");
    expect(f.content()).toBe("# Original\r\n");
    expect(await f.persistence.read("workspace")).toBeNull();
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });
  it("keeps an acknowledged original save when the secondary cache fails", async () => {
    const f = fixture();
    await f.attach();
    const persistence = new MemoryPwaPersistence();
    const repository = new PwaRepository(persistence);
    const record = await repository.createLocal(undefined, f.payload, true);
    vi.spyOn(persistence, "writeLocal").mockRejectedValueOnce(
      new Error("Cache unavailable"),
    );
    const result = await repository.saveLocalToDisk(
      record.id,
      f.edited("# On disk"),
      () => f.disk.save("workspace", f.edited("# On disk")),
    );
    expect(result.cacheWarning).toBeTruthy();
    expect(f.content()).toBe("# On disk");
    expect(fileText(repository.localSnapshot(record.id)!.files[0]!)).toBe(
      "# On disk",
    );
    await repository.saveLocalToDisk(record.id, f.edited("# Later"), () =>
      f.disk.save("workspace", f.edited("# Later")),
    );
    expect(fileText((await repository.listLocal())[0]!.payload.files[0]!)).toBe(
      "# Later",
    );
  });
  it("preserves the disk marker independently from portable payload", async () => {
    const f = fixture();
    const repository = new PwaRepository(new MemoryPwaPersistence());
    const record = await repository.createLocal(undefined, f.payload, true);
    const updated = await repository.updateLocal(record.id, {
      ...f.payload,
      label: "Display only",
    });
    expect(validateStoredLocalWorkspace(updated).storage).toBe("disk");
    expect(updated.payload).not.toHaveProperty("storage");
    expect(updated.payload).not.toHaveProperty("handle");
  });
  it("never truncates a file that appeared during New note creation", async () => {
    const f = fixture("# Created by another app");
    const empty = createPwaFile("note.md", new Uint8Array());
    await expect(
      writeMarkdownDestination(f.handle, empty, { newOnly: true }),
    ).rejects.toThrow("already contains data");
    expect(f.content()).toBe("# Created by another app");
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });

  it("Save As writes the user selected destination", async () => {
    const f = fixture();
    const file = f.edited("# Saved copy").files[0]!;
    const saved = await writeMarkdownDestination(f.handle, file);
    expect(f.content()).toBe("# Saved copy");
    expect(saved.path).toBe("note.md");
  });
});
