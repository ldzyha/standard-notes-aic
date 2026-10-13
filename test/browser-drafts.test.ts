import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY_MS, BrowserDrafts } from "../src/browser/drafts";
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
});
