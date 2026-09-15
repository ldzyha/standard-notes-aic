import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainDrafts, type DomainContext } from "../src/browser/domain-drafts";
import { AUTOSAVE_DELAY_MS } from "../src/browser/drafts";
import type { BrowserDomain } from "../src/browser/library";
import { AIC_EMPTY_DOCUMENT } from "../src/core/security-model.js";

const seed = AIC_EMPTY_DOCUMENT;
const first: DomainContext = {
  origin: "https://example.com",
  title: "Example",
};
const second: DomainContext = {
  origin: "https://example.com:8443",
  title: "Example on another port",
};

function domain(
  id: string,
  origin: string,
  markdown = seed,
  revision = 1,
): BrowserDomain {
  return { id, origin, markdown, createdAt: 1, updatedAt: revision, revision };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("domain Properties drafts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps exact origins isolated and returns detached snapshots", () => {
    const drafts = new DomainDrafts(vi.fn());
    const a = drafts.activatePlaceholder(first, seed);
    drafts.edit(a.key, `${seed}A`);
    const b = drafts.activatePlaceholder(second, seed);
    expect(a.key).toBe("pending:https://example.com");
    expect(b.key).toBe("pending:https://example.com:8443");
    a.context.origin = "https://changed.invalid";
    b.context.title = "Changed";
    expect(drafts.get(a.key)?.context.origin).toBe(first.origin);
    expect(drafts.get(b.key)?.context.title).toBe(second.title);
    expect(drafts.get(b.key)?.text).toBe(seed);
    expect(drafts.dirtyDrafts()).toHaveLength(1);
    drafts.dispose();
  });

  it("bounds origin lookups to active or pending drafts across many untouched sites", () => {
    const drafts = new DomainDrafts(vi.fn());
    const lookup = (drafts as unknown as { keyByOrigin: Map<string, string> })
      .keyByOrigin;
    const retained = drafts.activatePlaceholder(first, seed).key;
    drafts.edit(retained, `${seed}Unsaved`);
    for (let index = 0; index < 120; index += 1) {
      drafts.activatePlaceholder(
        { origin: `https://site-${index}.example`, title: `Site ${index}` },
        seed,
      );
      expect(lookup.size).toBe(2);
      expect(lookup.get(first.origin)).toBe(retained);
    }
    drafts.edit(retained, seed);
    drafts.activatePlaceholder(
      { origin: "https://last.example", title: "Last" },
      seed,
    );
    expect(lookup.size).toBe(1);
    expect(lookup.has(first.origin)).toBe(false);
    drafts.dispose();
    expect(lookup.size).toBe(0);
  });

  it("debounces autosave and validates the domain create acknowledgment", async () => {
    const create = vi.fn(async (_context: DomainContext, markdown: string) =>
      domain("a", first.origin, markdown),
    );
    const notifications: string[] = [];
    const drafts = new DomainDrafts(
      vi.fn(),
      (draft) => {
        notifications.push(draft.text);
      },
      create,
    );
    const key = drafts.activatePlaceholder(first, seed).key;
    drafts.edit(key, `${seed}A`);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(create).not.toHaveBeenCalled();
    drafts.edit(key, `${seed}Latest`);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(create).toHaveBeenCalledExactlyOnceWith(first, `${seed}Latest`);
    expect(drafts.get(key)).toMatchObject({
      dirty: false,
      record: { id: "a", origin: first.origin, revision: 1 },
    });
    expect(notifications).toContain(`${seed}Latest`);
    expect(
      drafts.activate(domain("a", first.origin, `${seed}Latest`)).key,
    ).toBe(key);
    drafts.dispose();
  });

  it("drains a newer edit after an older create ACK using the persisted ID", async () => {
    const createPending = deferred<BrowserDomain>();
    const savePending = deferred<BrowserDomain>();
    const create = vi.fn(() => createPending.promise);
    const save = vi.fn(() => savePending.promise);
    const drafts = new DomainDrafts(save, undefined, create);
    const key = drafts.activatePlaceholder(first, seed).key;
    drafts.edit(key, "First");
    const flushing = drafts.flush(key);
    drafts.edit(key, "Latest");
    createPending.resolve(domain("a", first.origin, "First"));
    await Promise.resolve();
    expect(save).toHaveBeenCalledExactlyOnceWith("a", "Latest", 1);
    expect(drafts.get(key)).toMatchObject({ dirty: true, saving: true });
    savePending.resolve(domain("a", first.origin, "Latest", 2));
    expect(await flushing).toBe(true);
    expect(drafts.get(key)).toMatchObject({
      dirty: false,
      record: { id: "a", revision: 2 },
    });
    drafts.dispose();
  });

  it("rejects a cross-origin ACK without storing its record", async () => {
    const create = vi.fn(async () => domain("wrong", second.origin, "Draft"));
    const drafts = new DomainDrafts(vi.fn(), undefined, create);
    const key = drafts.activatePlaceholder(first, seed).key;
    drafts.edit(key, "Draft");
    expect(await drafts.flush(key)).toBe(false);
    expect(drafts.get(key)).toMatchObject({
      dirty: true,
      record: null,
      text: "Draft",
    });
    expect(drafts.get(key)?.error).toContain("Another window");
    drafts.dispose();
  });

  it("rejects a wrong revision, identity, or source ACK for an existing domain", async () => {
    for (const invalid of [
      domain("other", first.origin, "Changed", 2),
      domain("a", first.origin, "Changed", 3),
      domain("a", first.origin, "Wrong content", 2),
      domain("a", second.origin, "Changed", 2),
    ]) {
      const drafts = new DomainDrafts(vi.fn(async () => invalid));
      drafts.activate(domain("a", first.origin, seed));
      drafts.edit("a", "Changed");
      expect(await drafts.flush("a")).toBe(false);
      expect(drafts.get("a")).toMatchObject({
        text: "Changed",
        dirty: true,
        record: { id: "a", origin: first.origin, revision: 1 },
      });
      drafts.dispose();
    }
  });

  it("surfaces an incoming remote revision as a blocked conflict without overwriting local text", async () => {
    const save = vi.fn(async () => domain("a", first.origin, "Local", 2));
    const drafts = new DomainDrafts(save);
    drafts.activate(domain("a", first.origin));
    drafts.edit("a", "Local");
    const returned = drafts.activate(domain("a", first.origin, "Remote", 2));
    expect(returned).toMatchObject({
      text: "Local",
      dirty: true,
      record: { markdown: seed, revision: 1 },
    });
    expect(returned.error).toContain("Another window");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(drafts.hasPendingChanges()).toBe(true);
    drafts.dispose();
  });

  it("keeps a dirty placeholder when another panel creates the domain", async () => {
    const drafts = new DomainDrafts(vi.fn(), undefined, vi.fn());
    const key = drafts.activatePlaceholder(first, seed).key;
    drafts.edit(key, "Local");
    const returned = drafts.activate(domain("remote", first.origin, "Remote"));
    expect(returned).toMatchObject({
      key,
      text: "Local",
      record: null,
      dirty: true,
    });
    expect(returned.error).toContain("Another window");
    drafts.dispose();
  });

  it("keeps a dirty persisted draft visible when its remote identity changes or disappears", () => {
    const drafts = new DomainDrafts(vi.fn());
    drafts.activate(domain("old", first.origin));
    drafts.edit("old", "Local");
    const replaced = drafts.activate(
      domain("replacement", first.origin, "Remote"),
    );
    expect(replaced).toMatchObject({
      key: "old",
      text: "Local",
      record: { id: "old", markdown: seed },
      dirty: true,
    });
    expect(replaced.error).toContain("Another window");
    const missing = drafts.activatePlaceholder(first, seed);
    expect(missing.key).toBe("old");
    expect(missing.text).toBe("Local");
    drafts.dispose();
  });

  it("retries page_changed create only on activation and scrubs plaintext at disposal", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({ code: "page_changed" })
      .mockResolvedValueOnce(domain("a", first.origin, "Sensitive"));
    const notify = vi.fn();
    const drafts = new DomainDrafts(vi.fn(), notify, create);
    const key = drafts.activatePlaceholder(first, seed).key;
    drafts.edit(key, "Sensitive");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(drafts.get(key)?.error).toContain("Return to this domain");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(create).toHaveBeenCalledTimes(1);
    drafts.activatePlaceholder(first, seed);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(create).toHaveBeenCalledTimes(2);
    expect(drafts.get(key)?.dirty).toBe(false);
    drafts.dispose();
    notify.mockClear();
    expect(drafts.get(key)).toBeUndefined();
    expect(drafts.dirtyDrafts()).toEqual([]);
    expect(drafts.hasPendingChanges()).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(notify).not.toHaveBeenCalled();
  });
});
