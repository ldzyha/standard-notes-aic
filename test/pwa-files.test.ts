import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createStoredZip,
  exportPlainFile,
  isMarkdownPath,
  pickFiles,
  pickFolder,
  retainEmptyDirectories,
  restoreFolder,
  type FileSelectionProgress,
} from "../src/pwa/files";
import {
  createPwaFile,
  createWorkspace,
  fileBytes,
  MAX_PWA_ENTRIES,
  MAX_PWA_FILE_BYTES,
  validatePayload,
} from "../src/pwa/model";

const encode = (text: string) =>
  Uint8Array.from(new TextEncoder().encode(text));
const notFound = () => new DOMException("Missing", "NotFoundError");

function browserFile(name: string, bytes: Uint8Array, path = "") {
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name, {
    type: "application/octet-stream",
    lastModified: 1234,
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn(async () => bytes.slice().buffer),
  });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

function installPicker(name: string, picker: unknown) {
  Object.defineProperty(window, name, { configurable: true, value: picker });
}

function nativeFile(file: File): TestFile {
  return {
    kind: "file",
    name: file.name,
    getFile: vi.fn(async () => file),
    createWritable: vi.fn(),
  };
}

function chooseInputFiles(files: File[]): void {
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { value: files });
  input.dispatchEvent(new Event("change"));
}

function writable() {
  return {
    write: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
}

interface TestFile {
  name: string;
  kind: "file";
  getFile: Mock;
  createWritable: Mock;
}

interface TestDirectory {
  kind: "directory";
  name: string;
  directories: Map<string, TestDirectory>;
  files: Map<string, TestFile>;
  values(): AsyncIterable<TestDirectory | TestFile>;
  getDirectoryHandle: Mock<
    (child: string, options?: { create?: boolean }) => Promise<TestDirectory>
  >;
  getFileHandle: Mock<
    (child: string, options?: { create?: boolean }) => Promise<TestFile>
  >;
  queryPermission: Mock<() => Promise<PermissionState>>;
  requestPermission: Mock<() => Promise<PermissionState>>;
}

function directory(name = "chosen"): TestDirectory {
  const directories = new Map<string, TestDirectory>();
  const files = new Map<string, TestFile>();
  const handle: TestDirectory = {
    kind: "directory" as const,
    name,
    directories,
    files,
    values: async function* () {
      yield* directories.values();
      yield* files.values();
    },
    getDirectoryHandle: vi.fn(
      async (child: string, options?: { create?: boolean }) => {
        if (files.has(child))
          throw new DOMException("File exists", "TypeMismatchError");
        if (!directories.has(child)) {
          if (!options?.create) throw notFound();
          directories.set(child, directory(child));
        }
        return directories.get(child)!;
      },
    ),
    getFileHandle: vi.fn(
      async (child: string, options?: { create?: boolean }) => {
        if (directories.has(child))
          throw new DOMException("Directory exists", "TypeMismatchError");
        if (!files.has(child)) {
          if (!options?.create) throw notFound();
          const stream = writable();
          files.set(child, {
            kind: "file",
            name: child,
            getFile: vi.fn(),
            createWritable: vi.fn(async () => stream),
          });
        }
        return files.get(child)!;
      },
    ),
    queryPermission: vi.fn(async () => "granted" as PermissionState),
    requestPermission: vi.fn(async () => "granted" as PermissionState),
  };
  return handle;
}

afterEach(() => {
  for (const name of [
    "showOpenFilePicker",
    "showDirectoryPicker",
    "showSaveFilePicker",
  ]) {
    Reflect.deleteProperty(window, name);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("portable filesystem adapter", () => {
  it("identifies only .md paths case-insensitively", () => {
    for (const path of ["note.md", "NOTE.MD", "project/note.Md", ".md"])
      expect(isMarkdownPath(path)).toBe(true);
    for (const path of [
      "note.markdown",
      "note.txt",
      "note.md.bak",
      "note.md?query",
      "project/md",
    ])
      expect(isMarkdownPath(path)).toBe(false);
  });

  it("filters native files before reading rejected types or applying their byte limits", async () => {
    const note = browserFile("NOTE.MD", encode("Markdown"));
    const readNote = vi.fn(async () => note);
    const readImage = vi.fn(async () => {
      throw new Error("An unrelated large image was read.");
    });
    const readOther = vi.fn(async () => {
      throw new Error("An unrelated .markdown file was read.");
    });
    installPicker(
      "showOpenFilePicker",
      vi.fn(async () => [
        { name: "large.png", getFile: readImage },
        { name: note.name, getFile: readNote },
        { name: "other.markdown", getFile: readOther },
      ]),
    );
    const picked = await pickFiles({ markdownOnly: true });
    expect(picked?.files.map((file) => file.path)).toEqual(["NOTE.MD"]);
    expect(fileBytes(picked!.files[0]!)).toEqual(encode("Markdown"));
    expect(readNote).toHaveBeenCalledOnce();
    expect(readImage).not.toHaveBeenCalled();
    expect(readOther).not.toHaveBeenCalled();
  });

  it("recurses Markdown project folders while avoiding nested dependency and Git trees", async () => {
    const root = directory("project");
    const notes = directory("notes");
    const modules = directory("node_modules");
    const git = directory(".git");
    const note = browserFile("nested.MD", encode("nested note"));
    notes.files.set(note.name, {
      kind: "file",
      name: note.name,
      getFile: vi.fn(async () => note),
      createWritable: vi.fn(),
    });
    const readIgnored = vi.fn(async () => {
      throw new Error("Unrelated content must not be read.");
    });
    root.files.set("huge.bin", {
      kind: "file",
      name: "huge.bin",
      getFile: readIgnored,
      createWritable: vi.fn(),
    });
    notes.files.set("source.ts", {
      kind: "file",
      name: "source.ts",
      getFile: readIgnored,
      createWritable: vi.fn(),
    });
    root.directories.set(notes.name, notes);
    root.directories.set(modules.name, modules);
    root.directories.set(git.name, git);
    const dependencies = vi.spyOn(modules, "values");
    const metadata = vi.spyOn(git, "values");
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => root),
    );
    const picked = await pickFolder({ markdownOnly: true });
    expect(picked?.files.map((file) => file.path)).toEqual([
      "project/notes/nested.MD",
    ]);
    expect(picked?.directories).toEqual([]);
    expect(readIgnored).not.toHaveBeenCalled();
    expect(dependencies).not.toHaveBeenCalled();
    expect(metadata).not.toHaveBeenCalled();
  });

  describe("folder import ignore configuration", () => {
    it("prunes an ignored native tree before its 10k entries or rule files are touched", async () => {
      const root = directory("project");
      const excluded = directory("generated");
      const note = browserFile("keep.md", encode("keep"));
      root.files.set(
        ".gitignore",
        nativeFile(browserFile(".gitignore", encode("generated/"))),
      );
      root.files.set(note.name, nativeFile(note));
      root.directories.set(excluded.name, excluded);
      const readExcluded = vi.fn(async () =>
        browserFile("bad.md", encode("bad")),
      );
      excluded.values = vi.fn(async function* () {
        for (let i = 0; i < 10001; i++)
          yield {
            kind: "file" as const,
            name: `${i}.md`,
            getFile: readExcluded,
            createWritable: vi.fn(),
          };
      });
      excluded.files.set(
        ".gitignore",
        nativeFile(browserFile(".gitignore", encode("!**/*"))),
      );
      installPicker(
        "showDirectoryPicker",
        vi.fn(async () => root),
      );
      expect(
        (await pickFolder({ markdownOnly: true }))?.files.map(
          (file) => file.path,
        ),
      ).toEqual(["project/keep.md"]);
      expect(excluded.values).not.toHaveBeenCalled();
      expect(excluded.getFileHandle).not.toHaveBeenCalled();
      expect(readExcluded).not.toHaveBeenCalled();
    });

    it("applies nested .ignore precedence identically to native and shuffled fallback lists", async () => {
      const root = directory("project");
      const docs = directory("docs");
      root.directories.set("docs", docs);
      const fixtures = [
        browserFile(".gitignore", encode("*.md"), "project/.gitignore"),
        browserFile(
          ".gitignore",
          encode("!keep.md\n!blocked.md"),
          "project/docs/.gitignore",
        ),
        browserFile(".ignore", encode("blocked.md"), "project/docs/.ignore"),
        browserFile("keep.md", encode("keep"), "project/docs/keep.md"),
        browserFile("blocked.md", encode("blocked"), "project/docs/blocked.md"),
        browserFile("other.md", encode("other"), "project/docs/other.md"),
      ];
      for (const file of fixtures)
        (file.webkitRelativePath === "project/.gitignore"
          ? root
          : docs
        ).files.set(file.name, nativeFile(file));
      installPicker(
        "showDirectoryPicker",
        vi.fn(async () => root),
      );
      expect(
        (await pickFolder({ markdownOnly: true }))?.files.map(
          (file) => file.path,
        ),
      ).toEqual(["project/docs/keep.md"]);
      Reflect.deleteProperty(window, "showDirectoryPicker");
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
        () => {},
      );
      const pending = pickFolder({ markdownOnly: true });
      chooseInputFiles([...fixtures].reverse());
      expect((await pending)?.files.map((file) => file.path)).toEqual([
        "project/docs/keep.md",
      ]);
      expect(fixtures[4]!.arrayBuffer).not.toHaveBeenCalled();
      expect(fixtures[5]!.arrayBuffer).not.toHaveBeenCalled();
    });

    it("does not charge over 10k hard-excluded and gitignored fallback names or read bytes", async () => {
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
        () => {},
      );
      const config = browserFile(
        ".gitignore",
        encode("generated/"),
        "project/.gitignore",
      );
      const ignored = Array.from({ length: 10002 }, (_, i) =>
        browserFile(
          `${i}.md`,
          encode("ignored"),
          `project/${i % 2 ? "Node_Modules" : "generated"}/${i}.md`,
        ),
      );
      const kept = browserFile("keep.md", encode("keep"), "project/keep.md");
      const pending = pickFolder({ markdownOnly: true });
      chooseInputFiles([...ignored, kept, config]);
      expect((await pending)?.files.map((file) => file.path)).toEqual([
        "project/keep.md",
      ]);
      expect(
        ignored.every(
          (file) => vi.mocked(file.arrayBuffer).mock.calls.length === 0,
        ),
      ).toBe(true);
    });

    it("never reads an ignored fallback directory's rules to resurrect its note", async () => {
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
        () => {},
      );
      const rootRules = browserFile(
        ".gitignore",
        encode("private/"),
        "project/.gitignore",
      );
      const hiddenRules = browserFile(
        ".gitignore",
        encode("!**/*"),
        "project/private/.gitignore",
      );
      const hiddenNote = browserFile(
        "secret.md",
        encode("synthetic"),
        "project/private/secret.md",
      );
      const kept = browserFile("keep.md", encode("keep"), "project/keep.md");
      const pending = pickFolder({ markdownOnly: true });
      chooseInputFiles([hiddenRules, hiddenNote, kept, rootRules]);
      expect((await pending)?.files.map((file) => file.path)).toEqual([
        "project/keep.md",
      ]);
      expect(hiddenRules.arrayBuffer).not.toHaveBeenCalled();
      expect(hiddenNote.arrayBuffer).not.toHaveBeenCalled();
    });

    it("rejects a 64KiB-exceeding rule file before bytes or note metadata", async () => {
      const root = directory("project");
      const config = browserFile(".gitignore", encode("rule"));
      Object.defineProperty(config, "size", { value: 65537 });
      const note = nativeFile(browserFile("keep.md", encode("keep")));
      root.files.set(config.name, nativeFile(config));
      root.files.set(note.name, note);
      installPicker(
        "showDirectoryPicker",
        vi.fn(async () => root),
      );
      await expect(pickFolder({ markdownOnly: true })).rejects.toThrow(
        "exceeds 64 KiB",
      );
      expect(config.arrayBuffer).not.toHaveBeenCalled();
      expect(note.getFile).not.toHaveBeenCalled();
      expect(root.getFileHandle).not.toHaveBeenCalled();
    });

    it.each(["metadata abort", "content timeout"] as const)(
      "stops %s of rules without later traversal, even after late completion",
      async (mode) => {
        vi.useFakeTimers();
        const root = directory("project");
        const controller = new AbortController();
        const bytes = encode("*.tmp");
        const config = browserFile(".gitignore", bytes);
        const handle = nativeFile(config);
        let release!: () => void;
        if (mode === "metadata abort")
          handle.getFile.mockImplementation(
            () =>
              new Promise<File>((resolve) => {
                release = () => resolve(config);
              }),
          );
        else
          vi.mocked(config.arrayBuffer).mockImplementation(
            () =>
              new Promise<ArrayBuffer>((resolve) => {
                release = () => resolve(bytes.slice().buffer);
              }),
          );
        root.files.set(config.name, handle);
        const child = directory("child");
        const note = nativeFile(browserFile("later.md", encode("later")));
        root.directories.set(child.name, child);
        root.files.set(note.name, note);
        const childValues = vi.spyOn(child, "values");
        const values = vi.spyOn(root, "values");
        installPicker(
          "showDirectoryPicker",
          vi.fn(async () => root),
        );
        const pending = pickFolder({
          markdownOnly: true,
          signal: controller.signal,
        });
        const outcome =
          mode === "metadata abort"
            ? expect(pending).resolves.toBeNull()
            : expect(pending).rejects.toThrow("longer than 30 seconds");
        await vi.advanceTimersByTimeAsync(0);
        expect(release).toBeTypeOf("function");
        if (mode === "metadata abort") controller.abort();
        else await vi.advanceTimersByTimeAsync(30000);
        await outcome;
        release();
        await vi.runAllTimersAsync();
        expect(values).toHaveBeenCalledOnce();
        expect(childValues).not.toHaveBeenCalled();
        expect(child.getFileHandle).not.toHaveBeenCalled();
        expect(note.getFile).not.toHaveBeenCalled();
        expect(root.getFileHandle).not.toHaveBeenCalled();
        if (mode === "metadata abort")
          expect(config.arrayBuffer).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it("reuses small directory listings without absent configuration lookups", async () => {
      const root = directory("project");
      const docs = directory("docs");
      const empty = directory("empty");
      root.directories.set(docs.name, docs);
      root.directories.set(empty.name, empty);
      docs.files.set(
        "note.md",
        nativeFile(browserFile("note.md", encode("note"))),
      );
      installPicker(
        "showDirectoryPicker",
        vi.fn(async () => root),
      );
      expect(
        (await pickFolder({ markdownOnly: true }))?.files.map(
          (file) => file.path,
        ),
      ).toEqual(["project/docs/note.md"]);
      for (const directory of [root, docs, empty])
        expect(directory.getFileHandle).not.toHaveBeenCalled();
    });

    it("discovers a rule beyond the prefix before charging excluded native entries", async () => {
      const root = directory("project");
      const ignoredReads = vi.fn(async () =>
        browserFile("ignored.md", encode("ignored")),
      );
      for (let index = 0; index < 10002; index++)
        root.files.set(`ignored-${index}.md`, {
          kind: "file",
          name: `ignored-${index}.md`,
          getFile: ignoredReads,
          createWritable: vi.fn(),
        });
      const config = browserFile(".gitignore", encode("ignored-*.md"));
      root.files.set(config.name, nativeFile(config));
      root.files.set(
        "keep.md",
        nativeFile(browserFile("keep.md", encode("keep"))),
      );
      installPicker(
        "showDirectoryPicker",
        vi.fn(async () => root),
      );
      expect(
        (await pickFolder({ markdownOnly: true }))?.files.map(
          (file) => file.path,
        ),
      ).toEqual(["project/keep.md"]);
      expect(root.getFileHandle.mock.calls.map(([name]) => name)).toEqual([
        ".gitignore",
        ".ignore",
      ]);
      expect(config.arrayBuffer).toHaveBeenCalledOnce();
      expect(ignoredReads).not.toHaveBeenCalled();
    });

    it("keeps generic binary folder behavior and never probes configuration handles", async () => {
      const root = directory("project");
      const modules = directory("node_modules");
      const binary = browserFile("data.bin", Uint8Array.of(0, 255));
      const config = browserFile(".gitignore", encode("node_modules/"));
      modules.files.set(binary.name, nativeFile(binary));
      root.directories.set(modules.name, modules);
      root.files.set(config.name, nativeFile(config));
      installPicker(
        "showDirectoryPicker",
        vi.fn(async () => root),
      );
      const picked = await pickFolder();
      expect(picked?.files.map((file) => file.path).sort()).toEqual([
        "project/.gitignore",
        "project/node_modules/data.bin",
      ]);
      expect(root.getFileHandle).not.toHaveBeenCalled();
      expect(modules.getFileHandle).not.toHaveBeenCalled();
      expect(binary.arrayBuffer).toHaveBeenCalledOnce();
      expect(config.arrayBuffer).toHaveBeenCalledOnce();
    });
  });
  it("scans over 10k unrelated native files and retains all six Markdown notes", async () => {
    const root = directory("project");
    let inspected = 0;
    const readUnrelated = vi.fn(async () => {
      throw new Error("Unrelated content read");
    });
    root.values = async function* () {
      for (let index = 0; index < 12000; index++) {
        inspected++;
        yield {
          kind: "file" as const,
          name: `source-${index}.ts`,
          getFile: readUnrelated,
          createWritable: vi.fn(),
        };
      }
      for (let index = 0; index < 6; index++)
        yield nativeFile(
          browserFile(`note-${index}.md`, encode(`Note ${index}`)),
        );
    };
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => root),
    );
    const progress = vi.fn();
    const picked = await pickFolder({
      markdownOnly: true,
      onProgress: progress,
    });
    expect(picked?.files.map((file) => file.path)).toEqual(
      Array.from({ length: 6 }, (_, i) => `project/note-${i}.md`),
    );
    expect(inspected).toBe(12000);
    expect(readUnrelated).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "reading", selected: 6, read: 6 }),
    );
  });

  it("filters over 10k unrelated fallback files without losing six late notes", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const unrelated = Array.from({ length: 12000 }, (_, i) =>
      browserFile(`${i}.ts`, encode("unused"), `project/${i}.ts`),
    );
    const notes = Array.from({ length: 6 }, (_, i) =>
      browserFile(`note-${i}.md`, encode(`Note ${i}`), `project/note-${i}.md`),
    );
    const pending = pickFolder({ markdownOnly: true });
    chooseInputFiles([...unrelated, ...notes]);
    expect((await pending)?.files.map((file) => file.path)).toEqual(
      notes.map((file) => file.webkitRelativePath),
    );
    expect(
      unrelated.every(
        (file) => vi.mocked(file.arrayBuffer).mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it("cancels a large native scan after 10k names without reading unrelated metadata or late notes", async () => {
    const root = directory("project");
    const controller = new AbortController();
    let inspected = 0;
    const unread = vi.fn(async () => {
      throw new Error("No content should be read");
    });
    root.values = async function* () {
      for (let index = 0; index < 30000; index++) {
        inspected++;
        if (inspected === 12000) controller.abort();
        yield {
          kind: "file" as const,
          name: `source-${index}.ts`,
          getFile: unread,
          createWritable: vi.fn(),
        };
      }
      yield {
        kind: "file" as const,
        name: "late.md",
        getFile: unread,
        createWritable: vi.fn(),
      };
    };
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => root),
    );
    const progress = vi.fn();
    expect(
      await pickFolder({
        markdownOnly: true,
        signal: controller.signal,
        onProgress: progress,
      }),
    ).toBeNull();
    expect(inspected).toBe(12000);
    expect(unread).not.toHaveBeenCalled();
    expect(progress.mock.calls.every(([value]) => value.read === 0)).toBe(true);
  });

  it("filters a large explicit native selection by note quota rather than total names", async () => {
    const unread = vi.fn(async () => {
      throw new Error("Unrelated content read");
    });
    const handles = Array.from({ length: 12000 }, (_, i) => ({
      kind: "file" as const,
      name: `${i}.ts`,
      getFile: unread,
      createWritable: vi.fn(),
    }));
    handles.push(
      ...Array.from({ length: 6 }, (_, i) =>
        nativeFile(browserFile(`${i}.md`, encode("note"))),
      ),
    );
    installPicker(
      "showOpenFilePicker",
      vi.fn(async () => handles),
    );
    expect((await pickFiles({ markdownOnly: true }))?.files).toHaveLength(6);
    expect(unread).not.toHaveBeenCalled();
  });

  it("filters folder-input paths before bytes and excludes nested dependency notes", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const pending = pickFolder({ markdownOnly: true });
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(input.accept).toBe(".md,.gitignore,.ignore");
    const note = browserFile(
      "NOTE.MD",
      encode("note"),
      "project/notes/NOTE.MD",
    );
    const image = browserFile(
      "image.bin",
      new Uint8Array(),
      "project/image.bin",
    );
    const dependency = browserFile(
      "README.md",
      encode("ignored"),
      "project/node_modules/package/README.md",
    );
    Object.defineProperty(image, "size", { value: MAX_PWA_FILE_BYTES + 1 });
    Object.defineProperty(input, "files", { value: [image, dependency, note] });
    input.dispatchEvent(new Event("change"));
    const picked = await pending;
    expect(picked?.files.map((file) => file.path)).toEqual([
      "project/notes/NOTE.MD",
    ]);
    expect(picked?.directories).toEqual([]);
    expect(image.arrayBuffer).not.toHaveBeenCalled();
    expect(dependency.arrayBuffer).not.toHaveBeenCalled();
  });

  it("opens any native file without changing binary bytes or requiring MIME filters", async () => {
    const original = new Uint8Array([0, 0xff, 0xfe, 0xc0, 0x80, 10, 13]);
    const file = browserFile("secret.bin", original);
    const picker = vi.fn(async () => [
      { name: file.name, getFile: async () => file },
    ]);
    installPicker("showOpenFilePicker", picker);
    const result = await pickFiles();
    expect(picker).toHaveBeenCalledWith({ multiple: true });
    expect(result?.files).toHaveLength(1);
    expect(fileBytes(result!.files[0]!)).toEqual(original);
    expect(result!.files[0]).toMatchObject({
      path: "secret.bin",
      mediaType: file.type,
      modifiedAt: 1234,
    });
  });

  describe("Markdown note quota", () => {
    it("ignores more than 2,000 empty and non-Markdown folders when retaining one note", async () => {
      const root = directory("project");
      const rejectedBytes = vi.fn(async () => {
        throw new Error("Unrelated bytes must stay unread.");
      });
      for (let index = 0; index < MAX_PWA_ENTRIES + 1; index++) {
        const ignored = directory(`unrelated-${index}`);
        ignored.files.set("binary.dat", {
          kind: "file",
          name: "binary.dat",
          getFile: rejectedBytes,
          createWritable: vi.fn(),
        });
        root.directories.set(ignored.name, ignored);
      }
      const note = browserFile("note.md", encode("Retained Markdown"));
      root.files.set(note.name, nativeFile(note));
      installPicker(
        "showDirectoryPicker",
        vi.fn(async () => root),
      );
      const picked = await pickFolder({ markdownOnly: true });
      expect(picked?.files.map((file) => file.path)).toEqual([
        "project/note.md",
      ]);
      expect(picked?.directories).toEqual([]);
      expect(rejectedBytes).not.toHaveBeenCalled();
    });

    it.each([MAX_PWA_ENTRIES - 1, MAX_PWA_ENTRIES])(
      "imports %i native Markdown notes in distinct nested folders without charging inferred parents",
      async (count) => {
        const root = directory("project");
        for (let index = 0; index < count; index++) {
          const child = directory(`notes-${index}`);
          const file = browserFile("note.md", new Uint8Array());
          child.files.set(file.name, nativeFile(file));
          root.directories.set(child.name, child);
        }
        installPicker(
          "showDirectoryPicker",
          vi.fn(async () => root),
        );
        const picked = await pickFolder({ markdownOnly: true });
        expect(picked?.files).toHaveLength(count);
        expect(picked?.directories).toEqual([]);
        expect(picked?.files[0]?.path).toBe("project/notes-0/note.md");
        expect(validatePayload({ ...createWorkspace(), ...picked }).kind).toBe(
          "workspace",
        );
      },
    );

    it.each([MAX_PWA_ENTRIES - 1, MAX_PWA_ENTRIES])(
      "imports %i fallback Markdown notes in distinct nested folders without charging inferred parents",
      async (count) => {
        vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
          () => {},
        );
        const files = Array.from({ length: count }, (_, index) =>
          browserFile(
            "note.md",
            new Uint8Array(),
            `project/notes-${index}/note.md`,
          ),
        );
        const pending = pickFolder({ markdownOnly: true });
        chooseInputFiles(files);
        const picked = await pending;
        expect(picked?.files).toHaveLength(count);
        expect(picked?.directories).toEqual([]);
        expect(picked?.files.at(-1)?.path).toBe(
          `project/notes-${count - 1}/note.md`,
        );
      },
    );

    it.each(["native", "fallback"] as const)(
      "rejects 2,001 Markdown notes through %s selection before allocating file bytes",
      async (host) => {
        const files = Array.from({ length: MAX_PWA_ENTRIES + 1 }, (_, index) =>
          browserFile(
            `note-${index}.md`,
            new Uint8Array(),
            `project/note-${index}.md`,
          ),
        );
        let pending: ReturnType<typeof pickFolder>;
        if (host === "native") {
          const root = directory("project");
          for (const file of files) root.files.set(file.name, nativeFile(file));
          installPicker(
            "showDirectoryPicker",
            vi.fn(async () => root),
          );
          pending = pickFolder({ markdownOnly: true });
        } else {
          vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
            () => {},
          );
          pending = pickFolder({ markdownOnly: true });
          chooseInputFiles(files);
        }
        await expect(pending).rejects.toThrow(
          "Choose at most 2000 Markdown files",
        );
        expect(
          files.every(
            (file) => vi.mocked(file.arrayBuffer).mock.calls.length === 0,
          ),
        ).toBe(true);
      },
    );

    it("retains actual empty folders while removing only parents implied by notes or binary files", () => {
      const binary = createPwaFile(
        "project/assets/image.bin",
        new Uint8Array([0, 255]),
      );
      const note = createPwaFile(
        "project/notes/nested/note.md",
        encode("Note"),
      );
      const files = [binary, note];
      const directories = [
        "project",
        "project/assets",
        "project/notes",
        "project/notes/nested",
        "project/empty",
        "project/empty/deep",
        "separate-empty",
      ];
      const retained = retainEmptyDirectories(files, directories);
      expect(retained).toEqual(["project/empty/deep", "separate-empty"]);
      expect(files).toEqual([binary, note]);
      expect(fileBytes(binary)).toEqual(new Uint8Array([0, 255]));
      expect(directories).toHaveLength(7);
      const zip = createStoredZip(files, retained);
      const view = new DataView(zip.buffer);
      expect(view.getUint16(zip.length - 22 + 8, true)).toBe(9);
    });

    it("restores and exports all 2,000 Markdown notes and their inferred folders", async () => {
      const root = directory("project");
      for (let index = 0; index < MAX_PWA_ENTRIES; index++) {
        const child = directory(`notes-${index}`);
        const file = browserFile("note.md", encode(`Note ${index}`));
        child.files.set(file.name, nativeFile(file));
        root.directories.set(child.name, child);
      }
      const target = directory("target");
      installPicker(
        "showDirectoryPicker",
        vi.fn().mockResolvedValueOnce(root).mockResolvedValueOnce(target),
      );
      const picked = await pickFolder({ markdownOnly: true });
      await expect(
        restoreFolder(picked!.files, picked!.directories),
      ).resolves.toBe("directory");
      const restored = target.directories.get("project")!;
      expect(restored.directories.size).toBe(MAX_PWA_ENTRIES);
      for (const file of picked!.files) {
        const childName = file.path.split("/")[1]!;
        const handle = restored.directories
          .get(childName)!
          .files.get("note.md")!;
        const stream = await handle.createWritable.mock.results[0]!.value;
        expect(stream.write).toHaveBeenCalledWith(fileBytes(file));
        expect(stream.close).toHaveBeenCalledOnce();
      }
      const zip = createStoredZip(picked!.files, picked!.directories);
      const view = new DataView(zip.buffer);
      const end = zip.length - 22;
      expect(view.getUint16(end + 8, true)).toBe(2 * MAX_PWA_ENTRIES + 1);
      expect(view.getUint16(end + 10, true)).toBe(2 * MAX_PWA_ENTRIES + 1);
      const expected = new Map<string, Uint8Array>([
        ["project/", new Uint8Array()],
      ]);
      for (const file of picked!.files) {
        expected.set(
          `${file.path.slice(0, file.path.lastIndexOf("/"))}/`,
          new Uint8Array(),
        );
        expected.set(file.path, fileBytes(file));
      }
      let cursor = view.getUint32(end + 16, true);
      const decoder = new TextDecoder();
      for (let index = 0; index < 2 * MAX_PWA_ENTRIES + 1; index++) {
        expect(view.getUint32(cursor, true)).toBe(0x02014b50);
        const nameLength = view.getUint16(cursor + 28, true);
        const name = decoder.decode(
          zip.subarray(cursor + 46, cursor + 46 + nameLength),
        );
        const bytes = expected.get(name);
        expect(bytes).toBeDefined();
        const local = view.getUint32(cursor + 42, true);
        const data = local + 30 + view.getUint16(local + 26, true);
        expect(
          zip.subarray(data, data + view.getUint32(local + 18, true)),
        ).toEqual(bytes);
        expected.delete(name);
        cursor += 46 + nameLength;
      }
      expect(expected.size).toBe(0);
      expect(cursor).toBe(end);
    });

    it("bounds expanded export folders separately before asking for a target", async () => {
      const nested = Array.from({ length: 29 }, () => "nested").join("/");
      const files = Array.from({ length: MAX_PWA_ENTRIES }, (_, index) =>
        createPwaFile(`project-${index}/${nested}/note.md`, new Uint8Array()),
      );
      const picker = vi.fn();
      installPicker("showDirectoryPicker", picker);
      await expect(restoreFolder(files)).rejects.toThrow(
        "Folder export exceeds 60,000 restored files and folders",
      );
      expect(picker).not.toHaveBeenCalled();
      expect(() => createStoredZip(files)).toThrow(
        "Folder export exceeds 60,000 restored files and folders",
      );
    });
  });

  it("overlaps simulated filesystem latency in four bounded lanes across a 4,000-entry scan", async () => {
    vi.useFakeTimers();
    const root = directory("project");
    let metadataActive = 0;
    let metadataPeak = 0;
    let bytesActive = 0;
    let bytesPeak = 0;
    const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 50));
    const notes = Array.from({ length: 20 }, (_, index) => {
      const bytes = encode(`Note ${index}`);
      const file = new File([bytes], `note-${index}.md`);
      Object.defineProperty(file, "arrayBuffer", {
        value: vi.fn(async () => {
          bytesActive += 1;
          bytesPeak = Math.max(bytesPeak, bytesActive);
          await delay();
          bytesActive -= 1;
          return bytes.slice().buffer;
        }),
      });
      const handle = nativeFile(file);
      handle.getFile.mockImplementation(async () => {
        metadataActive += 1;
        metadataPeak = Math.max(metadataPeak, metadataActive);
        await delay();
        metadataActive -= 1;
        return file;
      });
      return handle;
    });
    root.values = async function* () {
      for (let index = 0; index < 3980; index++) {
        yield {
          kind: "file",
          name: `unrelated-${index}.bin`,
          getFile: vi.fn(),
          createWritable: vi.fn(),
        };
      }
      yield* notes;
    };
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => root),
    );
    const started = Date.now();
    const pending = pickFolder({ markdownOnly: true });
    await vi.runAllTimersAsync();
    const picked = await pending;
    expect(picked?.files).toHaveLength(20);
    expect.soft(metadataPeak).toBe(4);
    expect.soft(bytesPeak).toBe(4);
    expect.soft(Date.now() - started).toBeLessThanOrEqual(500);
  });

  describe("responsive and cancelable selection", () => {
    it("yields cached traversal to browser tasks and finishes with exact reading progress", async () => {
      const root = directory("project");
      for (let index = 0; index < 600; index++) {
        root.files.set(`binary-${index}.bin`, {
          kind: "file",
          name: `binary-${index}.bin`,
          getFile: vi.fn(),
          createWritable: vi.fn(),
        });
      }
      for (const name of ["one.md", "two.MD"]) {
        const file = browserFile(name, encode(name));
        root.files.set(name, nativeFile(file));
      }
      const progress: FileSelectionProgress[] = [];
      installPicker(
        "showDirectoryPicker",
        vi.fn(async () => root),
      );
      const pending = pickFolder({
        markdownOnly: true,
        onProgress: (value) => progress.push(value),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(progress.at(-1)!.scanned).toBeGreaterThan(0);
      expect(progress.at(-1)!.scanned).toBeLessThan(602);
      expect((await pending)?.files.map((file) => file.path)).toEqual([
        "project/one.md",
        "project/two.MD",
      ]);
      expect(progress[0]).toEqual({
        phase: "scanning",
        scanned: 0,
        selected: 0,
        read: 0,
      });
      expect(progress.at(-1)).toEqual({
        phase: "reading",
        scanned: 602,
        selected: 2,
        read: 2,
        total: 2,
      });
      expect(progress.length).toBeLessThan(30);
      for (let index = 1; index < progress.length; index++) {
        expect(progress[index]!.scanned).toBeGreaterThanOrEqual(
          progress[index - 1]!.scanned,
        );
        expect(progress[index]!.read).toBeGreaterThanOrEqual(
          progress[index - 1]!.read,
        );
      }
    });

    it("ignores advisory callback errors and cancels before final publication if the host aborts", async () => {
      const file = browserFile("note.md", encode("note"));
      installPicker(
        "showOpenFilePicker",
        vi.fn(async () => [nativeFile(file)]),
      );
      await expect(
        pickFiles({
          markdownOnly: true,
          onProgress: () => {
            throw new Error("Synthetic progress display failure");
          },
        }),
      ).resolves.toMatchObject({ files: [{ path: "note.md" }] });
      const controller = new AbortController();
      await expect(
        pickFiles({
          markdownOnly: true,
          signal: controller.signal,
          onProgress: (value) => {
            if (value.phase === "reading" && value.read === value.total)
              controller.abort();
          },
        }),
      ).resolves.toBeNull();
    });

    it("does not open a picker for an already canceled request and ignores late picker results", async () => {
      const canceled = new AbortController();
      canceled.abort();
      const file = nativeFile(browserFile("note.md", encode("note")));
      const picker = vi.fn(async () => [file]);
      installPicker("showOpenFilePicker", picker);
      await expect(pickFiles({ signal: canceled.signal })).resolves.toBeNull();
      expect(picker).not.toHaveBeenCalled();
      const controller = new AbortController();
      let release: ((files: TestFile[]) => void) | undefined;
      picker.mockImplementation(
        () =>
          new Promise<TestFile[]>((resolve) => {
            release = resolve;
          }),
      );
      const progress = vi.fn();
      const pending = pickFiles({
        signal: controller.signal,
        onProgress: progress,
      });
      controller.abort();
      await expect(pending).resolves.toBeNull();
      const notices = progress.mock.calls.length;
      release!([file]);
      await Promise.resolve();
      expect(file.getFile).not.toHaveBeenCalled();
      expect(progress).toHaveBeenCalledTimes(notices);
    });

    it("cancels a fallback dialog and removes its input without reading files", async () => {
      const controller = new AbortController();
      const click = vi
        .spyOn(HTMLInputElement.prototype, "click")
        .mockImplementation(() => {});
      const pending = pickFolder({
        markdownOnly: true,
        signal: controller.signal,
      });
      expect(click).toHaveBeenCalledOnce();
      controller.abort();
      await expect(pending).resolves.toBeNull();
      expect(document.querySelector("input[type=file]")).toBeNull();
    });

    it("cancels stalled native metadata reads, clears deadlines and never starts later files", async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const releases: (() => void)[] = [];
      const handles = Array.from({ length: 8 }, (_, index) => {
        const file = browserFile(`note-${index}.md`, encode(`Note ${index}`));
        const handle = nativeFile(file);
        handle.getFile.mockImplementation(
          () =>
            new Promise<File>((resolve) => {
              releases.push(() => resolve(file));
            }),
        );
        return handle;
      });
      const progress = vi.fn();
      installPicker(
        "showOpenFilePicker",
        vi.fn(async () => handles),
      );
      const pending = pickFiles({
        signal: controller.signal,
        onProgress: progress,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(releases).toHaveLength(4);
      controller.abort();
      await expect(pending).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      const notices = progress.mock.calls.length;
      for (const release of releases) release();
      await vi.runAllTimersAsync();
      expect(
        handles
          .slice(4)
          .every((handle) => handle.getFile.mock.calls.length === 0),
      ).toBe(true);
      expect(progress).toHaveBeenCalledTimes(notices);
    });

    it("cancels stalled fallback byte reads without allocating later files or emitting late progress", async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const releases: (() => void)[] = [];
      const files = Array.from({ length: 8 }, (_, index) => {
        const bytes = encode(`Note ${index}`);
        const file = new File([bytes], `note-${index}.md`);
        Object.defineProperty(file, "webkitRelativePath", {
          value: `project/${file.name}`,
        });
        Object.defineProperty(file, "arrayBuffer", {
          value: vi.fn(
            () =>
              new Promise<ArrayBuffer>((resolve) => {
                releases.push(() => resolve(bytes.slice().buffer));
              }),
          ),
        });
        return file;
      });
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
        () => {},
      );
      const progress = vi.fn();
      const pending = pickFolder({
        markdownOnly: true,
        signal: controller.signal,
        onProgress: progress,
      });
      chooseInputFiles(files);
      await vi.advanceTimersByTimeAsync(0);
      expect(releases).toHaveLength(4);
      controller.abort();
      await expect(pending).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      const notices = progress.mock.calls.length;
      for (const release of releases) release();
      await vi.runAllTimersAsync();
      expect(
        files
          .slice(4)
          .every((file) => vi.mocked(file.arrayBuffer).mock.calls.length === 0),
      ).toBe(true);
      expect(progress).toHaveBeenCalledTimes(notices);
    });

    it.each(["metadata", "bytes", "directory"] as const)(
      "fails a stalled %s read after 30 seconds and clears sibling deadlines",
      async (stage) => {
        vi.useFakeTimers();
        const progress = vi.fn();
        let pending: ReturnType<typeof pickFolder>;
        const never = () => new Promise<never>(() => {});
        if (stage === "directory") {
          const root = directory("project");
          const iterator: AsyncIterableIterator<TestFile> = {
            next: vi.fn(never),
            return: vi.fn(async () => ({
              done: true as const,
              value: undefined,
            })),
            [Symbol.asyncIterator]() {
              return this;
            },
          };
          root.values = () => iterator;
          installPicker(
            "showDirectoryPicker",
            vi.fn(async () => root),
          );
          pending = pickFolder({ markdownOnly: true, onProgress: progress });
        } else {
          const handles = Array.from({ length: 8 }, (_, index) => {
            const file = new File([encode("Note")], `note-${index}.md`);
            Object.defineProperty(file, "arrayBuffer", { value: vi.fn(never) });
            const handle = nativeFile(file);
            if (stage === "metadata") handle.getFile.mockImplementation(never);
            return handle;
          });
          installPicker(
            "showOpenFilePicker",
            vi.fn(async () => handles),
          );
          pending = pickFiles({ markdownOnly: true, onProgress: progress });
        }
        const outcome = pending.then(
          () => null,
          (error: unknown) => error,
        );
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await outcome).toMatchObject({
          message: expect.stringContaining("took longer than 30 seconds"),
        });
        if (stage === "directory")
          expect(await outcome).toMatchObject({
            message: expect.stringContaining("folder project"),
          });
        expect(vi.getTimerCount()).toBe(0);
        const notices = progress.mock.calls.length;
        await vi.runAllTimersAsync();
        expect(progress).toHaveBeenCalledTimes(notices);
      },
    );
  });

  it("keeps the native project root, empty folders and nested file paths", async () => {
    const root = directory();
    const empty = directory("empty");
    const project = directory("project");
    const file = browserFile("note.md", encode("aic note"));
    project.files.set(file.name, {
      name: file.name,
      kind: "file",
      getFile: vi.fn(async () => file),
      createWritable: vi.fn(),
    });
    root.directories.set("empty", empty);
    root.directories.set("project", project);
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => root),
    );
    const result = await pickFolder();
    expect(result?.directories).toEqual([
      "chosen",
      "chosen/empty",
      "chosen/project",
    ]);
    expect(result?.files[0]?.path).toBe("chosen/project/note.md");
  });

  it("imports different projects with the same child filename into one password entity", async () => {
    const projectA = directory("ProjectA");
    const projectB = directory("ProjectB");
    for (const project of [projectA, projectB]) {
      const file = browserFile("note.md", encode(project.name));
      project.files.set(file.name, {
        name: file.name,
        kind: "file",
        getFile: vi.fn(async () => file),
        createWritable: vi.fn(),
      });
    }
    installPicker(
      "showDirectoryPicker",
      vi.fn().mockResolvedValueOnce(projectA).mockResolvedValueOnce(projectB),
    );
    const first = await pickFolder();
    const second = await pickFolder();
    const payload = validatePayload({
      ...createWorkspace(),
      files: [...first!.files, ...second!.files],
      directories: [...first!.directories, ...second!.directories],
    });
    expect(payload.kind).toBe("workspace");
    if (payload.kind !== "workspace")
      throw new Error("Expected workspace payload.");
    expect(payload.files.map((file) => file.path)).toEqual([
      "ProjectA/note.md",
      "ProjectB/note.md",
    ]);
    expect(payload.directories).toEqual(["ProjectA", "ProjectB"]);
  });

  it("retains an empty selected project root and restores it under the target directory", async () => {
    const empty = directory("empty-project");
    const target = directory("restore-target");
    installPicker(
      "showDirectoryPicker",
      vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(target),
    );
    const picked = await pickFolder();
    expect(picked).toEqual({ files: [], directories: ["empty-project"] });
    await expect(
      restoreFolder(picked!.files, picked!.directories),
    ).resolves.toBe("directory");
    expect(target.directories.has("empty-project")).toBe(true);
    expect(target.directories.get("empty-project")!.files.size).toBe(0);
  });

  it("distinguishes cancellation from denied native permission", async () => {
    installPicker(
      "showOpenFilePicker",
      vi.fn(async () => {
        throw new DOMException("Canceled", "AbortError");
      }),
    );
    await expect(pickFiles()).resolves.toBeNull();
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => {
        throw new DOMException("Denied", "NotAllowedError");
      }),
    );
    await expect(pickFolder()).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("checks file and aggregate encoded bounds before allocating file contents", async () => {
    const oversized = browserFile("big.bin", new Uint8Array());
    Object.defineProperty(oversized, "size", { value: MAX_PWA_FILE_BYTES + 1 });
    installPicker(
      "showOpenFilePicker",
      vi.fn(async () => [
        { name: oversized.name, getFile: async () => oversized },
      ]),
    );
    await expect(pickFiles()).rejects.toThrow("4 MiB");
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    const first = browserFile("one.bin", new Uint8Array());
    const second = browserFile("two.bin", new Uint8Array());
    Object.defineProperty(first, "size", { value: MAX_PWA_FILE_BYTES });
    Object.defineProperty(second, "size", { value: MAX_PWA_FILE_BYTES });
    installPicker(
      "showOpenFilePicker",
      vi.fn(async () =>
        [first, second].map((file) => ({
          name: file.name,
          getFile: async () => file,
        })),
      ),
    );
    await expect(pickFiles()).rejects.toThrow("6 MiB encoded");
    expect(first.arrayBuffer).not.toHaveBeenCalled();
    expect(second.arrayBuffer).not.toHaveBeenCalled();
  });

  it("provides fallback folder selection in the button activation and removes its input", async () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    const pending = pickFolder();
    expect(click).toHaveBeenCalledOnce();
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    const file = browserFile("note.md", encode("text"), "root/project/note.md");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    const result = await pending;
    expect(result?.files[0]?.path).toBe("root/project/note.md");
    expect(result?.directories).toEqual(["root", "root/project"]);
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("cleans up a canceled fallback picker", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const pending = pickFiles();
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    input.dispatchEvent(new Event("cancel"));
    await expect(pending).resolves.toBeNull();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("writes native plain-file bytes and handles save cancellation", async () => {
    const stream = writable();
    const picker = vi.fn(async () => ({ createWritable: async () => stream }));
    installPicker("showSaveFilePicker", picker);
    const file = createPwaFile("project/file.dat", new Uint8Array([0, 255]));
    await expect(exportPlainFile(file)).resolves.toBe(true);
    expect(picker).toHaveBeenCalledWith({ suggestedName: "file.dat" });
    expect(stream.write).toHaveBeenCalledWith(new Uint8Array([0, 255]));
    expect(stream.close).toHaveBeenCalledOnce();
    installPicker(
      "showSaveFilePicker",
      vi.fn(async () => {
        throw new DOMException("Canceled", "AbortError");
      }),
    );
    await expect(exportPlainFile(file)).resolves.toBe(false);
  });

  it("restores nested files and empty directories after validating destinations", async () => {
    const root = directory();
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => root),
    );
    const file = createPwaFile(
      "project/sub/file.bin",
      new Uint8Array([0, 128, 255]),
    );
    await expect(restoreFolder([file], ["empty"])).resolves.toBe("directory");
    expect(root.directories.has("empty")).toBe(true);
    const restored = root.directories
      .get("project")!
      .directories.get("sub")!
      .files.get("file.bin")!;
    const stream = await restored.createWritable.mock.results[0]!.value;
    expect(stream.write).toHaveBeenCalledWith(new Uint8Array([0, 128, 255]));
  });

  it("refuses an existing file before any folder or file creation", async () => {
    const root = directory();
    root.files.set("existing.md", {
      kind: "file",
      name: "existing.md",
      getFile: vi.fn(),
      createWritable: vi.fn(),
    });
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => root),
    );
    await expect(
      restoreFolder(
        [
          createPwaFile("new/future.md", encode("new")),
          createPwaFile("existing.md", encode("replace")),
        ],
        ["empty"],
      ),
    ).rejects.toThrow("existing path: existing.md");
    expect(root.directories.size).toBe(0);
    expect(root.files.size).toBe(1);
    expect(
      root.getDirectoryHandle.mock.calls.every((call) => !call[1]?.create),
    ).toBe(true);
    expect(
      root.getFileHandle.mock.calls.every((call) => !call[1]?.create),
    ).toBe(true);
  });

  it("refuses a file blocking a directory, denied permission, and unsafe bundle paths", async () => {
    const root = directory();
    root.files.set("project", {
      kind: "file",
      name: "project",
      getFile: vi.fn(),
      createWritable: vi.fn(),
    });
    const picker = vi.fn(async () => root);
    installPicker("showDirectoryPicker", picker);
    await expect(
      restoreFolder([createPwaFile("project/file.md", encode("note"))]),
    ).rejects.toThrow("existing path: project");
    expect(root.directories.size).toBe(0);
    root.queryPermission.mockResolvedValue("denied");
    await expect(restoreFolder([])).rejects.toThrow(
      "permission was not granted",
    );
    const unsafe = {
      ...createPwaFile("safe.md", encode("note")),
      path: "../escape",
    };
    picker.mockClear();
    await expect(restoreFolder([unsafe])).rejects.toThrow();
    expect(picker).not.toHaveBeenCalled();
  });

  it("validates case collisions before asking for filesystem access", async () => {
    const picker = vi.fn();
    installPicker("showDirectoryPicker", picker);
    await expect(
      restoreFolder([
        createPwaFile("Foo/note.md", encode("one")),
        createPwaFile("foo/another.md", encode("two")),
      ]),
    ).rejects.toThrow();
    expect(picker).not.toHaveBeenCalled();
  });

  it("returns null for canceled folder restoration without changes", async () => {
    installPicker(
      "showDirectoryPicker",
      vi.fn(async () => {
        throw new DOMException("Canceled", "AbortError");
      }),
    );
    await expect(
      restoreFolder([createPwaFile("note.md", encode("note"))]),
    ).resolves.toBeNull();
  });
});

describe("portable ZIP fallback", () => {
  it("writes UTF-8 names, empty folders, exact binary data and a known CRC32", () => {
    const original = encode("123456789");
    const zip = createStoredZip(
      [createPwaFile("文件.bin", original)],
      ["empty"],
    );
    const view = new DataView(zip.buffer);
    const decoder = new TextDecoder();
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x0800);
    const firstNameLength = view.getUint16(26, true);
    expect(decoder.decode(zip.subarray(30, 30 + firstNameLength))).toBe(
      "empty/",
    );
    const second = 30 + firstNameLength;
    expect(view.getUint32(second + 14, true)).toBe(0xcbf43926);
    const nameLength = view.getUint16(second + 26, true);
    const dataOffset = second + 30 + nameLength;
    expect(decoder.decode(zip.subarray(second + 30, dataOffset))).toBe(
      "文件.bin",
    );
    expect(zip.subarray(dataOffset, dataOffset + original.length)).toEqual(
      original,
    );
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 8, true)).toBe(2);
    const central = view.getUint32(end + 16, true);
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    expect(view.getUint32(central + 38, true)).toBe(0x10);
    const centralSecond = central + 46 + firstNameLength;
    expect(view.getUint32(centralSecond + 42, true)).toBe(second);
    expect(view.getUint32(centralSecond + 16, true)).toBe(0xcbf43926);
  });

  it("downloads a ZIP when native directory access is unavailable", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:local-download");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("aic-notes.zip");
      });
    await expect(
      restoreFolder(
        [createPwaFile("file.bin", new Uint8Array([255, 0]))],
        ["empty"],
      ),
    ).resolves.toBe("zip");
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(document.querySelector("a")).toBeNull();
    await vi.runAllTimersAsync();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-download");
  });

  it("rejects unsafe paths, duplicate names and file-directory conflicts before ZIP output", () => {
    const file = createPwaFile("project/note.md", encode("note"));
    expect(() =>
      createStoredZip([{ ...file, path: "../../escape" }]),
    ).toThrow();
    expect(() => createStoredZip([file, { ...file, id: "another" }])).toThrow();
    expect(() =>
      createStoredZip([file, createPwaFile("project", encode("blocked"))]),
    ).toThrow();
  });
});
