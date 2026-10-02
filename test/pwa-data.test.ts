import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPwaFile,
  createWorkspace,
  decodeBase64,
  encodeBase64,
  fileBytes,
  fileText,
  MAX_PWA_ENTRIES,
  MAX_PWA_FILE_BYTES,
  parsePayload,
  serializePayload,
  validatePayload,
  validatePwaFile,
  validateRelativePath,
  type WorkspacePayload,
} from "../src/pwa/model";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
let fixture: WorkspacePayload;

beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  fixture = {
    ...createWorkspace("Synthetic project label"),
    files: [
      createPwaFile(
        "project-a/note.md",
        new TextEncoder().encode("\ufeff# Synthetic e\u0301\r\n"),
        "text/markdown",
        2,
      ),
      createPwaFile(
        "project-b/photo.bin",
        Uint8Array.of(0, 255, 128, 42),
        "application/octet-stream",
        3,
      ),
      createPwaFile("empty.txt", new Uint8Array(), "text/plain", 4),
    ],
    directories: ["project-a", "project-b", "project-b/empty"],
  };
});
afterAll(() => vi.unstubAllGlobals());

describe("PWA portable payload validation", () => {
  it("retains binary bytes, empty files/folders, Unicode text and separate project prefixes", () => {
    expect(parsePayload(serializePayload(fixture))).toEqual(fixture);
    expect(fileBytes(fixture.files[1]!)).toEqual(
      Uint8Array.of(0, 255, 128, 42),
    );
    expect(fileText(fixture.files[0]!)).toBe("\ufeff# Synthetic e\u0301\r\n");
    expect(fileText(fixture.files[2]!)).toBe("");
    expect(() => fileText(fixture.files[1]!)).toThrow("binary");
  });

  it("rejects traversal, unsafe restore names, duplicate ids/paths and file-directory collisions", () => {
    for (const path of [
      "",
      "/note.md",
      "../note.md",
      "a/../note.md",
      "a//note.md",
      "a/./note.md",
      "a\\note.md",
      "C:/note.md",
      "a\u0000.md",
      "a/CON.txt",
      "a/name.",
      "a/name ",
    ]) {
      expect(() => validateRelativePath(path)).toThrow();
    }
    for (const payload of [
      {
        ...fixture,
        files: [
          ...fixture.files,
          { ...fixture.files[0]!, id: "duplicate-path" },
        ],
      },
      {
        ...fixture,
        files: [...fixture.files, { ...fixture.files[0]!, path: "other.md" }],
      },
      { ...fixture, directories: [...fixture.directories, "PROJECT-A"] },
      {
        ...fixture,
        files: [
          ...fixture.files,
          { ...fixture.files[0]!, id: "parent-file", path: "project-a" },
        ],
      },
      { ...fixture, directories: [...fixture.directories, "empty.txt/nested"] },
    ])
      expect(() => validatePayload(payload)).toThrow();
  });

  it("rejects malformed canonical base64, unsupported formats and accessor input without executing it", () => {
    for (const value of ["AA", "AA==\n", "AB==", "=AAA", "////=", "A==="])
      expect(() => decodeBase64(value)).toThrow();
    expect(encodeBase64(new Uint8Array())).toBe("");
    expect(decodeBase64("")).toEqual(new Uint8Array());
    const accessor = vi.fn(() => fixture.files);
    const payload = { ...fixture };
    Object.defineProperty(payload, "files", { get: accessor });
    expect(() => validatePayload(payload)).toThrow();
    expect(accessor).not.toHaveBeenCalled();
    const sparseFiles: unknown[] = new Array(2);
    sparseFiles[1] = fixture.files[0];
    for (const value of [
      { ...fixture, version: 2 },
      { ...fixture, extra: true },
      { ...fixture, files: sparseFiles },
      { ...fixture, label: "bad\ud800" },
    ])
      expect(() => validatePayload(value)).toThrow();
  });

  it("reports cumulative stored-entry limits separately from the payload byte limit", () => {
    const file = createPwaFile("first.md", new Uint8Array());
    const workspace = {
      ...createWorkspace(),
      files: Array.from({ length: MAX_PWA_ENTRIES + 1 }, (_, index) => ({
        ...file,
        id: `file-${index}`,
        path: `note-${index}.md`,
      })),
    };
    expect(() => serializePayload(workspace)).toThrow(
      "Existing files count too",
    );
    expect(() => serializePayload(workspace)).toThrow(
      "2001 files, 0 folder records",
    );
  });

  it("rechecks changed bytes on previously validated files and their copies", () => {
    const file = createPwaFile("safe.md", Uint8Array.of(0, 1, 255));
    const returned = validatePwaFile(file);
    const independent = structuredClone(returned);
    for (const candidate of [file, returned, independent]) {
      candidate.data = "AB==";
      expect(() => validatePwaFile(candidate)).toThrow();
      expect(() => fileBytes(candidate)).toThrow();
      candidate.data = encodeBase64(Uint8Array.of(10, 20, 30));
      expect(fileBytes(validatePwaFile(candidate))).toEqual(
        Uint8Array.of(10, 20, 30),
      );
      candidate.data = "A".repeat(4 * Math.ceil(MAX_PWA_FILE_BYTES / 3) + 4);
      expect(() => validatePwaFile(candidate)).toThrow("6 MiB");
      Object.assign(candidate, { data: undefined });
      expect(() => validatePwaFile(candidate)).toThrow();
    }
    const untrusted = { ...file, data: undefined };
    expect(() => validatePwaFile(untrusted)).toThrow();
  });

  it("still rejects changed metadata, accessors and prototypes on previously validated files", () => {
    const file = createPwaFile("safe.md", Uint8Array.of(1));
    file.path = "../escape.md";
    expect(() => validatePwaFile(file)).toThrow();
    file.path = "safe.md";
    file.modifiedAt = -1;
    expect(() => validatePwaFile(file)).toThrow();
    file.modifiedAt = 0;
    const accessor = vi.fn(() => file.data);
    Object.defineProperty(file, "data", { get: accessor });
    expect(() => validatePwaFile(file)).toThrow();
    expect(accessor).not.toHaveBeenCalled();

    const prototypeChanged = createPwaFile("other.md", Uint8Array.of(2));
    Object.setPrototypeOf(prototypeChanged, { inherited: true });
    expect(() => validatePwaFile(prototypeChanged)).toThrow();
  });

  it("bounds each file, total UTF-8 payload bytes and entry count before persistence", () => {
    expect(() =>
      createPwaFile("big.bin", new Uint8Array(MAX_PWA_FILE_BYTES + 1)),
    ).toThrow();
    const large = createPwaFile("large.bin", new Uint8Array(3 * 1024 * 1024));
    expect(() =>
      validatePayload({
        ...createWorkspace(),
        files: [large, { ...large, id: "other-id", path: "other.bin" }],
      }),
    ).toThrow("6 MiB");
    expect(() =>
      validatePayload({
        ...createWorkspace(),
        directories: Array.from(
          { length: MAX_PWA_ENTRIES + 1 },
          (_, index) => `folder-${index}`,
        ),
      }),
    ).toThrow();
  });
});
