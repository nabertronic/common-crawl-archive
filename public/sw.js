// Crawlback service worker for consented, background Common Crawl scans.
const CDX_CACHE = "crawlback-cdx-v1";
let prefetchAbort = false;
let prefetchController;
const authorizedClients = new Set();
const pendingCacheWrites = new Set();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function isCdxIndexRequest(url) {
  try { return new URL(url).hostname === "index.commoncrawl.org"; } catch { return false; }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !isCdxIndexRequest(request.url)) return;
  event.respondWith(cacheFirst(request, event.clientId));
});

async function cacheFirst(request, clientId) {
  if (!clientId || !authorizedClients.has(clientId)) return fetch(request);
  const cache = await caches.open(CDX_CACHE);
  if (!authorizedClients.has(clientId)) return fetch(request);
  const cached = await cache.match(request);
  if (!authorizedClients.has(clientId)) return fetch(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && authorizedClients.has(clientId)) await putInCache(cache, request, response.clone());
  return response;
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const clientId = event.source && "id" in event.source ? event.source.id : "";
  if (data.type === "consent:grant" && clientId) { authorizedClients.add(clientId); return; }
  if (data.type === "consent:revoke") {
    authorizedClients.clear();
    prefetchAbort = true;
    prefetchController?.abort();
    event.waitUntil(clearCacheAfterWrites());
    return;
  }
  if (data.type === "scan:cancel") { prefetchAbort = true; prefetchController?.abort(); return; }
  if (data.type === "scan:prefetch" && Array.isArray(data.urls) && clientId && authorizedClients.has(clientId)) {
    prefetchAbort = false;
    prefetchController?.abort();
    prefetchController = new AbortController();
    const spacingMs = Number(data.spacingMs) || 1100;
    event.waitUntil(prefetchUrls(data.urls, spacingMs, clientId, prefetchController));
  }
});

async function prefetchUrls(urls, spacingMs, ownerClientId, controller) {
  if (!authorizedClients.has(ownerClientId)) return;
  const cache = await caches.open(CDX_CACHE);
  for (let index = 0; index < urls.length; index += 1) {
    if (prefetchAbort || !authorizedClients.has(ownerClientId)) break;
    const url = urls[index];
    try {
      const existing = await cache.match(url);
      if (prefetchAbort || !authorizedClients.has(ownerClientId)) break;
      if (!existing) {
        const response = await fetch(url, { signal: controller.signal });
        if (response.ok && !prefetchAbort && authorizedClients.has(ownerClientId)) await putInCache(cache, url, response.clone());
      }
    } catch { /* Best-effort warming. */ }
    await notifyClients({ type: "scan:prefetch-progress", completed: index + 1, total: urls.length });
    if (index < urls.length - 1 && !prefetchAbort && authorizedClients.has(ownerClientId)) await delay(spacingMs);
  }
  await notifyClients({ type: "scan:prefetch-done" });
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function putInCache(cache, request, response) {
  const write = cache.put(request, response);
  pendingCacheWrites.add(write);
  try { await write; } finally { pendingCacheWrites.delete(write); }
}
async function clearCacheAfterWrites() {
  await Promise.allSettled(Array.from(pendingCacheWrites));
  await caches.delete(CDX_CACHE);
}
async function notifyClients(message) {
  const clients = await self.clients.matchAll();
  for (const client of clients) client.postMessage(message);
}
