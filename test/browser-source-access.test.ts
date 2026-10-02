import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserSourceAccess,
  chooseBrowserSource,
  type BrowserSourceBindings,
} from "../src/browser/markdown-storage";
import { markdownFixture } from "./helpers/browser-markdown-fixture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe("visible panel filesystem access", () => {
  it("requires a warmed handle before Continue and never consumes the click on an asynchronous lookup", async () => {
    const files = markdownFixture();
    const loading = deferred<unknown>();
    const bindings = { ...files.bindings, read: vi.fn(() => loading.promise) };
    const request = vi.spyOn(files.root, "requestPermission");
    const access = new BrowserSourceAccess(bindings);
    await expect(access.reconnect("browser-test")).rejects.toMatchObject({
      code: "source",
    });
    expect(bindings.read).not.toHaveBeenCalled();
    const warming = access.warm("browser-test");
    await expect(access.reconnect("browser-test")).rejects.toMatchObject({
      code: "source",
    });
    expect(access.has("browser-test")).toBe(false);
    expect(request).not.toHaveBeenCalled();
    loading.resolve(files.root);
    await warming;
    expect(access.has("browser-test")).toBe(true);
    const restoring = access.reconnect("browser-test");
    expect(request).toHaveBeenCalledExactlyOnceWith({ mode: "readwrite" });
    await restoring;
    access.clear();
    expect(access.has("browser-test")).toBe(false);
  });
  it("retains a live handle across worker/persistence lookups and requests permission synchronously", async () => {
    const files = markdownFixture({ "note.md": "Original" });
    const request = vi.spyOn(files.root, "requestPermission");
    const query = vi.spyOn(files.root, "queryPermission");
    const bindings = { ...files.bindings, read: vi.fn(files.bindings.read) };
    const access = new BrowserSourceAccess(bindings);
    await access.warm("browser-test");
    access.select("browser-test");
    files.handles.clear();
    files.state.allowed = false;
    const restored = access.reconnect("browser-test");
    // The request runs inside the trusted click, before the first await.
    expect(request).toHaveBeenCalledExactlyOnceWith({ mode: "readwrite" });
    expect(query).not.toHaveBeenCalled();
    expect(bindings.read).toHaveBeenCalledTimes(1);
    await restored;
    expect(files.state.allowed).toBe(true);
    expect(files.state.scans).toBe(0);
  });

  it("does not revive a retained handle after disposal while a warm lookup is pending", async () => {
    const files = markdownFixture();
    const loading = deferred<unknown>();
    const bindings: BrowserSourceBindings = {
      read: vi
        .fn()
        .mockReturnValueOnce(loading.promise)
        .mockResolvedValue(null),
      write: files.bindings.write,
    };
    const request = vi.spyOn(files.root, "requestPermission");
    const access = new BrowserSourceAccess(bindings);
    const warming = access.warm("browser-test");
    access.clear();
    loading.resolve(files.root);
    await warming;
    await expect(access.reconnect("browser-test")).rejects.toMatchObject({
      code: "source",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("deduplicates overlapping status warms and a premature selection cannot cancel the live warm", async () => {
    const files = markdownFixture();
    const loading = deferred<unknown>();
    const bindings = { ...files.bindings, read: vi.fn(() => loading.promise) };
    const access = new BrowserSourceAccess(bindings);
    expect(access.has("browser-test")).toBe(false);
    const first = access.warm("browser-test");
    const second = access.warm("browser-test");
    access.select("browser-test");
    loading.resolve(files.root);
    await Promise.all([first, second]);
    expect(access.has("browser-test")).toBe(true);
    access.select("browser-test");
    const request = vi.spyOn(files.root, "requestPermission");
    const reconnect = access.reconnect("browser-test");
    expect(request).toHaveBeenCalledTimes(1);
    expect(bindings.read).toHaveBeenCalledTimes(1);
    await reconnect;
  });

  it("keeps old and picked source handles until the new selection commits", async () => {
    const files = markdownFixture();
    const other = markdownFixture();
    const access = new BrowserSourceAccess(files.bindings);
    await access.warm("browser-test");
    access.select("browser-test");
    access.retain("browser-candidate", other.root);
    files.handles.clear();
    const originalRequest = vi.spyOn(files.root, "requestPermission");
    const candidateRequest = vi.spyOn(other.root, "requestPermission");
    await access.reconnect("browser-test");
    expect(originalRequest).toHaveBeenCalledTimes(1);
    access.select("browser-candidate");
    await access.reconnect("browser-candidate");
    expect(candidateRequest).toHaveBeenCalledTimes(1);
    await expect(access.reconnect("browser-test")).rejects.toMatchObject({
      code: "source",
    });
  });

  it("retains the picker handle before returning the new source id", async () => {
    const files = markdownFixture();
    vi.stubGlobal("window", { showDirectoryPicker: async () => files.root });
    const access = new BrowserSourceAccess(files.bindings);
    const id = await chooseBrowserSource("folder", files.bindings, access);
    expect(id).toMatch(/^browser-/u);
    files.handles.clear();
    const request = vi.spyOn(files.root, "requestPermission");
    const reconnect = access.reconnect(id!);
    expect(request).toHaveBeenCalledTimes(1);
    await reconnect;
  });

  it("preserves denial as a permission error without reading or changing a file", async () => {
    const files = markdownFixture({ "note.md": "Original" });
    const handle = files.file("note.md");
    handle.requestPermission = vi.fn(async () => "denied" as const);
    handle.getFile = vi.fn(handle.getFile);
    const access = new BrowserSourceAccess(files.bindings);
    access.retain("browser-test", handle);
    await expect(access.reconnect("browser-test")).rejects.toMatchObject({
      code: "permission",
    });
    expect(handle.getFile).not.toHaveBeenCalled();
    expect(files.text("note.md")).toBe("Original");
  });
});
