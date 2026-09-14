import { afterEach, describe, expect, it, vi } from "vitest";
import api from "sn-extension-api";
import { StandardNotesHost } from "../src/standard-notes-host";

type Message = {
  action: string;
  messageId: string;
  data: unknown;
  callback?: (reply: unknown) => void;
};
type PinnedTransport = {
  sentMessages: Message[];
  messageQueue: Message[];
  handleMessage(message: unknown): void;
  messageHandler?: EventListener;
  contentWindow?: Window;
  component: { sessionKey?: string; activeThemes: string[] };
};
const transport = api as unknown as PinnedTransport;
const hosts: StandardNotesHost[] = [];
function fixture(timeout = 15_000, register = true) {
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const host = new StandardNotesHost(api, timeout);
  hosts.push(host);
  host.initialize();
  if (register) {
    transport.handleMessage({
      action: "component-registered",
      sessionKey: "synthetic-session",
      data: {
        environment: "web",
        platform: "web",
        uuid: "synthetic-component",
        activeThemeUrls: [],
      },
    });
    stream("Initial body");
  }
  return host;
}
function stream(text: string) {
  const subscription = transport.sentMessages.find(
    (message) => message.action === "stream-context-item",
  )!;
  expect(subscription).toBeDefined();
  transport.handleMessage({
    action: "reply",
    original: { messageId: subscription.messageId },
    data: { item: { uuid: "synthetic-note", content: { text, appData: {} } } },
  });
}
function reply(message: Message) {
  transport.handleMessage({
    action: "reply",
    original: { messageId: message.messageId },
    data: {},
  });
}
function saves() {
  return transport.sentMessages.filter(
    (message) => message.action === "save-items",
  );
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  if (transport.messageHandler) {
    document.removeEventListener("message", transport.messageHandler, false);
    window.removeEventListener("message", transport.messageHandler, false);
  }
  transport.sentMessages.length = 0;
  transport.messageQueue.length = 0;
  transport.component.sessionKey = undefined;
  transport.contentWindow = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("pinned Standard Notes transport save ownership", () => {
  it("releases every acknowledged full-note message while retaining the context stream", async () => {
    const host = fixture();
    const baseline = transport.sentMessages.length;
    const snapshots: string[] = [];
    host.subscribe((snapshot) => snapshots.push(snapshot.text));
    for (let index = 0; index < 20; index++) {
      const text = `Synthetic version ${index}\n${"x".repeat(200_000)}`;
      const saving = host.save("synthetic-note", index, text, "Preview");
      const message = saves().at(-1)!;
      expect(message).toBeDefined();
      reply(message);
      expect(await saving).toMatchObject({ status: "acknowledged" });
    }
    expect(saves()).toHaveLength(0);
    expect(transport.sentMessages).toHaveLength(baseline);
    stream("Latest host content");
    expect(snapshots.at(-1)).toBe("Latest host content");
  });

  it("releases timed-out requests and ignores a late reply without removing a live stream", async () => {
    vi.useFakeTimers();
    const host = fixture(25);
    const baseline = transport.sentMessages.length;
    const saving = host.save(
      "synthetic-note",
      1,
      "Timed-out synthetic body",
      "Preview",
    );
    const staleMessage = saves()[0]!;
    await vi.advanceTimersByTimeAsync(25);
    expect(await saving).toMatchObject({ status: "failed" });
    expect(saves()).toHaveLength(0);
    reply(staleMessage);
    expect(transport.sentMessages).toHaveLength(baseline);
    stream("After timeout");
    expect(host.currentNoteId).toBe("synthetic-note");
  });

  it("disposes only its own pending saves, preserving other callers' messages", async () => {
    const host = fixture();
    const unrelated: Message = {
      action: "save-items",
      messageId: "unrelated-save",
      data: { items: ["another adapter's data"] },
      callback: () => {},
    };
    transport.sentMessages.push(unrelated);
    const saving = host.save(
      "synthetic-note",
      1,
      "Pending synthetic body",
      "Preview",
    );
    const ownMessage = saves().at(-1)!;
    host.dispose();
    expect(await saving).toMatchObject({ status: "failed" });
    expect(saves()).toEqual([unrelated]);
    reply(ownMessage);
    expect(saves()).toEqual([unrelated]);
    expect(
      transport.sentMessages.some(
        (message) => message.action === "stream-context-item",
      ),
    ).toBe(true);
  });

  it("removes a timed-out queued save so later registration cannot send stale note content", async () => {
    vi.useFakeTimers();
    const host = fixture(25);
    transport.component.sessionKey = undefined;
    const saving = host.save(
      "synthetic-note",
      1,
      "Queued synthetic body",
      "Preview",
    );
    expect(
      transport.messageQueue.filter(
        (message) => message.action === "save-items",
      ),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(25);
    expect(await saving).toMatchObject({ status: "failed" });
    expect(
      transport.messageQueue.filter(
        (message) => message.action === "save-items",
      ),
    ).toHaveLength(0);
    transport.handleMessage({
      action: "component-registered",
      sessionKey: "resumed-synthetic-session",
      data: {
        environment: "web",
        platform: "web",
        uuid: "synthetic-component",
        activeThemeUrls: [],
      },
    });
    expect(saves()).toHaveLength(0);
    stream("After resumed registration");
    expect(host.currentNoteId).toBe("synthetic-note");
  });
});
