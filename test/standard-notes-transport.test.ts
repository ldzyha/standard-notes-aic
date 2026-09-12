import { afterEach, describe, expect, it, vi } from "vitest";
import snApi from "sn-extension-api";
import { StandardNotesHost } from "../src/standard-notes-host";

type Message = { action: string; messageId: string; data: any };

afterEach(() => {
  // The pinned mediator has no public teardown. This test owns its initialization.
  const handler = (snApi as unknown as { messageHandler?: EventListener })
    .messageHandler;
  if (handler) {
    window.removeEventListener("message", handler);
    document.removeEventListener("message", handler);
  }
  vi.restoreAllMocks();
});

describe("pinned sn-extension-api transport contract", () => {
  it("receives metadata and acknowledged saves through the actual queued message bridge", async () => {
    const outbound: Message[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      outbound.push(message as Message);
    });
    const host = new StandardNotesHost(snApi);
    const snapshots = vi.fn();
    host.subscribe(snapshots);
    host.initialize();
    expect(outbound).toHaveLength(0);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          action: "component-registered",
          sessionKey: "test-session",
          data: {
            environment: "web",
            platform: "web",
            uuid: "test-component",
            activeThemeUrls: [],
          },
        },
      }),
    );
    const stream = outbound.find(
      (message) => message.action === "stream-context-item",
    )!;
    expect(stream).toBeDefined();
    const item = {
      uuid: "note-a",
      created_at: "2026-09-09T00:00:00.000Z",
      content_type: "Note",
      isMetadataUpdate: false,
      content: {
        text: "Original",
        preview_html: "<p>stale-private-preview</p>",
        title: "A",
        editorIdentifier: "aic",
        appData: { "org.standardnotes.sn": { locked: false } },
      },
    };
    const send = (original: Message, data: unknown) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { action: "reply", original, data },
        }),
      );
    send(stream, { item });
    expect(snapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "Original",
        locked: false,
        kind: "content",
      }),
    );
    const saving = host.save("note-a", 1, "Changed", "Changed");
    const save = outbound.find((message) => message.action === "save-items")!;
    expect(save.data.items[0]).toMatchObject({
      uuid: "note-a",
      content: { text: "Changed", preview_plain: "Changed", preview_html: "" },
    });
    expect(item.content.preview_html).toBe("<p>stale-private-preview</p>");
    expect(snApi.text).toBe("Original");
    send(stream, {
      item: {
        ...item,
        isMetadataUpdate: true,
        content: {
          ...item.content,
          appData: { "org.standardnotes.sn": { locked: true } },
        },
      },
    });
    expect(snapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "metadata", locked: true }),
    );
    send(save, {});
    await expect(saving).resolves.toEqual({
      id: "note-a",
      operationId: 1,
      status: "acknowledged",
    });
    send(stream, { item });
    const failing = host.save("note-a", 2, "Next", "Next");
    send(outbound.at(-1)!, { error: "save-error" });
    await expect(failing).resolves.toMatchObject({ status: "failed" });
    send(stream, { item: null });
    expect(snapshots).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: null, text: "", locked: true }),
    );
    await expect(host.save("note-a", 3, "Stale", "")).resolves.toMatchObject({
      status: "failed",
    });
    host.dispose();
    expect(host.currentNoteId).toBeNull();
    expect(host.locked).toBe(true);
  });
});
