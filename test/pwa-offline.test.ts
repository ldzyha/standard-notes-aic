// @ts-expect-error Node runtime helpers are outside the browser-focused type declarations.
import { runInNewContext } from "node:vm";
// @ts-expect-error The native Node module loader preserves this configuration's file URL.
import { createRequire } from "node:module";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const pwaConfig = createRequire(resolve("package.json"))(
  "./vite.pwa.config.mjs",
).default;

const SCOPE = "https://aic.dzyha.com/notes/";
const VERSION = "offline-test";
const BUILD_FILES = [
  "index.html",
  "assets/app.js",
  "assets/style.css",
  "manifest.webmanifest",
  "terms/index.html",
  "terms/uk/index.html",
  "releases/index.html",
  "releases/uk/index.html",
  "how-to/index.html",
  "how-to/uk/index.html",
  "site.css",
];
const template = await readFile("src/pwa/sw.js", "utf8");

async function optionalBuildFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}
// Unit checks run on a fresh checkout; artifact checks also run after a build.
const chromeHtml = await optionalBuildFile(
  "dist-browser/chromium/pwa/index.html",
);
const standaloneWorker = await optionalBuildFile("dist-pwa/sw.js");

interface MockRequest {
  url: string;
  method: string;
  mode: string;
}
interface CachedResponse {
  kind: "cache" | "network";
  url: string;
}
interface WaitEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent {
  request: MockRequest;
  respondWith(promise: Promise<CachedResponse>): void;
}
type WorkerEvent = WaitEvent | FetchEvent | (WaitEvent & { data: unknown });

function workerHarness(code: string, failPrecache = false) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, CachedResponse>>();
  const added: string[][] = [];
  const matches: string[] = [];
  const deleted: string[] = [];
  const cacheNames: string[] = [];
  const network = vi.fn(
    async (request: MockRequest): Promise<CachedResponse> => ({
      kind: "network",
      url: request.url,
    }),
  );
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  const self = {
    registration: { scope: SCOPE },
    location: { origin: new URL(SCOPE).origin },
    clients: { claim },
    skipWaiting,
    addEventListener: (type: string, handler: (event: WorkerEvent) => void) =>
      handlers.set(type, handler),
  };
  const cacheStorage = {
    async open(name: string) {
      cacheNames.push(name);
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async addAll(urls: string[]) {
          added.push(Array.from(urls));
          if (failPrecache)
            throw new Error("A build asset failed to download.");
          for (const url of urls) store.set(url, { kind: "cache", url });
        },
        async match(request: string | MockRequest) {
          const url = typeof request === "string" ? request : request.url;
          matches.push(url);
          return store.get(url);
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      deleted.push(name);
      return stores.delete(name);
    },
  };
  runInNewContext(code, {
    self,
    caches: cacheStorage,
    fetch: network,
    URL,
    Response,
    Headers,
  });
  return {
    stores,
    added,
    matches,
    deleted,
    cacheNames,
    skipWaiting,
    claim,
    network,
    lifecycle(type: "install" | "activate") {
      let pending: Promise<unknown> | undefined;
      handlers.get(type)!({
        waitUntil: (promise) => {
          pending = promise;
        },
      });
      if (!pending)
        throw new Error("The worker did not extend its lifecycle event.");
      return pending;
    },
    message(data: unknown) {
      let pending: Promise<unknown> | undefined;
      handlers.get("message")!({
        data,
        waitUntil: (promise) => {
          pending = promise;
        },
      });
      return pending;
    },
    fetch(path: string, method = "GET", mode = "same-origin") {
      let response: Promise<CachedResponse> | undefined;
      handlers.get("fetch")!({
        request: { url: new URL(path, SCOPE).href, method, mode },
        respondWith: (promise) => {
          response = promise;
        },
      });
      return response;
    },
  };
}

function worker(failPrecache = false) {
  return workerHarness(
    template
      .replaceAll("__AIC_CACHE_VERSION__", VERSION)
      .replaceAll("__AIC_PRECACHE_FILES__", JSON.stringify(BUILD_FILES)),
    failPrecache,
  );
}

// Cache.addAll follows HTTP redirects, and Cache.match preserves the final
// response's redirect history. A navigation request with redirect="manual"
// cannot accept that response, despite its successful final status and body.
// Native Response bodies and headers keep these fixtures honest; overriding the
// read-only fetch metadata avoids a localhost server in this unit test.
function redirectedHtml(body: string, url: string, status = 200) {
  const response = new Response(body, {
    status,
    statusText: "OK",
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-fixture-version": body,
      "cache-control": "no-cache",
    },
  });
  Object.defineProperties(response, {
    redirected: { value: true },
    url: { value: url },
  });
  return response;
}

function cloneCachedResponse(response: Response): Response {
  const clone = response.clone();
  // A real Cache clones the response's fetch metadata as well as its body.
  if (response.redirected)
    Object.defineProperty(clone, "redirected", { value: true });
  if (response.url)
    Object.defineProperty(clone, "url", { value: response.url });
  return clone;
}

function responseWorkerHarness(failPrecache = false) {
  type NativeEvent = {
    waitUntil?(promise: Promise<unknown>): void;
    respondWith?(promise: Promise<Response>): void;
    request?: MockRequest & { redirect: "manual" };
    data?: unknown;
  };
  const handlers = new Map<string, (event: NativeEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const putLog: { cache: string; url: string }[] = [];
  const deleted: string[] = [];
  const precacheLog: string[][] = [];
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  const network = vi.fn(async (): Promise<Response> => {
    throw new Error("Offline");
  });
  const key = (request: string | MockRequest) =>
    typeof request === "string" ? request : request.url;
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async addAll(urls: string[]) {
          precacheLog.push(Array.from(urls));
          if (failPrecache) throw new Error("Synthetic failed precache");
          for (const url of urls) {
            const relative = url.slice(SCOPE.length);
            const cleanUrl = url.endsWith("index.html")
              ? url.slice(0, -"index.html".length).replace(/\/$/u, "") || SCOPE
              : url;
            store.set(
              url,
              relative.endsWith(".html")
                ? redirectedHtml(`new:${relative}`, cleanUrl)
                : new Response(`new:${relative}`),
            );
          }
        },
        async match(request: string | MockRequest) {
          const response = store.get(key(request));
          return response ? cloneCachedResponse(response) : undefined;
        },
        async put(request: string | MockRequest, response: Response) {
          if (!(response instanceof Response))
            throw new TypeError("Cache.put requires a native Response");
          putLog.push({ cache: name, url: key(request) });
          store.set(key(request), cloneCachedResponse(response));
        },
        async keys() {
          return [...store.keys()].map((url) => ({ url }));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      deleted.push(name);
      return stores.delete(name);
    },
  };
  runInNewContext(
    template
      .replaceAll("__AIC_CACHE_VERSION__", VERSION)
      .replaceAll("__AIC_PRECACHE_FILES__", JSON.stringify(BUILD_FILES)),
    {
      caches,
      fetch: network,
      URL,
      Response,
      Headers,
      self: {
        registration: { scope: SCOPE },
        location: { origin: new URL(SCOPE).origin },
        clients: { claim },
        skipWaiting,
        addEventListener: (
          type: string,
          handler: (event: NativeEvent) => void,
        ) => handlers.set(type, handler),
      },
    },
  );
  return {
    stores,
    putLog,
    deleted,
    precacheLog,
    skipWaiting,
    claim,
    network,
    lifecycle(type: "install" | "activate") {
      let task: Promise<unknown> | undefined;
      handlers.get(type)!({
        waitUntil: (promise) => {
          task = promise;
        },
      });
      if (!task)
        throw new Error("The worker did not extend its lifecycle event");
      return task;
    },
    fetch(path: string, method = "GET", mode = "navigate") {
      let response: Promise<Response> | undefined;
      handlers.get("fetch")!({
        request: {
          url: new URL(path, SCOPE).href,
          method,
          mode,
          redirect: "manual",
        },
        respondWith: (promise) => {
          response = promise;
        },
      });
      return response;
    },
  };
}

interface BuildItem {
  type: "chunk" | "asset";
  code?: string;
  source?: string;
}
interface EmittedAsset {
  type: "asset";
  fileName: string;
  source: string | Uint8Array;
}
async function generatedWorker(code = "const app = 1;") {
  const emitted: EmittedAsset[] = [];
  const bundle: Record<string, BuildItem> = {
    "assets/app.js": { type: "chunk", code },
    "assets/app.css": { type: "asset", source: ".app { color: black; }" },
  };
  const plugin = (
    pwaConfig as {
      plugins: {
        generateBundle(
          this: { emitFile(asset: EmittedAsset): void },
          options: unknown,
          bundle: Record<string, BuildItem>,
        ): Promise<void>;
      }[];
    }
  ).plugins[0]!;
  await plugin.generateBundle.call(
    { emitFile: (asset) => emitted.push(asset) },
    {},
    bundle,
  );
  const source = emitted.find((asset) => asset.fileName === "sw.js")?.source;
  if (typeof source !== "string")
    throw new Error("The build did not emit a service worker.");
  return { source, emitted, bundle };
}

describe("PWA offline shell lifecycle", () => {
  it("installs only build-declared assets and waits for an explicit update activation", async () => {
    const harness = worker();
    await harness.lifecycle("install");
    expect(harness.added).toEqual([
      BUILD_FILES.map((file) => new URL(file, SCOPE).href),
    ]);
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.message({ activate: true })).toBeUndefined();
    expect(harness.message("another-message")).toBeUndefined();
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    let complete!: () => void;
    harness.skipWaiting.mockImplementationOnce(
      () => new Promise<void>((resolve) => (complete = resolve)),
    );
    const activation = harness.message("activate-update");
    expect(activation).toBeInstanceOf(Promise);
    expect(harness.skipWaiting).toHaveBeenCalledOnce();
    let settled = false;
    void activation!.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    complete();
    await activation;
    expect(settled).toBe(true);
  });

  it("rejects installation if any application asset cannot be precached", async () => {
    const harness = worker(true);
    await expect(harness.lifecycle("install")).rejects.toThrow(
      "failed to download",
    );
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.claim).not.toHaveBeenCalled();
    expect(
      [...harness.stores.values()].every((store) => store.size === 0),
    ).toBe(true);
  });

  it("removes only older shell caches during activation", async () => {
    const harness = worker();
    await harness.lifecycle("install");
    const current = `aic-notes-shell-${VERSION}`;
    harness.stores.set("aic-notes-shell-old-version", new Map());
    harness.stores.set("other-app-shell", new Map());
    harness.stores.set("device-notes-backup", new Map());
    await harness.lifecycle("activate");
    expect(harness.deleted).toEqual(["aic-notes-shell-old-version"]);
    expect(harness.stores.has(current)).toBe(true);
    expect(harness.stores.has("other-app-shell")).toBe(true);
    expect(harness.stores.has("device-notes-backup")).toBe(true);
    expect(harness.claim).toHaveBeenCalledOnce();
  });

  it("serves scoped navigation and whitelisted assets offline without caching new URLs", async () => {
    const harness = worker();
    await harness.lifecycle("install");
    harness.network.mockRejectedValue(new Error("Offline"));
    await expect(harness.fetch("./", "GET", "navigate")).resolves.toEqual({
      kind: "cache",
      url: `${SCOPE}index.html`,
    });
    await expect(
      harness.fetch("./unknown-route", "GET", "navigate"),
    ).resolves.toEqual({ kind: "cache", url: `${SCOPE}index.html` });
    await expect(harness.fetch("./assets/app.js")).resolves.toEqual({
      kind: "cache",
      url: `${SCOPE}assets/app.js`,
    });
    expect(harness.network).not.toHaveBeenCalled();
    expect(harness.added).toHaveLength(1);
    expect(
      harness.stores
        .get(`aic-notes-shell-${VERSION}`)
        ?.has(`${SCOPE}unknown-route`),
    ).toBe(false);
  });

  it("opens public documents at clean URLs offline instead of returning the editor", async () => {
    const harness = worker();
    await harness.lifecycle("install");
    harness.network.mockRejectedValue(new Error("Offline"));
    for (const [path, file] of [
      ["index", "index.html"],
      ["terms", "terms/index.html"],
      ["terms/", "terms/index.html"],
      ["terms/index.html", "terms/index.html"],
      ["terms/index", "terms/index.html"],
      ["terms/uk", "terms/uk/index.html"],
      ["terms/uk/", "terms/uk/index.html"],
      ["releases", "releases/index.html"],
      ["releases/uk", "releases/uk/index.html"],
      ["releases/uk/index", "releases/uk/index.html"],
      ["how-to", "how-to/index.html"],
      ["how-to/uk/", "how-to/uk/index.html"],
      ["how-to/uk/index", "how-to/uk/index.html"],
      ["how-to/uk/#writing-prompt", "how-to/uk/index.html"],
    ])
      await expect(harness.fetch(path!, "GET", "navigate")).resolves.toEqual({
        kind: "cache",
        url: SCOPE + file,
      });
    expect(harness.network).not.toHaveBeenCalled();
    expect(harness.added).toHaveLength(1);
  });

  it("does not intercept unknown assets, query URLs, cross-origin URLs, other scopes or writes", async () => {
    const harness = worker();
    await harness.lifecycle("install");
    const installedMatches = [...harness.matches];
    for (const [path, method, mode] of [
      ["./private-note.aicnotes", "GET", "same-origin"],
      ["./assets/app.js?secret=value", "GET", "same-origin"],
      ["./?secret=value", "GET", "navigate"],
      ["https://other.example/assets/app.js", "GET", "same-origin"],
      ["/another-app/", "GET", "navigate"],
      ["./assets/app.js", "POST", "same-origin"],
    ])
      expect(harness.fetch(path!, method!, mode!)).toBeUndefined();
    expect(harness.matches).toEqual(installedMatches);
    expect(harness.added).toHaveLength(1);
    expect(harness.network).not.toHaveBeenCalled();
  });

  it("falls back to network for a missing declared cache entry without adding response data", async () => {
    const harness = worker();
    await harness.lifecycle("install");
    harness.stores
      .get(`aic-notes-shell-${VERSION}`)!
      .delete(`${SCOPE}assets/app.js`);
    await expect(harness.fetch("./assets/app.js")).resolves.toEqual({
      kind: "network",
      url: `${SCOPE}assets/app.js`,
    });
    expect(harness.added).toHaveLength(1);
    expect(
      harness.stores
        .get(`aic-notes-shell-${VERSION}`)!
        .has(`${SCOPE}assets/app.js`),
    ).toBe(false);
  });
});

describe("clean-URL redirects and existing offline installations", () => {
  it("returns nonredirected native HTML responses for root and document navigation", async () => {
    const harness = responseWorkerHarness();
    await harness.lifecycle("install");
    for (const [path, file] of [
      ["./", "index.html"],
      ["index", "index.html"],
      ["terms", "terms/index.html"],
      ["terms/index", "terms/index.html"],
      ["terms/uk/", "terms/uk/index.html"],
      ["releases", "releases/index.html"],
      ["releases/uk/", "releases/uk/index.html"],
      ["releases/uk/index", "releases/uk/index.html"],
      ["how-to", "how-to/index.html"],
      ["how-to/uk/", "how-to/uk/index.html"],
      ["how-to/uk/index", "how-to/uk/index.html"],
    ]) {
      const response = await harness.fetch(path!);
      expect(response).toBeInstanceOf(Response);
      expect(response!.redirected).toBe(false);
      expect(response!.status).toBe(200);
      expect(response!.statusText).toBe("OK");
      expect(response!.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(response!.headers.get("cache-control")).toBe("no-cache");
      expect(response!.headers.get("x-fixture-version")).toBe(`new:${file}`);
      expect(await response!.text()).toBe(`new:${file}`);
    }
    expect(harness.network).not.toHaveBeenCalled();
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.claim).not.toHaveBeenCalled();
  });

  it("normalizes an expected HTML network fallback without writing that navigation back to the cache", async () => {
    const harness = responseWorkerHarness();
    await harness.lifecycle("install");
    harness.stores
      .get(`aic-notes-shell-${VERSION}`)!
      .delete(`${SCOPE}terms/index.html`);
    const installedWrites = [...harness.putLog];
    harness.network.mockResolvedValue(
      redirectedHtml("network terms document", `${SCOPE}terms`),
    );
    const response = await harness.fetch("terms");
    expect(response!.redirected).toBe(false);
    expect(await response!.text()).toBe("network terms document");
    expect(harness.network).toHaveBeenCalledOnce();
    expect(harness.putLog).toEqual(installedWrites);
    expect(
      harness.stores
        .get(`aic-notes-shell-${VERSION}`)!
        .has(`${SCOPE}terms/index.html`),
    ).toBe(false);
  });

  it("repairs only declared redirected HTML in old AIC caches, preserving each version's bytes and metadata", async () => {
    const harness = responseWorkerHarness();
    const existingNames = [
      "aic-notes-shell-older",
      "aic-notes-shell-current-client",
    ];
    const currentName = `aic-notes-shell-${VERSION}`;
    const untouchedEntries = new Map<string, Response>();
    for (const [index, name] of existingNames.entries()) {
      const oldRoot = redirectedHtml(`old-${index}-root`, SCOPE);
      const oldTerms = redirectedHtml(
        `old-${index}-terms`,
        `${SCOPE}terms`,
        203,
      );
      const oldHowTo = redirectedHtml(`old-${index}-how-to`, `${SCOPE}how-to/`);
      const oldScript = redirectedHtml(
        `old-${index}-script`,
        `${SCOPE}assets/app.js`,
      );
      const userFile = new Response(`synthetic-encrypted-file-${index}`);
      const unknownHtml = redirectedHtml(
        `old-${index}-unlisted-page`,
        `${SCOPE}unlisted`,
      );
      const queryHtml = redirectedHtml(
        `old-${index}-queried`,
        `${SCOPE}terms?token=synthetic`,
      );
      const cleanHtml = new Response(`old-${index}-already-normal`, {
        headers: { "content-type": "text/html" },
      });
      const store = new Map([
        [`${SCOPE}index.html`, oldRoot],
        [`${SCOPE}terms/index.html`, oldTerms],
        [`${SCOPE}how-to/index.html`, oldHowTo],
        [`${SCOPE}assets/app.js`, oldScript],
        [`${SCOPE}device-note.aicnotes`, userFile],
        [`${SCOPE}unlisted/index.html`, unknownHtml],
        [`${SCOPE}terms/index.html?token=synthetic`, queryHtml],
        [`${SCOPE}releases/index.html`, cleanHtml],
      ]);
      harness.stores.set(name, store);
      for (const [url, response] of store)
        if (
          ![
            `${SCOPE}index.html`,
            `${SCOPE}terms/index.html`,
            `${SCOPE}how-to/index.html`,
          ].includes(url)
        )
          untouchedEntries.set(`${name}|${url}`, response);
    }
    const foreignHtml = redirectedHtml("foreign application root", SCOPE);
    const backupHtml = redirectedHtml(
      "device backup document",
      `${SCOPE}terms`,
    );
    harness.stores.set(
      "other-app-shell",
      new Map([[`${SCOPE}index.html`, foreignHtml]]),
    );
    harness.stores.set(
      "device-notes-backup",
      new Map([[`${SCOPE}terms/index.html`, backupHtml]]),
    );

    await harness.lifecycle("install");

    for (const [index, name] of existingNames.entries()) {
      const store = harness.stores.get(name)!;
      for (const [file, body, status] of [
        ["index.html", `old-${index}-root`, 200],
        ["terms/index.html", `old-${index}-terms`, 203],
        ["how-to/index.html", `old-${index}-how-to`, 200],
      ] as const) {
        const response = store.get(`${SCOPE}${file}`)!;
        expect(response.redirected).toBe(false);
        expect(response.status).toBe(status);
        expect(response.statusText).toBe("OK");
        expect(response.headers.get("content-type")).toBe(
          "text/html; charset=utf-8",
        );
        expect(response.headers.get("x-fixture-version")).toBe(body);
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(await response.clone().text()).toBe(body);
      }
    }
    for (const [identity, response] of untouchedEntries) {
      const [name, url] = identity.split("|");
      expect(harness.stores.get(name!)!.get(url!)).toBe(response);
    }
    expect(
      harness.stores.get("other-app-shell")!.get(`${SCOPE}index.html`),
    ).toBe(foreignHtml);
    expect(
      harness.stores
        .get("device-notes-backup")!
        .get(`${SCOPE}terms/index.html`),
    ).toBe(backupHtml);
    expect(
      harness.putLog.filter((entry) => entry.cache !== currentName),
    ).toEqual(
      existingNames.flatMap((cache) => [
        { cache, url: `${SCOPE}index.html` },
        { cache, url: `${SCOPE}terms/index.html` },
        { cache, url: `${SCOPE}how-to/index.html` },
      ]),
    );
    expect(harness.deleted).toEqual([]);
    expect([...harness.stores.keys()]).toEqual([
      ...existingNames,
      "other-app-shell",
      "device-notes-backup",
      currentName,
    ]);
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.claim).not.toHaveBeenCalled();
  });

  it("leaves old caches unchanged when new precaching fails", async () => {
    const harness = responseWorkerHarness(true);
    const response = redirectedHtml(
      "existing version must stay intact",
      `${SCOPE}terms`,
    );
    const existing = new Map([[`${SCOPE}terms/index.html`, response]]);
    harness.stores.set("aic-notes-shell-existing", existing);
    await expect(harness.lifecycle("install")).rejects.toThrow(
      "failed precache",
    );
    expect(harness.stores.get("aic-notes-shell-existing")).toBe(existing);
    expect(existing.get(`${SCOPE}terms/index.html`)).toBe(response);
    expect(response.redirected).toBe(true);
    expect(await response.clone().text()).toBe(
      "existing version must stay intact",
    );
    expect(harness.putLog).toEqual([]);
    expect(harness.deleted).toEqual([]);
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.claim).not.toHaveBeenCalled();
  });

  it("does not normalize cached HTML redirected to another document, origin, query or unknown route", async () => {
    const harness = responseWorkerHarness();
    const targets = [
      [`${SCOPE}index.html`, "https://other.example/notes/"],
      [`${SCOPE}terms/index.html`, `${SCOPE}terms?token=synthetic`],
      [`${SCOPE}releases/index.html`, `${SCOPE}unknown-document`],
      [`${SCOPE}how-to/index.html`, `${SCOPE}terms`],
    ] as const;
    const store = new Map(
      targets.map(([key, finalUrl]) => [
        key,
        redirectedHtml(`untrusted:${key}`, finalUrl),
      ]),
    );
    harness.stores.set("aic-notes-shell-existing", store);
    const originals = new Map(store);
    await harness.lifecycle("install");
    for (const [key, response] of originals) {
      expect(store.get(key)).toBe(response);
      expect(response.redirected).toBe(true);
    }
    expect(
      harness.putLog.every(
        (entry) => entry.cache === `aic-notes-shell-${VERSION}`,
      ),
    ).toBe(true);
  });

  it("keeps write requests, query requests, unrelated assets and foreign scopes outside the native response cache", async () => {
    const harness = responseWorkerHarness();
    await harness.lifecycle("install");
    const writes = [...harness.putLog];
    for (const [path, method, mode] of [
      ["device-note.aicnotes", "GET", "same-origin"],
      ["terms?token=synthetic", "GET", "navigate"],
      ["assets/app.js?token=synthetic", "GET", "same-origin"],
      ["https://other.example/notes/terms", "GET", "navigate"],
      ["/another-app/terms", "GET", "navigate"],
      ["terms", "POST", "navigate"],
      ["assets/app.js", "PUT", "same-origin"],
    ])
      expect(harness.fetch(path!, method!, mode!)).toBeUndefined();
    expect(harness.putLog).toEqual(writes);
    expect(harness.precacheLog).toEqual([
      BUILD_FILES.map((file) => new URL(file, SCOPE).href),
    ]);
    expect(harness.network).not.toHaveBeenCalled();
  });
});

describe("generated PWA application shell", () => {
  it("generates an executable worker including the HTML shell and every declared runtime asset", async () => {
    const generated = await generatedWorker();
    expect(generated.source).not.toContain("__AIC_PRECACHE_FILES__");
    expect(generated.source).not.toContain("__AIC_CACHE_VERSION__");
    const harness = workerHarness(generated.source);
    await harness.lifecycle("install");
    const urls = new Set(harness.added[0]);
    for (const path of [
      "index.html",
      ...Object.keys(generated.bundle),
      "aic-logo.svg",
      "icon-192.png",
      "icon-512.png",
      "manifest.webmanifest",
      "terms/index.html",
      "terms/uk/index.html",
      "releases/index.html",
      "releases/uk/index.html",
      "how-to/index.html",
      "how-to/uk/index.html",
      "site.css",
    ]) {
      expect(urls.has(new URL(path, SCOPE).href)).toBe(true);
    }
    await expect(harness.fetch("./", "GET", "navigate")).resolves.toEqual({
      kind: "cache",
      url: `${SCOPE}index.html`,
    });
  });

  it("changes its cache identity when bundled runtime bytes change", async () => {
    const before = workerHarness(
      (await generatedWorker("const version = 1;")).source,
    );
    const after = workerHarness(
      (await generatedWorker("const version = 2;")).source,
    );
    await before.lifecycle("install");
    await after.lifecycle("install");
    expect(before.cacheNames[0]).not.toBe(after.cacheNames[0]);
    expect(before.cacheNames[0]).toMatch(/^aic-notes-shell-[a-f0-9]{16}$/u);
  });

  it.skipIf(standaloneWorker === null)(
    "the built standalone worker runs and precaches only resources present in its package",
    async () => {
      const harness = workerHarness(standaloneWorker!);
      await harness.lifecycle("install");
      expect(harness.added[0]).toContain(`${SCOPE}index.html`);
      for (const url of harness.added[0]!) {
        const relative = url.slice(SCOPE.length);
        expect(url.startsWith(SCOPE)).toBe(true);
        await expect(access(`dist-pwa/${relative}`)).resolves.toBeUndefined();
      }
      harness.network.mockRejectedValue(new Error("Offline"));
      await expect(harness.fetch("./", "GET", "navigate")).resolves.toEqual({
        kind: "cache",
        url: `${SCOPE}index.html`,
      });
    },
  );

  it.skipIf(chromeHtml === null)(
    "the generated Chrome file interface resolves all script and link resources inside its package",
    async () => {
      const html = chromeHtml!;
      const origin = "https://package.invalid/";
      const base = `${origin}pwa/index.html`;
      const resources = [
        ...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/giu),
      ].map((match) => match[1]!);
      expect(
        resources.some(
          (resource) => resource.includes("files-") && resource.endsWith(".js"),
        ),
      ).toBe(true);
      expect(resources).toContain("./aic-logo.svg");
      for (const resource of resources) {
        const url = new URL(resource, base);
        expect(url.origin).toBe(new URL(origin).origin);
        expect(url.search).toBe("");
        await expect(
          access(`dist-browser/chromium${url.pathname}`),
        ).resolves.toBeUndefined();
      }
    },
  );
});
