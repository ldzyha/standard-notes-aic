import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function acquireFixture() {
  const postMessage = vi.fn();
  const acquire = vi.fn(() => ({ postMessage }));
  Object.defineProperty(window, "acquireVsCodeApi", {
    configurable: true,
    value: acquire,
  });
  return { acquire, postMessage };
}
function reply(requestId: string, value: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", { data: { requestId, ...value } }),
  );
}

let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  Reflect.deleteProperty(window, "acquireVsCodeApi");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ciphertext-only VS Code source bridge", () => {
  it("returns null in a normal browser", async () => {
    const { getVsCodeSource } = await import("../src/pwa/vscode-host");
    expect(getVsCodeSource()).toBeNull();
  });

  it("acquires one host API and correlates concurrent reads", async () => {
    const fixture = acquireFixture();
    const { getVsCodeSource } = await import("../src/pwa/vscode-host");
    const source = getVsCodeSource()!;
    cleanup = () => source.dispose();
    expect(getVsCodeSource()).toBe(source);
    expect(fixture.acquire).toHaveBeenCalledOnce();
    const first = source.read();
    const second = source.read();
    const [a, b] = fixture.postMessage.mock.calls.map(([message]) => message);
    expect(a.type).toBe("portable.read");
    expect(a.requestId).not.toBe(b.requestId);
    reply("unknown", { ok: true, text: "unrelated" });
    reply(b.requestId, { ok: true, text: "ciphertext two" });
    reply(a.requestId, { ok: true, text: "ciphertext one" });
    await expect(first).resolves.toBe("ciphertext one");
    await expect(second).resolves.toBe("ciphertext two");
  });

  it("transmits only ciphertext and expected ciphertext then checks the saved acknowledgment", async () => {
    const fixture = acquireFixture();
    const { getVsCodeSource } = await import("../src/pwa/vscode-host");
    const source = getVsCodeSource()!;
    cleanup = () => source.dispose();
    const pending = source.write("sealed-next", "sealed-before");
    const request = fixture.postMessage.mock.calls[0]![0];
    expect(Object.keys(request).sort()).toEqual([
      "expected",
      "requestId",
      "text",
      "type",
    ]);
    expect(request).toMatchObject({
      type: "portable.write",
      text: "sealed-next",
      expected: "sealed-before",
    });
    reply(request.requestId, { ok: true, text: "sealed-next" });
    await expect(pending).resolves.toBeUndefined();
    const mismatched = source.write("sealed-newer", "sealed-next");
    reply(fixture.postMessage.mock.calls[1]![0].requestId, {
      ok: true,
      text: "different",
    });
    await expect(mismatched).rejects.toThrow("changed while saving");
  });

  it("ignores malformed replies and reports a correlated host failure", async () => {
    const fixture = acquireFixture();
    const { getVsCodeSource } = await import("../src/pwa/vscode-host");
    const source = getVsCodeSource()!;
    cleanup = () => source.dispose();
    const pending = source.read();
    const id = fixture.postMessage.mock.calls[0]![0].requestId;
    reply(id, { ok: "yes", text: "bad" });
    reply(id, { ok: true, text: { unsafe: true } });
    reply(id, { ok: false, error: "The encrypted file changed elsewhere." });
    await expect(pending).rejects.toThrow("changed elsewhere");
  });

  it("reports external change signals and unsubscribes on disposal", async () => {
    acquireFixture();
    const { getVsCodeSource } = await import("../src/pwa/vscode-host");
    const source = getVsCodeSource()!;
    cleanup = () => source.dispose();
    const listener = vi.fn();
    const unsubscribe = source.onDidChange(listener);
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "portable.changed" } }),
    );
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "portable.changed" } }),
    );
    expect(listener).toHaveBeenCalledOnce();
    source.dispose();
    await expect(source.read()).rejects.toThrow("closed");
  });

  it("bounds the transport, times out unanswered requests and rejects pending work on disposal", async () => {
    vi.useFakeTimers();
    const fixture = acquireFixture();
    const { getVsCodeSource, MAX_VSCODE_CIPHERTEXT_BYTES } =
      await import("../src/pwa/vscode-host");
    const source = getVsCodeSource()!;
    cleanup = () => source.dispose();
    await expect(
      source.write("a".repeat(MAX_VSCODE_CIPHERTEXT_BYTES + 1), null),
    ).rejects.toThrow("9 MiB");
    expect(fixture.postMessage).not.toHaveBeenCalled();
    const timed = expect(source.read()).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30000);
    await timed;
    const disposed = expect(source.read()).rejects.toThrow("closed");
    source.dispose();
    await disposed;
  });
});
