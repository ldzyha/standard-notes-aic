import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  BrowserDrafts,
  rebaseFocusedPage,
} from "../src/browser/drafts";
import type { BrowserNote } from "../src/browser/library";

function note(id: string, markdown = "Original", revision = 1): BrowserNote {
  return { id, filePath: `${id}.md`, markdown, revision };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("browser note drafts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces autosave and returns only independent snapshots", async () => {
    const save = vi.fn(
      async (_id: string, markdown: string, revision: number) =>
        note("a", markdown, revision + 1),
    );
    const changed: string[] = [];
    const drafts = new BrowserDrafts(save, (draft) => changed.push(draft.text));
    const original = note("a");
    const first = drafts.activate(original);
    first.note.markdown = "Mutated";
    original.markdown = "Mutated too";
    expect(drafts.get("a")?.note.markdown).toBe("Original");

    drafts.edit("a", "First");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    drafts.edit("a", "Second");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("a", "Second", 1);
    expect(drafts.get("a")).toMatchObject({
      text: "Second",
      dirty: false,
      saving: false,
    });
    expect(drafts.get("a")?.note.revision).toBe(2);
    expect(changed).toContain("Second");
    drafts.dispose();
  });

  it("saves a newer edit after an older acknowledgment without clearing dirty state", async () => {
    const first = deferred<BrowserNote>();
    const second = deferred<BrowserNote>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const pendingStates: boolean[] = [];
    const drafts = new BrowserDrafts(save, () =>
      pendingStates.push(drafts.hasPendingChanges()),
    );
    drafts.activate(note("a"));
    drafts.edit("a", "First");
    const flushing = drafts.flush("a");
    expect(drafts.get("a")).toMatchObject({ dirty: true, saving: true });
    pendingStates.length = 0;
    drafts.edit("a", "Latest");
    first.resolve(note("a", "First", 2));
    await Promise.resolve();
    expect(save).toHaveBeenNthCalledWith(2, "a", "Latest", 2);
    expect(drafts.get("a")).toMatchObject({
      text: "Latest",
      dirty: true,
      saving: true,
    });
    expect(pendingStates.length).toBeGreaterThan(0);
    expect(pendingStates.every(Boolean)).toBe(true);
    second.resolve(note("a", "Latest", 3));
    expect(await flushing).toBe(true);
    expect(drafts.get("a")).toMatchObject({
      text: "Latest",
      dirty: false,
      saving: false,
    });
    expect(pendingStates.at(-1)).toBe(false);
    drafts.dispose();
  });

  it("keeps old-note saves attached to the old ID across activation switches", async () => {
    const first = deferred<BrowserNote>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(
        async (id: string, markdown: string, revision: number) =>
          note(id, markdown, revision + 1),
      );
    const pendingStates: boolean[] = [];
    const drafts = new BrowserDrafts(save, () =>
      pendingStates.push(drafts.hasPendingChanges()),
    );
    drafts.activate(note("a"));
    drafts.edit("a", "A first");
    const oldSave = drafts.flush("a");
    drafts.edit("a", "A latest");
    drafts.activate(note("b", "B"));
    drafts.edit("b", "B edit");
    const all = drafts.flushAll();
    expect(save).toHaveBeenNthCalledWith(2, "b", "B edit", 1);
    first.resolve(note("a", "A first", 2));
    expect(await oldSave).toBe(true);
    expect(await all).toBe(true);
    expect(save).toHaveBeenNthCalledWith(3, "a", "A latest", 2);
    expect(drafts.get("b")?.text).toBe("B edit");
    expect(drafts.get("a")).toBeUndefined(); // Clean inactive drafts are pruned.
    expect(pendingStates.at(-1)).toBe(false);
    drafts.dispose();
  });

  it("does not overwrite a dirty draft with a newer remote revision", async () => {
    const save = vi.fn(async () => {
      throw { code: "conflict", message: "untrusted details" };
    });
    const drafts = new BrowserDrafts(save);
    drafts.activate(note("a", "Original", 1));
    drafts.edit("a", "Local work");
    const returned = drafts.activate(note("a", "Remote work", 2));
    expect(returned).toMatchObject({ text: "Local work", dirty: true });
    expect(returned.note).toMatchObject({ markdown: "Original", revision: 1 });
    expect(await drafts.flush("a")).toBe(false);
    expect(save).toHaveBeenCalledWith("a", "Local work", 1);
    expect(drafts.get("a")?.error).toContain("Another window");
    expect(drafts.get("a")?.error).not.toContain("untrusted");
    drafts.dispose();
  });

  it("stops automatic retry after failure until a new edit or explicit flush", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce({
        code: "quota",
        message: "internal storage details",
      })
      .mockResolvedValueOnce(note("a", "Changed", 2))
      .mockRejectedValueOnce({ code: "storage" })
      .mockResolvedValueOnce(note("a", "Newest", 3));
    const drafts = new BrowserDrafts(save);
    drafts.activate(note("a"));
    drafts.edit("a", "Changed");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(drafts.get("a")?.error).toContain("note file is too large");
    expect(drafts.dirtyDrafts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await drafts.flush("a")).toBe(true);
    drafts.edit("a", "Newest");
    expect(await drafts.flush("a")).toBe(false);
    expect(drafts.get("a")?.error).toContain("Could not save the note file");
    expect(await drafts.flush("a")).toBe(true);
    drafts.dispose();
  });

  it("clears timers on disposal and does not start a later autosave", async () => {
    const save = vi.fn(async () => note("a", "Changed", 2));
    const drafts = new BrowserDrafts(save);
    drafts.activate(note("a"));
    drafts.edit("a", "Changed");
    drafts.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(await drafts.flush("a")).toBe(false);
    expect(drafts.get("a")).toBeUndefined();
    expect(drafts.dirtyDrafts()).toEqual([]);
  });

  it("does not retain plaintext or emit a late save after disposal", async () => {
    let acknowledge!: (value: BrowserNote) => void;
    const pending = new Promise<BrowserNote>((resolve) => {
      acknowledge = resolve;
    });
    const notify = vi.fn();
    const drafts = new BrowserDrafts(() => pending, notify);
    drafts.activate(note("a"));
    drafts.edit("a", "Synthetic confidential draft");
    const save = drafts.flush("a");
    drafts.dispose();
    notify.mockClear();
    acknowledge(note("a", "Synthetic confidential draft", 2));
    expect(await save).toBe(false);
    expect(drafts.get("a")).toBeUndefined();
    expect(drafts.dirtyDrafts()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
  it("rebases a conflicting draft onto the reloaded file and saves it", async () => {
    const stored = note("a", "Disk\n\n--- t\nPage", 7);
    const save = vi.fn(
      async (id: string, markdown: string, revision: number) => {
        if (revision !== stored.revision) throw { code: "conflict" };
        return note(id, markdown, revision + 1);
      },
    );
    const adopted = vi.fn();
    const rebase = vi.fn((base: string, text: string, disk: BrowserNote) =>
      rebaseFocusedPage(base, text, disk.markdown, "t"),
    );
    const drafts = new BrowserDrafts(save, undefined, {
      reload: async () => ({ ...stored }),
      rebase,
      adopted,
    });
    drafts.activate(note("a", "Base\n\n--- t\nPage", 1));
    drafts.edit("a", "Base\n\n--- t\nMy page");
    expect(await drafts.flush("a")).toBe(true);
    expect(rebase).toHaveBeenCalledExactlyOnceWith(
      "Base\n\n--- t\nPage",
      "Base\n\n--- t\nMy page",
      stored,
    );
    expect(save).toHaveBeenLastCalledWith("a", "Disk\n\n--- t\nMy page", 7);
    expect(adopted).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ text: "Disk\n\n--- t\nMy page", dirty: true }),
    );
    expect(drafts.get("a")).toMatchObject({
      text: "Disk\n\n--- t\nMy page",
      dirty: false,
      conflict: false,
      error: null,
    });
    drafts.dispose();
  });

  it("stays in conflict when the draft cannot be rebased, until it is discarded", async () => {
    const save = vi.fn(async () => {
      throw { code: "conflict" };
    });
    const stored = note("a", "Disk", 9);
    const reload = vi.fn(async () => ({ ...stored }));
    const adopted = vi.fn();
    const drafts = new BrowserDrafts(save, undefined, {
      reload,
      rebase: () => null,
      adopted,
    });
    drafts.activate(note("a", "Base", 1));
    drafts.edit("a", "Mine");
    expect(await drafts.flush("a")).toBe(false);
    expect(drafts.get("a")).toMatchObject({
      text: "Mine",
      dirty: true,
      conflict: true,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(adopted).not.toHaveBeenCalled();
    expect(drafts.hasPendingChanges()).toBe(true);
    // Another note's text is never taken.
    expect(drafts.discard("a", note("b", "Other", 2))).toBeUndefined();
    expect(drafts.discard("a", stored)).toMatchObject({
      text: "Disk",
      dirty: false,
      conflict: false,
      error: null,
    });
    expect(drafts.hasPendingChanges()).toBe(false);
    expect(await drafts.flushAll()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    drafts.dispose();
  });

  it("gives up after repeated conflicts instead of looping", async () => {
    let revision = 1;
    const save = vi.fn(async () => {
      throw { code: "conflict" };
    });
    const drafts = new BrowserDrafts(save, undefined, {
      reload: async () => note("a", "Disk", (revision += 1)),
      rebase: (_base, text) => text,
      adopted: () => undefined,
    });
    drafts.activate(note("a", "Base", 1));
    drafts.edit("a", "Mine");
    expect(await drafts.flush("a")).toBe(false);
    expect(save).toHaveBeenCalledTimes(3);
    expect(drafts.get("a")).toMatchObject({ text: "Mine", conflict: true });
    drafts.dispose();
  });
});

describe("rebasing the focused page", () => {
  const A = "https://example.com/a";
  const B = "https://example.com/b";
  const base = `Intro\n\n--- ${A}\nAlpha\n\n--- ${B}\nBeta\n`;

  it("splices the page into disk text and keeps every other byte", () => {
    const draft = base.replace("Alpha", "Alpha\nmine");
    const disk = `Intro 2\r\n\n--- ${A}\nAlpha\n\n\n--- ${B}\nBeta 2\n\n--- c\nC`;
    expect(rebaseFocusedPage(base, draft, disk, A)).toBe(
      disk.replace("Alpha", "Alpha\nmine"),
    );
    // The last page gains the blank line the disk text put after it.
    const last = base.replace("Beta", "Beta mine");
    const appended = `${base}\n--- c\nC\n`;
    expect(rebaseFocusedPage(base, last, appended, `${B}#x`)).toBe(
      appended.replace("Beta", "Beta mine"),
    );
    // An emptied page stays empty and keeps its separator a separator.
    expect(rebaseFocusedPage(base, base.replace("Alpha", ""), disk, A)).toBe(
      disk.replace("Alpha", ""),
    );
  });

  it("appends a page the draft created", () => {
    const draft = `${base}\n--- c\nMine`;
    const disk = base.replace("Beta\n", "Beta 2");
    expect(rebaseFocusedPage(base, draft, disk, "c")).toBe(
      `${disk}\n\n--- c\nMine`,
    );
    // The same page created on disk too is a conflict.
    expect(
      rebaseFocusedPage(base, draft, `${disk}\n\n--- c\nTheirs`, "c"),
    ).toBe(null);
  });

  it("refuses whenever text could be lost", () => {
    const draft = base.replace("Alpha", "Mine");
    for (const [disk, target] of [
      [base.replace("Alpha", "Theirs"), A],
      [base.replace(`--- ${A}\nAlpha\n\n`, ""), A],
      [base, null],
      [base, "https://example.com/none"],
      // The draft also changed another page.
      [base, B],
    ] as const)
      expect(rebaseFocusedPage(base, draft, disk, target)).toBeNull();
    expect(
      rebaseFocusedPage(base, draft.replace("Beta", "Beta mine"), base, A),
    ).toBeNull();
    expect(
      rebaseFocusedPage(base, draft.replace("Intro", "Intro mine"), base, A),
    ).toBeNull();
  });
});
