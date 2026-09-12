import { afterEach, describe, expect, it, vi } from "vitest";
import { StandardNotesHost } from "../src/standard-notes-host";

function harness() {
  type Callback = (reply: unknown) => void;
  let stream: Callback | undefined;
  const saves: { data: Record<string, unknown>; callback?: Callback }[] = [];
  const api = {
    initialize: vi.fn(() =>
      api.postMessage("stream-context-item", {}, () => {}),
    ),
    postMessage(
      action: string,
      data: Record<string, unknown>,
      callback?: Callback,
    ) {
      if (action === "stream-context-item") stream = callback;
      else saves.push({ data, callback });
    },
  };
  const host = new StandardNotesHost(api, 100);
  host.initialize();
  return {
    api,
    host,
    saves,
    reply(value: unknown) {
      stream?.(value);
    },
    stream(id: string, text = "Original", locked = false, metadata = false) {
      const item = {
        uuid: id,
        created_at: "2026-08-20T10:00:00.000Z",
        isMetadataUpdate: metadata,
        content: {
          title: "documentation.md",
          text,
          appData: { "org.standardnotes.sn": { locked } },
        },
      };
      stream?.({ item });
      return item;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("Standard Notes host adapter", () => {
  it("invalidates a removed context and blocks saves to its previous UUID", async () => {
    const { host, stream, reply, saves } = harness();
    const listener = vi.fn();
    host.subscribe(listener);
    stream("note-a");
    reply({ item: null });
    expect(host.currentNoteId).toBeNull();
    expect(host.locked).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: null, text: "", locked: true }),
    );
    await expect(host.save("note-a", 1, "Stale", "")).resolves.toMatchObject({
      status: "failed",
    });
    expect(saves).toHaveLength(0);
    host.dispose();
  });

  it("retains omitted fields through partial metadata without crossing identities", async () => {
    const { host, stream, reply, saves } = harness();
    const listener = vi.fn();
    host.subscribe(listener);
    stream("note-a", "Original", true);
    reply({
      item: {
        uuid: "note-a",
        isMetadataUpdate: true,
        content: { title: "Renamed" },
      },
    });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "Original",
        fileName: "Renamed",
        locked: true,
        createdAt: "2026-08-20T10:00:00.000Z",
      }),
    );
    reply({
      item: {
        uuid: "note-a",
        isMetadataUpdate: true,
        content: { appData: { "org.standardnotes.sn": { locked: false } } },
      },
    });
    const result = host.save("note-a", 1, "Changed", "Preview");
    expect(saves[0]!.data).toMatchObject({
      items: [{ content: { title: "Renamed", text: "Changed" } }],
    });
    saves[0]!.callback?.({});
    await expect(result).resolves.toMatchObject({ status: "acknowledged" });
    reply({
      item: { uuid: "note-b", isMetadataUpdate: true, content: { title: "B" } },
    });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "note-b",
        text: "",
        fileName: "B",
        createdAt: null,
        locked: true,
      }),
    );
    await expect(
      host.save("note-b", 2, "Unknown content", ""),
    ).resolves.toMatchObject({ status: "failed" });
    host.dispose();
  });
  it("publishes metadata independently and waits for positive local host acknowledgement", async () => {
    const { api, host, saves, stream } = harness();
    const listener = vi.fn();
    host.subscribe(listener);
    const original = stream("note-a");
    expect(api.initialize).toHaveBeenCalledWith({ debounceSave: 0 });
    expect(listener).toHaveBeenLastCalledWith({
      id: "note-a",
      text: "Original",
      locked: false,
      fileName: "documentation.md",
      createdAt: "2026-08-20T10:00:00.000Z",
      kind: "content",
    });
    const result = host.save("note-a", 1, "Changed", "Preview");
    const settled = vi.fn();
    void result.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(original.content.text).toBe("Original");
    expect(saves[0]!.data).toMatchObject({
      items: [
        {
          uuid: "note-a",
          content: { text: "Changed", preview_plain: "Preview" },
        },
      ],
    });
    stream("note-b");
    saves[0]!.callback?.({});
    await expect(result).resolves.toEqual({
      id: "note-a",
      operationId: 1,
      status: "acknowledged",
    });
    await expect(host.save("note-a", 2, "Wrong", "")).resolves.toMatchObject({
      status: "failed",
    });
    stream("note-b", "Original", true, true);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "metadata", locked: true }),
    );
    expect(host.locked).toBe(true);
    await expect(host.save("note-b", 3, "Wrong", "")).resolves.toMatchObject({
      status: "failed",
    });
    expect(saves).toHaveLength(1);
    host.dispose();
  });

  it.each([
    { "org.standardnotes.sn": { pinned: true } },
    { "org.standardnotes.sn": {} },
    { "org.standardnotes.sn": null },
    { "org.standardnotes.sn": { locked: null } },
    { "org.standardnotes.sn": { locked: 0 } },
    { "org.standardnotes.sn": { locked: "false" } },
    { "org.standardnotes.sn": { locked: undefined } },
  ])(
    "preserves a known lock through partial or invalid namespace updates: %j",
    async (appData) => {
      const { host, stream, reply, saves } = harness();
      stream("note-a", "Original", true);
      reply({
        item: { uuid: "note-a", isMetadataUpdate: true, content: { appData } },
      });
      expect(host.locked).toBe(true);
      expect(host.captureSaveTarget("note-a")).toBeNull();
      await expect(
        host.save("note-a", 1, "Blocked", ""),
      ).resolves.toMatchObject({ status: "failed" });
      expect(saves).toHaveLength(0);
      host.dispose();
    },
  );

  it("merges namespace properties and allows only an explicit valid unlock of known content", async () => {
    const { host, reply, saves } = harness();
    const original = {
      uuid: "note-a",
      content: {
        title: "Original",
        text: "Original",
        appData: {
          "org.standardnotes.sn": { locked: true, pinned: true },
          "org.example.editor": { theme: "dark" },
        },
      },
    };
    reply({ item: original });
    reply({
      item: {
        uuid: "note-a",
        isMetadataUpdate: true,
        content: {
          appData: {
            "org.standardnotes.sn": { archived: false },
            "org.example.editor": { fontSize: 16 },
          },
        },
      },
    });
    expect(host.locked).toBe(true);
    reply({
      item: {
        uuid: "note-a",
        isMetadataUpdate: true,
        content: {
          appData: {
            "org.standardnotes.sn": { locked: false },
          },
        },
      },
    });
    expect(host.locked).toBe(false);
    const pending = host.save("note-a", 2, "Changed", "Preview");
    expect(saves[0]!.data).toMatchObject({
      items: [
        {
          content: {
            appData: {
              "org.standardnotes.sn": {
                locked: false,
                pinned: true,
                archived: false,
              },
              "org.example.editor": { theme: "dark", fontSize: 16 },
            },
          },
        },
      ],
    });
    expect(original.content.appData["org.standardnotes.sn"]).toEqual({
      locked: true,
      pinned: true,
    });
    saves[0]!.callback?.({});
    await expect(pending).resolves.toMatchObject({ status: "acknowledged" });
    host.dispose();
  });

  it("keeps an unknown new UUID locked across further partial updates until its content arrives", () => {
    const { host, stream, reply } = harness();
    stream("note-a", "Content A", false);
    reply({
      item: {
        uuid: "note-b",
        isMetadataUpdate: true,
        content: {
          appData: {
            "org.standardnotes.sn": { locked: false },
          },
        },
      },
    });
    expect(host.locked).toBe(true);
    reply({
      item: {
        uuid: "note-b",
        isMetadataUpdate: true,
        content: {
          appData: {
            "org.standardnotes.sn": { pinned: true },
          },
        },
      },
    });
    expect(host.locked).toBe(true);
    reply({
      item: {
        uuid: "note-b",
        isMetadataUpdate: true,
        content: {
          appData: {
            "org.standardnotes.sn": { locked: false },
          },
        },
      },
    });
    expect(host.locked).toBe(true);
    expect(host.captureSaveTarget("note-b")).toBeNull();
    stream("note-b", "Content B", false);
    expect(host.locked).toBe(false);
    host.dispose();
  });

  it("never revives a previously invalidated queued target after partial metadata or explicit unlock", async () => {
    const { host, stream, reply, saves } = harness();
    stream("note-a", "Original", false);
    const target = host.captureSaveTarget("note-a")!;
    stream("note-a", "Original", true, true);
    reply({
      item: {
        uuid: "note-a",
        isMetadataUpdate: true,
        content: {
          appData: {
            "org.standardnotes.sn": { pinned: true },
          },
        },
      },
    });
    expect(host.locked).toBe(true);
    await expect(target.save(1, "Blocked", "")).resolves.toMatchObject({
      status: "failed",
    });
    reply({
      item: {
        uuid: "note-a",
        isMetadataUpdate: true,
        content: {
          appData: {
            "org.standardnotes.sn": { locked: false },
          },
        },
      },
    });
    expect(host.locked).toBe(false);
    await expect(target.save(2, "Still blocked", "")).resolves.toMatchObject({
      status: "failed",
    });
    expect(saves).toHaveLength(0);
    const fresh = host.captureSaveTarget("note-a")!;
    expect(fresh).not.toBeNull();
    fresh.dispose();
    target.dispose();
    host.dispose();
  });

  it("captures the old UUID before a switch and never retargets queued saves", async () => {
    const { host, stream, saves, reply } = harness();
    stream("note-a", "Original A");
    const before = vi.fn((previousId: string, nextId: string | null) => {
      expect(previousId).toBe("note-a");
      expect(nextId).toBe("note-b");
      expect(host.currentNoteId).toBe("note-a");
    });
    host.onBeforeContextChange(before);
    const target = host.captureSaveTarget("note-a")!;
    const first = target.save(1, "First A", "A preview");
    reply({
      item: {
        uuid: "note-a",
        isMetadataUpdate: true,
        content: {
          title: "Renamed A",
          appData: { "org.example.editor": { theme: "dark" } },
        },
      },
    });
    expect(host.locked).toBe(false);
    stream("note-b", "Original B");
    expect(before).toHaveBeenCalledTimes(1);
    saves[0]!.callback?.({});
    await expect(first).resolves.toMatchObject({
      id: "note-a",
      status: "acknowledged",
    });
    const queued = target.save(2, "Latest A", "Latest preview");
    expect(saves[1]!.data).toMatchObject({
      items: [
        {
          uuid: "note-a",
          content: {
            title: "Renamed A",
            text: "Latest A",
            appData: { "org.example.editor": { theme: "dark" } },
          },
        },
      ],
    });
    expect(host.currentNoteId).toBe("note-b");
    saves[1]!.callback?.({});
    await expect(queued).resolves.toMatchObject({
      id: "note-a",
      status: "acknowledged",
    });
    target.dispose();
    await expect(target.save(3, "Wrong", "")).resolves.toMatchObject({
      status: "failed",
    });
    expect(saves).toHaveLength(2);
    host.dispose();
  });

  it("invalidates captured save targets on a same-note lock transition", async () => {
    const { host, stream, saves } = harness();
    stream("note-a", "Original A");
    const target = host.captureSaveTarget("note-a")!;
    stream("note-a", "Original A", true, true);
    await expect(target.save(1, "Blocked", "")).resolves.toMatchObject({
      status: "failed",
    });
    expect(saves).toHaveLength(0);
    target.dispose();
    host.dispose();
  });

  it.each([{ error: "save-error" }, { accepted: false }, null, undefined, []])(
    "rejects negative or unknown save replies: %j",
    async (reply) => {
      const { host, saves, stream } = harness();
      stream("note-a");
      const result = host.save("note-a", 1, "Changed", "");
      saves[0]!.callback?.(reply);
      await expect(result).resolves.toMatchObject({ status: "failed" });
      host.dispose();
    },
  );

  it("times out unanswered saves and ignores late replies", async () => {
    vi.useFakeTimers();
    const { host, saves, stream } = harness();
    stream("note-a");
    const result = host.save("note-a", 1, "Changed", "");
    await vi.advanceTimersByTimeAsync(101);
    await expect(result).resolves.toMatchObject({ status: "failed" });
    saves[0]!.callback?.({});
    await expect(result).resolves.toMatchObject({ status: "failed" });
    const pending = host.save("note-a", 2, "Changed again", "");
    host.dispose();
    await expect(pending).resolves.toMatchObject({ status: "failed" });
  });
});
