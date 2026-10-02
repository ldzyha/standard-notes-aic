import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserApi } from "../src/browser/api";
import type { BrowserLibrary } from "../src/browser/library";
import { createBrowserService } from "../src/browser/service";
import type { BrowserScanStatus } from "../src/browser/markdown-storage";
import { markdownFixture } from "./helpers/browser-markdown-fixture";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(initial: Record<string, string>) {
  const files = markdownFixture(initial);
  const local: Record<string, unknown> = {};
  const api = {
    storage: {
      local: {
        get: async () => structuredClone(local),
        set: async (value: Record<string, unknown>) => {
          Object.assign(local, structuredClone(value));
        },
        setAccessLevel: async () => {},
      },
    },
  } as unknown as BrowserApi;
  const service = createBrowserService(api, files.bindings);
  return {
    files,
    local,
    send: (message: unknown) => service.handle(message),
    connect: () =>
      service.handle({
        type: "connect-source",
        bindingId: "browser-test",
        mode: "open",
      }),
    progress: (id?: string, after = 0) =>
      service.handle({
        type: "scan-status",
        id,
        after,
      }) as Promise<BrowserScanStatus>,
    load: (sourceId = "browser-test") =>
      service.handle({ type: "load", sourceId }) as Promise<BrowserLibrary>,
  };
}

function stallAfterFirstNote(h: ReturnType<typeof harness>) {
  const entered = deferred();
  const release = deferred();
  const late = h.files.file("late.md");
  late.getFile = vi.fn(late.getFile);
  h.files.root.values = async function* () {
    yield h.files.file("first.md");
    yield h.files.directory("assets");
    entered.resolve();
    await release.promise;
    yield late;
  };
  return { entered, release, late };
}

afterEach(() => vi.useRealTimers());

describe("responsive browser folder scans", () => {
  it("reports discovered and loaded notes before the opening operation finishes", async () => {
    const h = harness({
      "first.md": "Synthetic first content",
      "assets/item.txt": "asset",
      "late.md": "Synthetic late content",
    });
    const blocked = stallAfterFirstNote(h);
    let complete = false;
    const opening = h.connect().finally(() => {
      complete = true;
    });
    try {
      await blocked.entered.promise;
      const progress = await h.progress();
      expect(complete).toBe(false);
      expect(progress.scan).toMatchObject({
        sourceId: "browser-test",
        found: 1,
        loaded: 1,
      });
      expect(progress.scan!.inspected).toBeGreaterThanOrEqual(3);
      expect(progress.scan!.revision).toBeGreaterThan(0);
      expect(progress.notes).toHaveLength(1);
      expect(JSON.stringify(progress.notes)).not.toContain(
        "Synthetic first content",
      );
      const unchanged = await h.progress(progress.scan!.id, progress.next);
      expect(unchanged.notes).toEqual([]);
    } finally {
      blocked.release.resolve();
      await opening;
    }
    expect((await h.progress()).scan).toMatchObject({
      phase: "complete",
      found: 2,
      loaded: 2,
    });
    expect((await h.load()).notes).toHaveLength(2);
  });

  it("cancels a pending native directory iterator promptly and preserves loaded notes", async () => {
    const h = harness({
      "first.md": "Kept Markdown",
      "assets/item.txt": "asset",
      "late.md": "Must not load",
    });
    const blocked = stallAfterFirstNote(h);
    const opening = h.connect();
    await blocked.entered.promise;
    const before = await h.progress();
    try {
      await h.send({ type: "cancel-scan", id: before.scan!.id });
      await opening;
      expect((await h.progress()).scan).toMatchObject({
        phase: "cancelled",
        loaded: 1,
      });
      expect((await h.load()).notes).toMatchObject([
        { filePath: "first.md", markdown: "Kept Markdown" },
      ]);
      const cancelled = await h.progress();
      blocked.release.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(blocked.late.getFile).not.toHaveBeenCalled();
      expect(await h.progress()).toEqual(cancelled);
      expect((await h.load()).notes).toHaveLength(1);
    } finally {
      blocked.release.resolve();
    }
  });

  it("ignores cancelled generation results after another source is selected", async () => {
    const h = harness({
      "first.md": "First folder",
      "assets/item.txt": "asset",
      "late.md": "Late old folder",
    });
    const other = markdownFixture({ "other.md": "New selected folder" });
    h.files.handles.set("browser-other", other.root);
    const blocked = stallAfterFirstNote(h);
    const opening = h.connect();
    await blocked.entered.promise;
    const firstScan = (await h.progress()).scan!;
    await h.send({ type: "cancel-scan", id: firstScan.id });
    await opening;
    await h.send({
      type: "connect-source",
      sourceId: "browser-test",
      bindingId: "browser-other",
      mode: "open",
    });
    const nextScan = await h.progress();
    expect(nextScan.scan!.id).not.toBe(firstScan.id);
    expect(nextScan.scan).toMatchObject({
      sourceId: "browser-other",
      phase: "complete",
    });
    blocked.release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.send({ type: "cancel-scan", id: firstScan.id });
    expect(await h.progress()).toEqual(nextScan);
    expect((await h.load("browser-other")).notes).toMatchObject([
      { filePath: "other.md", markdown: "New selected folder" },
    ]);
    expect(blocked.late.getFile).not.toHaveBeenCalled();
  });

  it("loads the scanned library without rescanning until an explicit refresh is requested", async () => {
    const h = harness({ "first.md": "Original" });
    await h.connect();
    const scans = h.files.state.scans;
    await h.load();
    await h.send({ type: "status", sourceId: "browser-test" });
    await h.load();
    expect(h.files.state.scans).toBe(scans);
    h.files.put("second.md", "Added externally");
    expect((await h.load()).notes).toHaveLength(1);
    await h.send({ type: "refresh-files", sourceId: "browser-test" });
    expect(h.files.state.scans).toBeGreaterThan(scans);
    expect((await h.load()).notes.map((note) => note.filePath).sort()).toEqual([
      "first.md",
      "second.md",
    ]);
  });

  it("keeps the current source when a candidate scan is cancelled before loading any note", async () => {
    const h = harness({ "old.md": "Current source" });
    await h.connect();
    const candidate = markdownFixture({ "pending.md": "Candidate source" });
    const handle = candidate.file("pending.md");
    const eventual = await handle.getFile();
    const metadata = deferred<typeof eventual>();
    const entered = deferred();
    handle.getFile = async () => {
      entered.resolve();
      return metadata.promise;
    };
    candidate.root.values = async function* () {
      yield handle;
    };
    h.files.handles.set("browser-candidate", candidate.root);
    const opening = h.send({
      type: "connect-source",
      sourceId: "browser-test",
      bindingId: "browser-candidate",
      mode: "open",
    });
    await entered.promise;
    const progress = await h.progress();
    expect(progress.scan).toMatchObject({
      sourceId: "browser-candidate",
      found: 1,
      loaded: 0,
    });
    await h.send({ type: "cancel-scan", id: progress.scan!.id });
    await opening;
    expect(await h.send({ type: "status" })).toMatchObject({
      source: { id: "browser-test" },
    });
    expect((await h.load()).notes).toMatchObject([
      { filePath: "old.md", markdown: "Current source" },
    ]);
    metadata.resolve(eventual);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await h.load()).notes).toHaveLength(1);
    expect(await h.send({ type: "status" })).toMatchObject({
      source: { id: "browser-test" },
    });
  });

  it("retains unvisited cached notes when an explicit refresh is cancelled", async () => {
    const h = harness({
      "first.md": "Old first",
      "assets/item.txt": "asset",
      "late.md": "Known last note",
    });
    await h.connect();
    h.files.put("first.md", "Changed externally");
    const blocked = stallAfterFirstNote(h);
    const refreshing = h.send({
      type: "refresh-files",
      sourceId: "browser-test",
    });
    await blocked.entered.promise;
    const progress = await h.progress();
    await h.send({ type: "cancel-scan", id: progress.scan!.id });
    await refreshing;
    blocked.release.resolve();
    const notes = (await h.load()).notes;
    expect(notes.find((note) => note.filePath === "first.md")?.markdown).toBe(
      "Changed externally",
    );
    expect(notes.find((note) => note.filePath === "late.md")?.markdown).toBe(
      "Known last note",
    );
    expect(notes).toHaveLength(2);
  });

  it("does not overwrite an external association for an unvisited note after cancelling refresh", async () => {
    const h = harness({
      "first.md": "First note",
      "assets/item.txt": "asset",
      "late.md": "Unvisited note",
    });
    await h.connect();
    const first = (await h.load()).notes.find(
      (note) => note.filePath === "first.md",
    )!;
    await h.send({
      type: "save",
      sourceId: "browser-test",
      id: first.id,
      revision: first.revision,
      markdown: first.markdown,
    });
    const index = JSON.parse(h.files.text(".aic/links.json")!) as {
      entries: { path: string; url?: string }[];
    };
    index.entries.find((entry) => entry.path === "late.md")!.url =
      "https://example.test/externally-linked";
    h.files.put(".aic/links.json", JSON.stringify(index));
    const blocked = stallAfterFirstNote(h);
    const refreshing = h.send({
      type: "refresh-files",
      sourceId: "browser-test",
    });
    await blocked.entered.promise;
    await h.send({ type: "cancel-scan", id: (await h.progress()).scan!.id });
    await refreshing;
    blocked.release.resolve();
    const current = (await h.load()).notes.find(
      (note) => note.filePath === "first.md",
    )!;
    await h.send({
      type: "save",
      sourceId: "browser-test",
      id: current.id,
      revision: current.revision,
      markdown: "Edited after scan cancellation",
    });
    const savedIndex = JSON.parse(
      h.files.text(".aic/links.json")!,
    ) as typeof index;
    expect(
      savedIndex.entries.find((entry) => entry.path === "late.md")?.url,
    ).toBe("https://example.test/externally-linked");
    expect(h.files.text("late.md")).toBe("Unvisited note");
  });

  it("does not restore previously cached notes excluded by newly read ignore rules", async () => {
    const h = harness({
      "first.md": "Included",
      "assets/item.txt": "asset",
      "late.md": "Now ignored",
    });
    await h.connect();
    h.files.put(".ignore", "late.md\n");
    const blocked = stallAfterFirstNote(h);
    const refreshing = h.send({
      type: "refresh-files",
      sourceId: "browser-test",
    });
    await blocked.entered.promise;
    await h.send({ type: "cancel-scan", id: (await h.progress()).scan!.id });
    await refreshing;
    blocked.release.resolve();
    expect((await h.load()).notes.map((note) => note.filePath)).toEqual([
      "first.md",
    ]);
    expect(h.files.text("late.md")).toBe("Now ignored");
  });

  it("times out a stalled native file read and ignores its late result while retaining other notes", async () => {
    vi.useFakeTimers();
    const h = harness({
      "first.md": "Already loaded",
      "slow.md": "Late slow content",
      "good.md": "Readable content",
    });
    const slow = h.files.file("slow.md");
    const eventual = await slow.getFile();
    const metadata = deferred<typeof eventual>();
    const entered = deferred();
    slow.getFile = async () => {
      entered.resolve();
      return metadata.promise;
    };
    h.files.root.values = async function* () {
      yield h.files.file("first.md");
      yield slow;
      yield h.files.file("good.md");
    };
    const opening = h.connect();
    await entered.promise;
    expect((await h.progress()).scan).toMatchObject({
      phase: "reading",
      path: "slow.md",
      found: 2,
      loaded: 1,
    });
    await vi.advanceTimersByTimeAsync(30_001);
    await opening;
    const finished = await h.progress();
    expect(finished.scan).toMatchObject({
      phase: "complete",
      found: 3,
      loaded: 2,
    });
    expect((await h.load()).notes).toMatchObject([
      { filePath: "first.md", markdown: "Already loaded" },
      { filePath: "good.md", markdown: "Readable content" },
    ]);
    const status = (await h.send({ type: "status" })) as { warnings: string[] };
    expect(status.warnings.join(" ")).toContain("slow.md");
    expect(status.warnings.join(" ")).toContain("timed out");
    metadata.resolve(eventual);
    await vi.advanceTimersByTimeAsync(1);
    expect(await h.progress()).toEqual(finished);
    expect((await h.load()).notes).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
