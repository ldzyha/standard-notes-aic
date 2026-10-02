import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { BrowserDrafts } from "../src/browser/drafts";
import { createBrowserService } from "../src/browser/service";
import type { BrowserApi, Request } from "../src/browser/api";
import type { BrowserLibrary, BrowserNote } from "../src/browser/library";
import { markdownFixture } from "./helpers/browser-markdown-fixture";

const cryptoModule = "node:crypto";
const { webcrypto } = (await import(cryptoModule)) as { webcrypto: Crypto };
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const activeDrafts: BrowserDrafts[] = [];
afterEach(() => {
  for (const drafts of activeDrafts.splice(0)) drafts.dispose();
});

function singleFile() {
  const files = markdownFixture({ "note.md": "Original" });
  files.handles.set("browser-test", files.file("note.md"));
  const local: Record<string, unknown> = {};
  const api = {
    storage: {
      local: {
        get: async () => local,
        set: async (value: Record<string, unknown>) =>
          Object.assign(local, value),
        setAccessLevel: async () => {},
      },
    },
    tabs: { query: async () => [] },
  } as unknown as BrowserApi;
  let service = createBrowserService(api, files.bindings);
  const send = (message: Request) =>
    service.handle({ sourceId: "browser-test", ...message });
  const drafts = new BrowserDrafts(
    async (id, markdown, revision) =>
      (await send({ type: "save", id, markdown, revision })) as BrowserNote,
  );
  activeDrafts.push(drafts);
  return {
    files,
    drafts,
    send,
    restart: () => {
      service = createBrowserService(api, files.bindings);
    },
    open: async () => {
      await service.handle({
        type: "connect-source",
        bindingId: "browser-test",
        mode: "open",
      });
      const library = (await send({ type: "load" })) as BrowserLibrary;
      return drafts.activate(library.notes[0]!);
    },
  };
}

it("acknowledges consecutive single-file writes and retains CAS across a worker restart", async () => {
  const h = singleFile();
  const original = await h.open();
  const expectedRevisions = [original.note!.revision];
  for (const text of ["First", "Second"]) {
    h.drafts.edit(original.key, text);
    expect(await h.drafts.flush(original.key)).toBe(true);
    expect(h.files.text("note.md")).toBe(text);
    expect(h.drafts.get(original.key)).toMatchObject({
      text,
      dirty: false,
      saving: false,
      error: null,
      note: { markdown: text, filePath: "note.md" },
    });
    expectedRevisions.push(h.drafts.get(original.key)!.note!.revision);
    expect(h.drafts.hasPendingChanges()).toBe(false);
  }
  // Exercise the real content-token contract rather than a sequential-revision fake.
  expect(expectedRevisions[1]).not.toBe(expectedRevisions[0]! + 1);
  expect(expectedRevisions[2]).not.toBe(expectedRevisions[1]! + 1);
  h.restart();
  h.drafts.edit(original.key, "After restart");
  expect(await h.drafts.flush(original.key)).toBe(true);
  expect(h.files.text("note.md")).toBe("After restart");
  const loaded = ((await h.send({ type: "load" })) as BrowserLibrary).notes[0]!;
  expect(h.drafts.get(original.key)!.note).toEqual(loaded);

  h.files.put("note.md", "External change");
  h.drafts.edit(original.key, "Local draft after external change");
  expect(await h.drafts.flush(original.key)).toBe(false);
  expect(h.files.text("note.md")).toBe("External change");
  expect(h.drafts.get(original.key)).toMatchObject({
    text: "Local draft after external change",
    dirty: true,
    note: { markdown: "After restart", revision: loaded.revision },
  });
  expect(h.drafts.get(original.key)?.error).toContain("Another window");
});

const fileNote = (markdown = "Original", revision = 9001): BrowserNote => ({
  id: "file-id",
  url: "",
  title: "note.md",
  filePath: "note.md",
  markdown,
  revision,
  createdAt: 1,
  updatedAt: 1,
});

it.each([
  { revision: 0 },
  { revision: -1 },
  { revision: 1.5 },
  { revision: Number.NaN },
  { revision: Number.MAX_SAFE_INTEGER + 1 },
  { revision: 9001 },
  { id: "another-file" },
  { filePath: "other.md" },
  { filePath: undefined },
  { markdown: "Not the submitted draft" },
  { url: "https://different.test/" },
])(
  "rejects an invalid file acknowledgement %j without clearing the draft",
  async (patch) => {
    const drafts = new BrowserDrafts(async () => ({
      ...fileNote("Submitted", 17),
      ...patch,
    }));
    activeDrafts.push(drafts);
    drafts.activate(fileNote());
    drafts.edit("file-id", "Submitted");
    expect(await drafts.flush("file-id")).toBe(false);
    expect(drafts.get("file-id")).toMatchObject({
      text: "Submitted",
      dirty: true,
      note: { markdown: "Original", revision: 9001, filePath: "note.md" },
    });
  },
);

it("accepts a lower opaque token while preserving dirty and in-flight ownership", async () => {
  let acknowledge!: (note: BrowserNote) => void;
  const drafts = new BrowserDrafts(
    () =>
      new Promise<BrowserNote>((resolve) => {
        acknowledge = resolve;
      }),
  );
  activeDrafts.push(drafts);
  drafts.activate(fileNote());
  expect(drafts.activate(fileNote("Fresh observation", 27))).toMatchObject({
    text: "Fresh observation",
    note: { revision: 27 },
  });
  drafts.edit("file-id", "Submitted");
  drafts.activate(fileNote("Concurrent observation", 9));
  expect(drafts.get("file-id")).toMatchObject({
    text: "Submitted",
    note: { revision: 27 },
  });
  const saving = drafts.flush("file-id");
  drafts.activate(fileNote("Another observation", 40));
  expect(drafts.get("file-id")).toMatchObject({
    text: "Submitted",
    note: { revision: 27 },
  });
  acknowledge(fileNote("Submitted", 17));
  expect(await saving).toBe(true);
  expect(drafts.get("file-id")).toMatchObject({
    text: "Submitted",
    dirty: false,
    error: null,
    note: { revision: 17 },
  });
  // Equal opaque tokens cannot attest to different bytes.
  drafts.activate(fileNote("Contradictory same-token observation", 17));
  expect(drafts.get("file-id")?.text).toBe("Submitted");
});

it("keeps sequential acknowledgement validation for notes without a file binding", async () => {
  const legacy = {
    ...fileNote(),
    filePath: undefined,
    url: "https://example.test/",
  };
  const drafts = new BrowserDrafts(async () => ({
    ...legacy,
    markdown: "Submitted",
    revision: 17,
  }));
  activeDrafts.push(drafts);
  drafts.activate(legacy);
  drafts.edit(legacy.id, "Submitted");
  expect(await drafts.flush(legacy.id)).toBe(false);
  expect(drafts.get(legacy.id)?.dirty).toBe(true);
});

it("saves an undo made while a file write is pending using the acknowledged token", async () => {
  const h = singleFile();
  const original = await h.open();
  let entered!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  h.files.entries.get("note.md")!.beforeClose = async () => {
    if (!first) return;
    first = false;
    entered();
    await blocked;
  };
  h.drafts.edit(original.key, "Pending change");
  const save = h.drafts.flush(original.key);
  await writing;
  h.drafts.edit(original.key, "Original");
  expect(h.drafts.hasPendingChanges()).toBe(true);
  release();
  expect(await save).toBe(true);
  expect(h.files.text("note.md")).toBe("Original");
  expect(h.files.entries.get("note.md")!.closes).toBe(2);
  expect(h.drafts.get(original.key)).toMatchObject({
    text: "Original",
    dirty: false,
    error: null,
    note: { revision: original.note!.revision },
  });
  expect(h.drafts.hasPendingChanges()).toBe(false);
});

it("keeps a denied file write pending with actionable permission guidance, then retries", async () => {
  const h = singleFile();
  const original = await h.open();
  h.files.state.allowed = false;
  h.drafts.edit(original.key, "Keep this local draft");
  expect(await h.drafts.flush(original.key)).toBe(false);
  expect(h.files.text("note.md")).toBe("Original");
  expect(h.drafts.get(original.key)).toMatchObject({
    text: "Keep this local draft",
    dirty: true,
    error:
      "File editing needs permission. Reconnect access to save; your draft is unchanged.",
  });
  h.files.state.allowed = true;
  expect(await h.drafts.flush(original.key)).toBe(true);
  expect(h.files.text("note.md")).toBe("Keep this local draft");
  expect(h.drafts.get(original.key)).toMatchObject({
    dirty: false,
    error: null,
  });
});
