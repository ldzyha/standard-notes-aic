/* global __AIC_PRECACHE_FILES__ */
/* Only build-declared application assets enter the offline cache. */
const CACHE_PREFIX = "aic-notes-shell-";
const CACHE = CACHE_PREFIX + "__AIC_CACHE_VERSION__";
const FILES = __AIC_PRECACHE_FILES__;
const urls = new Set(
  FILES.map((file) => new URL(file, self.registration.scope).href),
);
const shell = new URL("index.html", self.registration.scope).href;
const documents = new Map();
for (const file of FILES.filter((name) => name.endsWith(".html"))) {
  const target = new URL(file, self.registration.scope).href;
  documents.set(target, target);
  documents.set(target.slice(0, -".html".length), target);
  if (file === "index.html" || file.endsWith("/index.html")) {
    const directory = target.slice(0, -"index.html".length);
    documents.set(directory, target);
    documents.set(directory.slice(0, -1), target);
  }
}

function navigationResponse(response, target) {
  if (response?.redirected && documents.get(response.url) === target) {
    // A navigation can have redirect mode "manual". Returning a cached
    // redirect-followed response makes the browser reject an otherwise valid
    // document; retain its bytes and headers without the redirect history.
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
}

async function repairDocumentCache(cache) {
  for (const target of new Set(documents.values())) {
    const response = await cache.match(target);
    if (!response?.redirected) continue;
    const repaired = navigationResponse(response, target);
    if (repaired !== response) await cache.put(target, repaired);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([...urls]);
      await repairDocumentCache(cache);
      // Repair the previous worker's HTML in place so already installed apps
      // can open the update UI. Keep its document bytes and asset version;
      // changing the running worker still requires explicit activation.
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE)
          await repairDocumentCache(await caches.open(name));
      }
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data === "activate-update") event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE)
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search) return;
  // Section anchors select a position inside the same cached document.
  url.hash = "";
  if (
    request.mode === "navigate" &&
    url.href.startsWith(self.registration.scope)
  ) {
    const target = documents.get(url.href) || shell;
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(target))
        .then((response) => response || fetch(request))
        .then((response) => navigationResponse(response, target)),
    );
  } else if (urls.has(url.href)) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(url.href))
        .then((response) => response || fetch(request)),
    );
  }
});
