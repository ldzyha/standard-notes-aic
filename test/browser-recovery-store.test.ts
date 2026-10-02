import { describe, expect, it, vi } from "vitest";
import {
  BrowserDraftRecovery,
  RECOVERY_KEY,
  type RecoveryDraft,
} from "../src/browser/recovery-store";

const CLIENT = "panel-fixture";
const SOURCE = "browser-test";
const draft = (value = "Unsaved synthetic draft"): RecoveryDraft => ({
  scope: "current",
  key: "pending:https://example.test/note",
  context: { url: "https://example.test/note", title: "Synthetic note" },
  record: { id: "synthetic-note", revision: 1, markdown: "Earlier saved text" },
  text: value,
});

function harness(initial: Record<string, unknown> = {}) {
  const local = structuredClone(initial);
  const flags = { failRead: false, failWrite: false };
  const persistence = {
    get: vi.fn(async (key: string) => {
      if (flags.failRead) throw new Error("Synthetic unavailable storage");
      return { [key]: structuredClone(local[key]) };
    }),
    set: vi.fn(async (value: Record<string, unknown>) => {
      if (flags.failWrite) throw new Error("Synthetic quota failure");
      Object.assign(local, structuredClone(value));
    }),
  };
  let recovery = new BrowserDraftRecovery(persistence);
  return {
    local,
    flags,
    persistence,
    checkpoint: (sequence: number, entries: RecoveryDraft[] = [draft()]) =>
      recovery.checkpoint(SOURCE, CLIENT, sequence, entries),
    list: (source = SOURCE) => recovery.list(source),
    store: () => recovery,
    restart: () => {
      recovery = new BrowserDraftRecovery(persistence);
    },
  };
}

type Journal = {
  version: number;
  snapshots: {
    clientId: string;
    sourceId: string;
    sequence: number;
    updatedAt: number;
    entries: unknown;
  }[];
};

describe("plain Markdown draft recovery", () => {
  it("restores an acknowledged draft after worker restart without session state or replaying files", async () => {
    const h = harness();
    await expect(h.checkpoint(1)).resolves.toEqual({ sequence: 1 });
    expect(JSON.stringify(h.local[RECOVERY_KEY])).toContain(draft().text);
    expect(h.local[RECOVERY_KEY]).toMatchObject({ version: 2 });
    h.restart();
    const beforeRead = structuredClone(h.local);
    expect(await h.list()).toMatchObject([
      { clientId: CLIENT, sourceId: SOURCE, sequence: 1, entries: [draft()] },
    ]);
    expect(h.local).toEqual(beforeRead);
    expect(
      h.persistence.get.mock.calls.every(([key]) => key === RECOVERY_KEY),
    ).toBe(true);
  });

  it("writes only the new Markdown recovery key and leaves unsupported old data untouched", async () => {
    const oldKey = "aic-browser-draft-recovery";
    const oldData = {
      version: 1,
      snapshots: [{ envelope: "opaque old bytes" }],
    };
    const h = harness({
      [oldKey]: oldData,
      "aic-browser-library": { opaque: "original bytes" },
    });
    await h.checkpoint(1);
    await h.store().dismiss(SOURCE, CLIENT, 1);
    expect(RECOVERY_KEY).not.toBe(oldKey);
    expect(h.local[oldKey]).toEqual(oldData);
    expect(h.local["aic-browser-library"]).toEqual({
      opaque: "original bytes",
    });
    expect(
      h.persistence.set.mock.calls.every(
        ([value]) => Object.keys(value).join() === RECOVERY_KEY,
      ),
    ).toBe(true);
  });

  it("isolates sources and clients without losing drafts when a different source is opened", async () => {
    const h = harness();
    await h.checkpoint(1);
    await h
      .store()
      .checkpoint(SOURCE, "another-panel", 1, [draft("Another panel")]);
    await h
      .store()
      .checkpoint("browser-other", CLIENT, 2, [draft("Other folder")]);
    expect(await h.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: CLIENT, entries: [draft()] }),
        expect.objectContaining({
          clientId: "another-panel",
          entries: [draft("Another panel")],
        }),
      ]),
    );
    expect(await h.list("browser-other")).toMatchObject([
      { clientId: CLIENT, sequence: 2, entries: [draft("Other folder")] },
    ]);
    await h.store().dismiss("browser-other", CLIENT, 2);
    expect(await h.list("browser-other")).toEqual([]);
    expect(await h.list()).toHaveLength(2);
  });

  it("serializes concurrent checkpoints and preserves clear and dismissal tombstones after restart", async () => {
    const h = harness();
    await Promise.all([
      h.checkpoint(2, [draft("Newer draft")]),
      h.checkpoint(1, [draft("Stale draft")]),
    ]);
    expect(await h.list()).toMatchObject([
      { sequence: 2, entries: [draft("Newer draft")] },
    ]);
    await h.checkpoint(3, []);
    h.restart();
    expect(await h.checkpoint(2, [draft("Delayed draft")])).toEqual({
      sequence: 3,
    });
    expect(await h.list()).toEqual([]);
    await h.checkpoint(4, [draft("Next edit")]);
    await h.checkpoint(3, []);
    await expect(h.store().dismiss(SOURCE, CLIENT, 3)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await h.list()).toMatchObject([
      { sequence: 4, entries: [draft("Next edit")] },
    ]);
    await h.store().dismiss(SOURCE, CLIENT, 4);
    h.restart();
    await h.checkpoint(4, [draft("Late dismissed snapshot")]);
    expect(await h.list()).toEqual([]);
    await h.checkpoint(5, [draft("Later edit")]);
    expect(await h.list()).toMatchObject([
      { sequence: 5, entries: [draft("Later edit")] },
    ]);
  });

  it("does not acknowledge failed writes and retains the last durable checkpoint for retry", async () => {
    const h = harness();
    await h.checkpoint(1);
    h.flags.failWrite = true;
    await expect(h.checkpoint(2, [draft("New text")])).rejects.toMatchObject({
      code: "storage",
    });
    h.restart();
    expect(await h.list()).toMatchObject([{ sequence: 1, entries: [draft()] }]);
    h.flags.failWrite = false;
    await expect(h.checkpoint(2, [draft("New text")])).resolves.toEqual({
      sequence: 2,
    });
    expect(await h.list()).toMatchObject([
      { sequence: 2, entries: [draft("New text")] },
    ]);
    h.flags.failRead = true;
    await expect(h.checkpoint(3)).rejects.toMatchObject({ code: "storage" });
    h.flags.failRead = false;
    expect(await h.list()).toMatchObject([{ sequence: 2 }]);
  });

  it("accepts a file context only when it matches a saved record identity", async () => {
    const h = harness();
    const fileDraft = {
      ...draft(),
      key: "note:synthetic-note",
      context: { url: "file:synthetic-note", title: "note.md" },
    } as RecoveryDraft;
    await h.checkpoint(1, [fileDraft]);
    expect(await h.list()).toMatchObject([{ entries: [fileDraft] }]);
    for (const invalid of [
      { ...fileDraft, record: null },
      {
        ...fileDraft,
        context: { url: "file:different-note", title: "Wrong file" },
      },
      {
        ...fileDraft,
        context: { url: "file:///private/note.md", title: "Absolute path" },
      },
    ])
      await expect(
        h.checkpoint(2, [invalid as RecoveryDraft]),
      ).rejects.toMatchObject({ code: "invalid" });
    expect(await h.list()).toMatchObject([{ sequence: 1 }]);
  });

  it("validates scope metadata without requiring complete Markdown while typing", async () => {
    const h = harness();
    const shared: RecoveryDraft = {
      scope: "shared",
      key: "domain-note",
      context: { origin: "https://example.test" },
      record: null,
      text: "```aic\nIncomplete typing",
    };
    const global: RecoveryDraft = {
      scope: "global",
      key: "global-note",
      context: {},
      record: null,
      text: "",
    };
    await h.checkpoint(1, [draft(), shared, global]);
    const invalidEntries: unknown[] = [
      { ...draft(), scope: "unknown" },
      { ...draft(), context: { url: "javascript:alert(1)", title: "Invalid" } },
      { ...shared, context: { origin: "https://example.test/path" } },
      { ...global, context: { url: "https://example.test/" } },
      { ...draft(), record: { id: "n", revision: 0, markdown: "old" } },
      { ...draft(), text: "x".repeat(512 * 1024 + 1) },
    ];
    for (const entry of invalidEntries)
      await expect(
        h.checkpoint(2, [entry as RecoveryDraft]),
      ).rejects.toMatchObject({ code: "invalid" });
    await expect(h.checkpoint(2, [draft(), draft()])).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      h.checkpoint(2, Array(51).fill(draft())),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(h.checkpoint(0)).rejects.toMatchObject({ code: "invalid" });
    await expect(
      h.store().checkpoint("other-source", CLIENT, 2, [draft()]),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      h.store().checkpoint(SOURCE, "bad:client", 2, [draft()]),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await h.list()).toMatchObject([
      { sequence: 1, entries: [draft(), shared, global] },
    ]);
  });

  it("reports one damaged snapshot without hiding or mutating another client's recoverable draft", async () => {
    const h = harness();
    await h.checkpoint(1);
    const data = h.local[RECOVERY_KEY] as Journal;
    data.snapshots[0]!.entries = { invalid: "keep this damaged snapshot" };
    const damaged = structuredClone(data.snapshots[0]);
    await h
      .store()
      .checkpoint(SOURCE, "unaffected-panel", 1, [draft("Still recoverable")]);
    expect(await h.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: CLIENT,
          unavailable: true,
          entries: [],
        }),
        expect.objectContaining({
          clientId: "unaffected-panel",
          entries: [draft("Still recoverable")],
        }),
      ]),
    );
    expect(
      (h.local[RECOVERY_KEY] as Journal).snapshots.find(
        (item) => item.clientId === CLIENT,
      ),
    ).toEqual(damaged);
  });

  it("refuses an invalid journal without replacing its existing bytes", async () => {
    const data = { version: 999, snapshots: [] };
    const h = harness({ [RECOVERY_KEY]: data });
    await expect(h.checkpoint(1)).rejects.toMatchObject({ code: "invalid" });
    expect(h.local[RECOVERY_KEY]).toEqual(data);
    expect(h.persistence.set).not.toHaveBeenCalled();
  });

  it("enforces per-client and aggregate budgets without losing earlier recovery", async () => {
    const h = harness();
    const large = (key: string): RecoveryDraft => ({
      ...draft("x".repeat(500 * 1024)),
      key,
      record: { id: key, revision: 1, markdown: "y".repeat(500 * 1024) },
    });
    await h.checkpoint(1, [large("first"), large("second")]);
    await expect(
      h.checkpoint(2, [large("first"), large("second"), large("third")]),
    ).rejects.toMatchObject({ code: "storage" });
    await h
      .store()
      .checkpoint(SOURCE, "second-panel", 1, [large("first"), large("second")]);
    await expect(
      h
        .store()
        .checkpoint(SOURCE, "third-panel", 1, [
          large("first"),
          large("second"),
        ]),
    ).rejects.toMatchObject({ code: "storage" });
    expect(await h.list()).toHaveLength(2);
    expect(
      (await h.list()).find((item) => item.clientId === CLIENT)?.sequence,
    ).toBe(1);
    await h.store().dismiss(SOURCE, "second-panel", 1);
    await expect(
      h
        .store()
        .checkpoint(SOURCE, "third-panel", 1, [
          large("first"),
          large("second"),
        ]),
    ).resolves.toEqual({ sequence: 1 });
  });

  it("retains sixteen active clients and allows a new one after explicitly dismissing a copy", async () => {
    const h = harness();
    for (let index = 0; index < 16; index++)
      await h
        .store()
        .checkpoint(SOURCE, `panel-${index}`, 1, [draft(`Draft ${index}`)]);
    await expect(
      h.store().checkpoint(SOURCE, "panel-16", 1, [draft()]),
    ).rejects.toMatchObject({ code: "storage" });
    expect(await h.list()).toHaveLength(16);
    await h.store().dismiss(SOURCE, "panel-0", 1);
    await h.store().checkpoint(SOURCE, "panel-16", 1, [draft()]);
    expect(await h.list()).toHaveLength(16);
    await h
      .store()
      .checkpoint(SOURCE, "panel-0", 1, [draft("Stale dismissed data")]);
    expect((await h.list()).some((item) => item.clientId === "panel-0")).toBe(
      false,
    );
  });
});
