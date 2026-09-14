import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserApi } from "../src/browser/api";
import { initializeSidebar } from "../src/browser/platform";
import { createBrowserService } from "../src/browser/service";
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
      state: "setup",
    });
    expect(h.chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(h.chrome.storage.session.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
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

  it("fails closed without session storage or its trusted-only restriction", () => {
    const h = chromiumHarness();
    vi.stubGlobal("chrome", {
      ...h.chrome,
      storage: { ...h.chrome.storage, session: undefined },
    });
    expect(() => getBrowserApi()).toThrow("in-memory session storage");
    vi.stubGlobal("chrome", {
      ...h.chrome,
      storage: {
        ...h.chrome.storage,
        session: {
          get: h.chrome.storage.session.get,
          set: h.chrome.storage.session.set,
          remove: h.chrome.storage.session.remove,
        },
      },
    });
    expect(() => getBrowserApi()).toThrow("Chromium 140 or newer");
  });

  it("does not silently continue when either storage restriction fails", async () => {
    for (const area of ["local", "session"] as const) {
      const h = chromiumHarness();
      h.chrome.storage[area].setAccessLevel.mockRejectedValue(
        new Error("restriction unavailable"),
      );
      vi.stubGlobal("chrome", h.chrome);
      await expect(
        createBrowserService(getBrowserApi()).handle({ type: "status" }),
      ).rejects.toThrow("browser could not store this change");
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

  it("accepts only an exact internal panel sender in the worker", async () => {
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
        value: { state: "setup" },
      }),
    );
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
