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
