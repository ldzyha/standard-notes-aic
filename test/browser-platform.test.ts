import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserApi } from "../src/browser/api";
import { initializeSidebar } from "../src/browser/platform";
import { createBrowserService } from "../src/browser/service";
import { FILE_SOURCE_KEY } from "../src/browser/markdown-storage";
import chromiumManifest from "../browser/manifest.json";

afterEach(() => vi.unstubAllGlobals());

function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => unknown>();
  return {
    addListener: vi.fn((listener: (...args: T) => unknown) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: (...args: T) => unknown) => {
      listeners.delete(listener);
    }),
    fire: (...args: T) => [...listeners].map((listener) => listener(...args)),
    count: () => listeners.size,
  };
}

function chromiumHarness() {
  const installed = event<[]>();
  const messages = event<[unknown, unknown, (reply: unknown) => void]>();
  const chrome = {
    runtime: {
      id: "aic-test",
      getURL: (path: string) => `chrome-extension://aic-test/${path}`,
      onMessage: messages,
      onInstalled: installed,
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        setAccessLevel: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        setAccessLevel: vi.fn(async () => {}),
      },
    },
    sidePanel: { setPanelBehavior: vi.fn(async () => {}) },
  };
  return { chrome, installed, messages };
}

describe("Chromium browser boundary", () => {
  it("uses Chrome's native API and ignores an unrelated browser namespace", async () => {
    const h = chromiumHarness();
    const unrelated = { runtime: { id: "other-extension" } };
    vi.stubGlobal("browser", unrelated);
    vi.stubGlobal("chrome", h.chrome);
    const api = getBrowserApi();
    expect(api).toBe(h.chrome);
    expect(await createBrowserService(api).handle({ type: "status" })).toEqual({
      state: "unselected",
      source: { kind: "unselected" },
    });
    expect(h.chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(h.chrome.storage.session.setAccessLevel).not.toHaveBeenCalled();
  });

  it("does not accept the browser namespace as a substitute for Chrome", () => {
    vi.stubGlobal("browser", chromiumHarness().chrome);
    vi.stubGlobal("chrome", undefined);
    expect(() => getBrowserApi()).toThrow("browser extension toolbar");
  });

  it("fails closed without trusted-only local storage", () => {
    const h = chromiumHarness();
    vi.stubGlobal("chrome", {
      ...h.chrome,
      storage: {
        ...h.chrome.storage,
        local: {
          get: h.chrome.storage.local.get,
          set: h.chrome.storage.local.set,
        },
      },
    });
    expect(() => getBrowserApi()).toThrow("Chromium 140 or newer");
  });

  it("works without in-memory unlock session storage", () => {
    const h = chromiumHarness();
    const chrome = {
      ...h.chrome,
      storage: { ...h.chrome.storage, session: undefined },
    };
    vi.stubGlobal("chrome", chrome);
    expect(getBrowserApi()).toBe(chrome);
  });

  it("does not silently continue when the trusted local storage restriction fails", async () => {
    for (const area of ["local"] as const) {
      const h = chromiumHarness();
      h.chrome.storage[area].setAccessLevel.mockRejectedValue(
        new Error("restriction unavailable"),
      );
      vi.stubGlobal("chrome", h.chrome);
      await expect(
        createBrowserService(getBrowserApi()).handle({ type: "status" }),
      ).rejects.toThrow("restriction unavailable");
      expect(h.chrome.storage.local.set).not.toHaveBeenCalled();
      expect(h.chrome.storage.session.set).not.toHaveBeenCalled();
    }
  });

  it("requires the Chromium side panel API", () => {
    const h = chromiumHarness();
    vi.stubGlobal("chrome", { ...h.chrome, sidePanel: undefined });
    expect(() => getBrowserApi()).toThrow("side panel API");
  });

  it("configures Chrome and Edge action behavior immediately and on install, then unregisters", () => {
    const h = chromiumHarness();
    vi.stubGlobal("chrome", h.chrome);
    const dispose = initializeSidebar(getBrowserApi());
    expect(h.chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
    h.installed.fire();
    expect(h.chrome.sidePanel.setPanelBehavior).toHaveBeenCalledTimes(2);
    dispose();
    expect(h.installed.count()).toBe(0);
  });

  it("accepts the exact editor in a side panel or normal tab and rejects spoofed, private, and framed senders", async () => {
    const h = chromiumHarness();
    vi.stubGlobal("chrome", h.chrome);
    vi.resetModules();
    await import("../src/browser/worker");
    const respond = vi.fn();
    const panel = h.chrome.runtime.getURL("browser/index.html");
    for (const sender of [
      { id: "foreign", url: panel },
      { id: h.chrome.runtime.id, url: "https://example.test/" },
      { id: h.chrome.runtime.id, url: `${panel}?extra=1` },
      { id: h.chrome.runtime.id, url: panel, tab: { id: 1 } },
      { id: h.chrome.runtime.id, url: panel, frameId: 2 },
      {
        id: h.chrome.runtime.id,
        url: panel,
        tab: { id: 1, windowId: 1, incognito: true },
      },
      {
        id: h.chrome.runtime.id,
        url: panel,
        tab: { id: 1, windowId: 1, url: "https://example.test/" },
      },
      {
        id: h.chrome.runtime.id,
        url: "https://example.test/",
        tab: { id: 1, windowId: 1, url: panel },
      },
      { id: "foreign", url: panel, tab: { id: 1, windowId: 1, url: panel } },
    ]) {
      expect(h.messages.fire({ type: "status" }, sender, respond)).toEqual([
        false,
      ]);
    }
    expect(respond).not.toHaveBeenCalled();
    expect(
      h.messages.fire(
        { type: "status" },
        { id: h.chrome.runtime.id, url: panel },
        respond,
      ),
    ).toEqual([true]);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        ok: true,
        value: { state: "unselected", source: { kind: "unselected" } },
      }),
    );
    respond.mockClear();
    expect(
      h.messages.fire(
        { type: "status" },
        {
          id: h.chrome.runtime.id,
          url: panel,
          frameId: 0,
          tab: { id: 1, windowId: 1, url: panel, incognito: false },
        },
        respond,
      ),
    ).toEqual([true]);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        ok: true,
        value: { state: "unselected", source: { kind: "unselected" } },
      }),
    );
  });

  it("retains source binding checks for the full-tab permission fallback", async () => {
    const h = chromiumHarness();
    h.chrome.storage.local.get.mockResolvedValue({
      [FILE_SOURCE_KEY]: {
        id: "browser-current",
        kind: "directory",
        name: "Current folder",
      },
    });
    vi.stubGlobal("chrome", h.chrome);
    vi.resetModules();
    await import("../src/browser/worker");
    const respond = vi.fn();
    const panel = h.chrome.runtime.getURL("browser/index.html");
    expect(
      h.messages.fire(
        { type: "load", sourceId: "browser-previous" },
        {
          id: h.chrome.runtime.id,
          url: panel,
          frameId: 0,
          tab: { id: 1, windowId: 1, url: panel, incognito: false },
        },
        respond,
      ),
    ).toEqual([true]);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, code: "source" }),
      ),
    );
    expect(h.chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("keeps the Chrome/Edge manifest narrow and disallows incognito", () => {
    expect(chromiumManifest.minimum_chrome_version).toBe("140");
    expect(chromiumManifest.incognito).toBe("not_allowed");
    expect(chromiumManifest.permissions).toContain("sidePanel");
    expect(chromiumManifest.permissions).toContain("clipboardRead");
    expect(chromiumManifest.permissions).toContain("clipboardWrite");
    expect(chromiumManifest.optional_host_permissions).toEqual([
      "http://*/*",
      "https://*/*",
    ]);
    expect(chromiumManifest.content_security_policy.extension_pages).toContain(
      "connect-src 'none'",
    );
    expect(chromiumManifest).not.toHaveProperty("content_scripts");
    expect(chromiumManifest).not.toHaveProperty("externally_connectable");
  });
});
