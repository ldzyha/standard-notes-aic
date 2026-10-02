import { describe, expect, it } from "vitest";
import { BrowserMarkdownStorage } from "../src/browser/markdown-storage";
import { markdownFixture } from "./helpers/browser-markdown-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

describe("concurrent Markdown folder writers", () => {
  it("never acknowledges a body save after another writer discarded its pending URL metadata", async () => {
    const fixture = markdownFixture({ "a.md": "Old A", "b.md": "Old B" });
    const local: Record<string, unknown> = {};
    const persistence = {
      get: async () => structuredClone(local),
      set: async (value: Record<string, unknown>) => {
        Object.assign(local, structuredClone(value));
      },
    };
    const first = new BrowserMarkdownStorage(persistence, fixture.bindings);
    const second = new BrowserMarkdownStorage(persistence, fixture.bindings);
    await first.connect("browser-test");
    await second.connect("browser-test");
    const nextFirst = first.snapshot();
    const firstNote = nextFirst.notes.find((note) => note.filePath === "a.md")!;
    Object.assign(firstNote, {
      markdown: "Saved A",
      url: "https://example.test/a",
      revision: firstNote.revision + 1,
    });
    const nextSecond = second.snapshot();
    const secondNote = nextSecond.notes.find(
      (note) => note.filePath === "b.md",
    )!;
    Object.assign(secondNote, {
      markdown: "Saved B",
      url: "https://example.test/b",
      revision: secondNote.revision + 1,
    });

    const entered = deferred();
    const release = deferred();
    fixture.entries.get("a.md")!.beforeClose = async () => {
      entered.resolve();
      await release.promise;
    };
    const writingFirst = settle(first.write(nextFirst));
    await entered.promise;
    let secondResult: Awaited<ReturnType<typeof settle<void>>>;
    try {
      // The second instance must not erase the first instance's durable intent
      // while its body transaction is still open.
      secondResult = await settle(second.write(nextSecond));
    } finally {
      release.resolve();
    }
    const firstResult = await writingFirst;
    const reopened = new BrowserMarkdownStorage(persistence, fixture.bindings);
    const library = await reopened.read();
    expect(firstResult.ok || secondResult.ok).toBe(true);
    if (firstResult.ok)
      expect(
        library.notes.find((note) => note.id === firstNote.id),
      ).toMatchObject({
        markdown: "Saved A",
        url: "https://example.test/a",
      });
    if (secondResult.ok)
      expect(
        library.notes.find((note) => note.id === secondNote.id),
      ).toMatchObject({
        markdown: "Saved B",
        url: "https://example.test/b",
      });
    expect(fixture.text("a.md")).toBe("Saved A");
    expect(["Old B", "Saved B"]).toContain(fixture.text("b.md"));
  });

  it("never deletes an empty file created elsewhere during a new destination race", async () => {
    const fixture = markdownFixture();
    const local: Record<string, unknown> = {};
    const persistence = {
      get: async () => structuredClone(local),
      set: async (value: Record<string, unknown>) => {
        Object.assign(local, structuredClone(value));
      },
    };
    const storage = new BrowserMarkdownStorage(persistence, fixture.bindings);
    await storage.connect("browser-test");
    const next = storage.snapshot();
    next.notes.push({
      id: "new-note",
      url: "",
      title: "note.md",
      filePath: "note.md",
      markdown: "My draft",
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    });
    const originalGetFileHandle = fixture.root.getFileHandle.bind(fixture.root);
    fixture.root.getFileHandle = async (name, options) => {
      if (name === "note.md" && options?.create) {
        // File System Access create:true can return an existing file; it is not
        // an exclusive creation flag. Simulate a file created after preflight.
        fixture.put(name, "");
        fixture.entries.get(name)!.failClose = true;
      }
      return originalGetFileHandle(name, options);
    };
    await expect(storage.write(next)).rejects.toBeDefined();
    expect(fixture.entries.has("note.md")).toBe(true);
    expect(fixture.text("note.md")).toBe("");
  });

  it("does not finalize pending metadata from a read while another transaction holds the folder lock", async () => {
    const initialIndex = JSON.stringify({
      format: "aic-markdown-links",
      version: 1,
      entries: [],
    });
    const fixture = markdownFixture({
      ".aic/links.json": initialIndex,
      "note.md": "Before",
    });
    const local: Record<string, unknown> = {};
    const persistence = {
      get: async () => structuredClone(local),
      set: async (value: Record<string, unknown>) => {
        Object.assign(local, structuredClone(value));
      },
    };
    const first = new BrowserMarkdownStorage(persistence, fixture.bindings);
    await first.connect("browser-test");
    const next = first.snapshot();
    Object.assign(next.notes[0]!, {
      markdown: "Saved body",
      url: "https://example.test/note",
      revision: next.notes[0]!.revision + 1,
    });
    fixture.entries.get(".aic/links.json")!.failClose = true;
    await first.write(next);
    const pending = fixture.text(".aic/links.pending.json");
    fixture.entries.get(".aic/links.json")!.failClose = false;
    const metadata = await fixture.root.getDirectoryHandle(".aic");
    const lock = await (
      await metadata.getFileHandle("write.lock")
    ).createWritable({ keepExistingData: true, mode: "exclusive" });
    try {
      const second = new BrowserMarkdownStorage(persistence, fixture.bindings);
      const result = await settle(second.read());
      if (result.ok)
        expect(result.value.notes[0]).toMatchObject({
          markdown: "Saved body",
          url: "https://example.test/note",
        });
      expect(fixture.text(".aic/links.json")).toBe(initialIndex);
      expect(fixture.text(".aic/links.pending.json")).toBe(pending);
    } finally {
      await lock.abort?.();
    }
  });

  it("does not turn a committed save into a failure when folder-lock cleanup rejects", async () => {
    const fixture = markdownFixture({ "note.md": "Before" });
    const local: Record<string, unknown> = {};
    const persistence = {
      get: async () => structuredClone(local),
      set: async (value: Record<string, unknown>) => {
        Object.assign(local, structuredClone(value));
      },
    };
    const storage = new BrowserMarkdownStorage(persistence, fixture.bindings);
    await storage.connect("browser-test");
    const next = storage.snapshot();
    Object.assign(next.notes[0]!, {
      markdown: "Durable body",
      revision: next.notes[0]!.revision + 1,
    });
    const originalGetDirectoryHandle = fixture.root.getDirectoryHandle.bind(
      fixture.root,
    );
    fixture.root.getDirectoryHandle = async (name, options) => {
      const directory = await originalGetDirectoryHandle(name, options);
      if (name === ".aic") {
        const originalGetFileHandle = directory.getFileHandle.bind(directory);
        directory.getFileHandle = async (filename, fileOptions) => {
          const handle = await originalGetFileHandle(filename, fileOptions);
          if (filename === "write.lock") {
            const originalCreateWritable = handle.createWritable.bind(handle);
            handle.createWritable = async (writerOptions) => {
              const writer = await originalCreateWritable(writerOptions);
              return {
                ...writer,
                abort: async () => {
                  await writer.abort?.();
                  throw new Error("Synthetic cleanup failure");
                },
              };
            };
          }
          return handle;
        };
      }
      return directory;
    };
    await expect(storage.write(next)).resolves.toBeUndefined();
    expect(fixture.text("note.md")).toBe("Durable body");
    const fresh = new BrowserMarkdownStorage(persistence, fixture.bindings);
    expect((await fresh.read()).notes[0]?.markdown).toBe("Durable body");
  });
});
