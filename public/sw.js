// Crawlback service worker — background scan assist.
//
// Two jobs:
//  1. Cache-first for Common Crawl CDX index responses. A crawl collection's CDX
//     is immutable, so a resumed/repeated scan is served from cache instead of
//     re-hitting Common Crawl.
//  2. On a "scan:prefetch" message, keep fetching + caching the remaining
//     collections' CDX pages while the page is hidden, so a scan effectively
//     continues in the background and completes fast when the user returns.
//
// The message protocol and the isCdxIndexRequest predicate mirror
// lib/background-scan.ts — keep them in sync.

const CDX_CACHE = "crawlback-cdx-v1";
let prefetchAbort = false;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function isCdxIndexRequest(url) {
  try {
    return new URL(url).hostname === "index.commoncrawl.org";
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !isCdxIndexRequest(request.url)) return;
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CDX_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "scan:cancel") {
    prefetchAbort = true;
    return;
  }
  if (data.type === "scan:prefetch" && Array.isArray(data.urls)) {
    prefetchAbort = false;
    const spacingMs = Number(data.spacingMs) || 1100;
    event.waitUntil(prefetchUrls(data.urls, spacingMs));
  }
});

async function prefetchUrls(urls, spacingMs) {
  const cache = await caches.open(CDX_CACHE);
  for (let index = 0; index < urls.length; index += 1) {
    if (prefetchAbort) break;
    const url = urls[index];
    try {
      const existing = await cache.match(url);
      if (!existing) {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response.clone());
      }
    } catch {
      // Best-effort warming; a failure just means no warm cache for this URL.
    }
    await notifyClients({ type: "scan:prefetch-progress", completed: index + 1, total: urls.length });
    if (index < urls.length - 1 && !prefetchAbort) await delay(spacingMs);
  }
  await notifyClients({ type: "scan:prefetch-done" });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll();
  for (const client of clients) client.postMessage(message);
}
