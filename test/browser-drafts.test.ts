import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY_MS, BrowserDrafts } from "../src/browser/drafts";
import type { BrowserNote, PageContext } from "../src/browser/library";

const placeholder = "---\n# aic-fields: v2\n---\n\n";
const newPage: PageContext = {
  url: "https://example.com/new",
  title: "New",
};

function note(id: string, markdown = "Original", revision = 1): BrowserNote {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    markdown,
    createdAt: 1,
    updatedAt: revision,
    revision,
  };
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

  it("forgets only idle acknowledged drafts and starts a clean placeholder after deletion", async () => {
    const pending = deferred<BrowserNote>();
    const drafts = new BrowserDrafts(() => pending.promise);
    drafts.activate(note("a"));
    expect(drafts.getForPage("https://example.com/a")?.key).toBe("a");
    drafts.edit("a", "Edited");
    expect(drafts.forget("a")).toBe(false);
    const saving = drafts.flush("a");
    expect(drafts.forget("a")).toBe(false);
    pending.resolve(note("a", "Edited", 2));
    await saving;
    expect(drafts.forget("a")).toBe(true);
    expect(drafts.getForPage("https://example.com/a")).toBeUndefined();
    const fresh = drafts.activatePlaceholder(
      { url: "https://example.com/a", title: "a" },
      placeholder,
    );
    expect(fresh).toMatchObject({
      text: placeholder,
      note: null,
      dirty: false,
    });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(drafts.hasPendingChanges()).toBe(false);
    drafts.dispose();
  });

  it("debounces autosave and returns only independent snapshots", async () => {
    const save = vi.fn(
      async (_id: string, markdown: string, revision: number) =>
        note("a", markdown, revision + 1),
    );
    const changed: string[] = [];
    const drafts = new BrowserDrafts(save, (draft) => changed.push(draft.text));
    const original = note("a");
    const first = drafts.activate(original);
    first.note!.markdown = "Mutated";
    original.markdown = "Mutated too";
    expect(drafts.get("a")?.note?.markdown).toBe("Original");

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
    expect(drafts.get("a")?.note?.revision).toBe(2);
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
    const drafts = new BrowserDrafts(save);
    drafts.activate(note("a"));
    drafts.edit("a", "First");
    const flushing = drafts.flush("a");
    expect(drafts.get("a")).toMatchObject({ dirty: true, saving: true });
    drafts.edit("a", "Latest");
    first.resolve(note("a", "First", 2));
    await Promise.resolve();
    expect(save).toHaveBeenNthCalledWith(2, "a", "Latest", 2);
    expect(drafts.get("a")).toMatchObject({
      text: "Latest",
      dirty: true,
      saving: true,
    });
    second.resolve(note("a", "Latest", 3));
    expect(await flushing).toBe(true);
    expect(drafts.get("a")).toMatchObject({
      text: "Latest",
      dirty: false,
      saving: false,
    });
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
    const drafts = new BrowserDrafts(save);
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
    expect(drafts.get("a")?.error).toContain("storage is full");
    expect(drafts.dirtyDrafts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await drafts.flush("a")).toBe(true);
    drafts.edit("a", "Newest");
    expect(await drafts.flush("a")).toBe(false);
    expect(drafts.get("a")?.error).toContain(
      "Could not save to browser storage",
    );
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

  it("keeps an untouched placeholder in memory and cancels autosave after undo", async () => {
    const save = vi.fn();
    const create = vi.fn();
    const drafts = new BrowserDrafts(save, undefined, create);
    const first = drafts.activatePlaceholder(newPage, placeholder);
    expect(first).toMatchObject({
      key: `pending:${newPage.url}`,
      note: null,
      text: placeholder,
      dirty: false,
    });
    first.page.title = "Outside mutation";
    expect(drafts.get(first.key)?.page.title).toBe("New");
    expect(await drafts.flush(first.key)).toBe(true);
    expect(await drafts.flushAll()).toBe(true);
    drafts.edit(first.key, `${placeholder}Draft`);
    drafts.edit(first.key, placeholder);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(drafts.dirtyDrafts()).toEqual([]);
    drafts.dispose();
  });

  it("keeps its key and later edits through the first-create acknowledgment", async () => {
    const first = deferred<BrowserNote>();
    const second = deferred<BrowserNote>();
    const create = vi.fn(() => first.promise);
    const save = vi.fn(() => second.promise);
    const drafts = new BrowserDrafts(save, undefined, create);
    const key = drafts.activatePlaceholder(newPage, placeholder).key;
    drafts.edit(key, "First");
    const flushing = drafts.flush(key);
    expect(create).toHaveBeenCalledExactlyOnceWith(newPage, "First");
    drafts.edit(key, "Latest");
    first.resolve(note("new", "First"));
    await Promise.resolve();
    expect(save).toHaveBeenCalledExactlyOnceWith("new", "Latest", 1);
    expect(drafts.get(key)).toMatchObject({
      key,
      text: "Latest",
      dirty: true,
      saving: true,
      note: { id: "new", markdown: "First" },
    });
    second.resolve(note("new", "Latest", 2));
    expect(await flushing).toBe(true);
    expect(drafts.get(key)).toMatchObject({
      key,
      text: "Latest",
      dirty: false,
      saving: false,
      note: { id: "new", revision: 2 },
    });
    expect(drafts.activate(note("new", "Latest", 2)).key).toBe(key);
    drafts.dispose();
  });

  it("retains a failed first-create draft and retries only after an explicit action", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ code: "conflict", message: "untrusted" })
      .mockResolvedValueOnce(note("new", "Changed"));
    const drafts = new BrowserDrafts(vi.fn(), undefined, create);
    const key = drafts.activatePlaceholder(newPage, placeholder).key;
    drafts.edit(key, "Changed");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(drafts.get(key)).toMatchObject({
      note: null,
      text: "Changed",
      dirty: true,
    });
    expect(drafts.get(key)?.error).toContain("Another window");
    expect(drafts.get(key)?.error).not.toContain("untrusted");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 10);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await drafts.flush(key)).toBe(true);
    expect(drafts.get(key)?.note?.id).toBe("new");
    drafts.dispose();
  });

  it("does not overwrite a dirty placeholder when a note appears elsewhere", async () => {
    const create = vi.fn(async () => {
      throw { code: "conflict" };
    });
    const drafts = new BrowserDrafts(vi.fn(), undefined, create);
    const key = drafts.activatePlaceholder(newPage, placeholder).key;
    drafts.edit(key, "Local draft");
    expect(drafts.activate(note("new", "Remote"))).toMatchObject({
      key,
      note: null,
      text: "Local draft",
      dirty: true,
    });
    expect(await drafts.flush(key)).toBe(false);
    expect(drafts.get(key)?.text).toBe("Local draft");
    drafts.dispose();
  });

  it("retries only a page-changed first create when the source page is activated again", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ code: "page_changed" })
      .mockResolvedValueOnce(note("new", "Local draft"));
    const drafts = new BrowserDrafts(vi.fn(), undefined, create);
    const key = drafts.activatePlaceholder(newPage, placeholder).key;
    drafts.edit(key, "Local draft");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(drafts.get(key)?.error).toBe(
      "Return to this page to save your new note, or export the draft.",
    );
    expect(drafts.get(key)).toMatchObject({
      note: null,
      text: "Local draft",
      dirty: true,
    });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(create).toHaveBeenCalledTimes(1);
    expect(drafts.activatePlaceholder(newPage, placeholder).text).toBe(
      "Local draft",
    );
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(create).toHaveBeenCalledTimes(2);
    expect(drafts.get(key)).toMatchObject({
      text: "Local draft",
      dirty: false,
      note: { id: "new", markdown: "Local draft" },
    });
    drafts.dispose();
  });

  it.each(["storage", "conflict"])(
    "does not automatically retry %s errors on source activation",
    async (code) => {
      const create = vi.fn(async () => {
        throw { code };
      });
      const drafts = new BrowserDrafts(vi.fn(), undefined, create);
      const key = drafts.activatePlaceholder(newPage, placeholder).key;
      drafts.edit(key, "Local draft");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
      drafts.activatePlaceholder(newPage, placeholder);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
      expect(create).toHaveBeenCalledTimes(1);
      expect(drafts.get(key)?.text).toBe("Local draft");
      drafts.dispose();
    },
  );

  it("counts an undone edit as pending until its in-flight create is compensated", async () => {
    const createPending = deferred<BrowserNote>();
    const savePending = deferred<BrowserNote>();
    const create = vi.fn(() => createPending.promise);
    const save = vi.fn(() => savePending.promise);
    const drafts = new BrowserDrafts(save, undefined, create);
    const key = drafts.activatePlaceholder(newPage, placeholder).key;
    expect(drafts.hasPendingChanges()).toBe(false);
    drafts.edit(key, "Changed");
    const flushing = drafts.flush(key);
    drafts.edit(key, placeholder);
    expect(drafts.get(key)?.dirty).toBe(false);
    expect(drafts.hasPendingChanges()).toBe(true);
    createPending.resolve(note("new", "Changed"));
    await Promise.resolve();
    expect(save).toHaveBeenCalledExactlyOnceWith("new", placeholder, 1);
    expect(drafts.hasPendingChanges()).toBe(true);
    savePending.resolve(note("new", placeholder, 2));
    expect(await flushing).toBe(true);
    expect(drafts.hasPendingChanges()).toBe(false);
    drafts.dispose();
    expect(drafts.hasPendingChanges()).toBe(false);
  });
});
