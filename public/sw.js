// Crawlback service worker for consented, background Common Crawl scans.
const CDX_CACHE = "crawlback-cdx-v2";
const LEGACY_CDX_CACHE = "crawlback-cdx-v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const MAX_CACHE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const CACHE_BUFFER_TIMEOUT_MS = 12_000;
const MAX_PREFETCH_URLS = 500;
const DEFAULT_PREFETCH_SPACING_MS = 1100;
const MIN_PREFETCH_SPACING_MS = 1000;
const MAX_PREFETCH_SPACING_MS = 60_000;
let prefetchAbort = false;
let prefetchController;
const authorizedClients = new Set();
const pendingCacheWrites = new Set();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([
  self.clients.claim(), caches.delete(LEGACY_CDX_CACHE)
])));

// Prefetch only ever fetches CDX index URLs over https. Anything else from a
// page message is dropped so the worker cannot be used as an open fetch proxy.
function isAllowedPrefetchUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "index.commoncrawl.org";
  } catch { return false; }
}

function clampPrefetchSpacing(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_PREFETCH_SPACING_MS;
  return Math.min(MAX_PREFETCH_SPACING_MS, Math.max(MIN_PREFETCH_SPACING_MS, ms));
}

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
  let response;
  try {
    const cache = await caches.open(CDX_CACHE);
    if (!authorizedClients.has(clientId)) return fetch(request);
    const cached = await getFreshCached(cache, request);
    if (!authorizedClients.has(clientId)) return fetch(request);
    if (cached) return cached;
    response = await fetch(request);
    if (response.ok && authorizedClients.has(clientId)) await putInCache(cache, request, response.clone(), clientId);
    return response;
  } catch {
    // Cache quota and storage failures must not block a live index response.
    return response || fetch(request);
  }
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
    const urls = data.urls.filter(isAllowedPrefetchUrl).slice(0, MAX_PREFETCH_URLS);
    const spacingMs = clampPrefetchSpacing(data.spacingMs);
    event.waitUntil(prefetchUrls(urls, spacingMs, clientId, prefetchController));
  }
});

async function prefetchUrls(urls, spacingMs, ownerClientId, controller) {
  if (!authorizedClients.has(ownerClientId)) return;
  let cache;
  try { cache = await caches.open(CDX_CACHE); }
  catch { await notifyClients({ type: "scan:prefetch-done" }); return; }
  for (let index = 0; index < urls.length; index += 1) {
    if (prefetchAbort || !authorizedClients.has(ownerClientId)) break;
    const url = urls[index];
    try {
      const existing = await getFreshCached(cache, url);
      if (prefetchAbort || !authorizedClients.has(ownerClientId)) break;
      if (!existing) {
        const response = await fetch(url, { signal: controller.signal });
        if (response.ok && !prefetchAbort && authorizedClients.has(ownerClientId)) await putInCache(cache, url, response.clone(), ownerClientId);
      }
    } catch { /* Best-effort warming. */ }
    await notifyClients({ type: "scan:prefetch-progress", completed: index + 1, total: urls.length });
    if (index < urls.length - 1 && !prefetchAbort && authorizedClients.has(ownerClientId)) await delay(spacingMs);
  }
  await notifyClients({ type: "scan:prefetch-done" });
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function putInCache(cache, request, response, clientId) {
  const payload = await readCachePayload(response.clone());
  if (!payload) return;
  if (!authorizedClients.has(clientId)) return;
  const headers = new Headers(response.headers);
  headers.set("X-Crawlback-Cached-At", String(Date.now()));
  headers.set("X-Crawlback-Cache-Bytes", String(payload.byteLength));
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("Transfer-Encoding");
  const nullBody = response.status === 204 || response.status === 205 || response.status === 304;
  const cacheable = new Response(nullBody ? null : payload, { status: response.status, statusText: response.statusText, headers });
  const write = cache.put(request, cacheable);
  pendingCacheWrites.add(write);
  try { await write; await pruneCache(cache); } finally { pendingCacheWrites.delete(write); }
}
async function clearCacheAfterWrites() {
  await Promise.allSettled(Array.from(pendingCacheWrites));
  await caches.delete(CDX_CACHE);
  await caches.delete(LEGACY_CDX_CACHE);
}
async function getFreshCached(cache, request) {
  const cached = await cache.match(request);
  if (!cached) return undefined;
  const storedAt = Number(cached.headers.get("X-Crawlback-Cached-At"));
  if (storedAt > 0 && Date.now() - storedAt < CACHE_TTL_MS) return cached;
  await cache.delete(request);
  return undefined;
}
async function readCachePayload(response) {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_ENTRY_BYTES) return null;
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let timer;
  const reading = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      size += value.byteLength;
      if (size > MAX_ENTRY_BYTES) return false;
      chunks.push(value);
    }
  })();
  const completed = await Promise.race([
    reading.catch(() => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), CACHE_BUFFER_TIMEOUT_MS); })
  ]);
  clearTimeout(timer);
  if (completed !== true) {
    void reader.cancel().catch(() => {});
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function pruneCache(cache) {
  if (!cache) cache = await caches.open(CDX_CACHE);
  const requests = await cache.keys();
  const records = [];
  let totalBytes = 0;
  for (const request of requests) {
    const response = await cache.match(request);
    const storedAt = Number(response && response.headers.get("X-Crawlback-Cached-At"));
    const bytes = Number(response && response.headers.get("X-Crawlback-Cache-Bytes"));
    if (!response || !(storedAt > 0) || Date.now() - storedAt >= CACHE_TTL_MS || !Number.isFinite(bytes) || bytes < 0 || bytes > MAX_ENTRY_BYTES) {
      await cache.delete(request);
      continue;
    }
    records.push({ request, storedAt, bytes });
    totalBytes += bytes;
  }
  records.sort((a, b) => a.storedAt - b.storedAt);
  while (records.length > MAX_CACHE_ENTRIES || totalBytes > MAX_CACHE_BYTES) {
    const oldest = records.shift();
    await cache.delete(oldest.request);
    totalBytes -= oldest.bytes;
  }
}
async function notifyClients(message) {
  const clients = await self.clients.matchAll();
  for (const client of clients) client.postMessage(message);
}
