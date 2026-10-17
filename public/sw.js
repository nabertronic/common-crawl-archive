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
const STATE_CACHE = "crawlback-sw-state";
const AUTHORIZED_CLIENTS_URL = "/__crawlback-sw/authorized-clients";
const MAX_AUTHORIZED_CLIENTS = 50;
const prefetchJobs = new Map();
const authorizedClients = new Set();
const pendingCacheWrites = new Set();
// Browsers stop an idle worker and restart it with fresh globals, so the
// approved client ids are mirrored to Cache Storage and restored on demand.
// Revocation bumps the generation so an in-flight restore cannot re-add them.
let authorizationGeneration = 0;
let authorizationRestore;

function restoreAuthorizedClients() {
  if (authorizationRestore) return authorizationRestore;
  const generation = authorizationGeneration;
  authorizationRestore = (async () => {
    try {
      // caches.match does not create the cache, so an unapproved client never
      // causes a storage write here.
      const stored = await caches.match(AUTHORIZED_CLIENTS_URL, { cacheName: STATE_CACHE });
      const ids = stored ? await stored.json() : [];
      if (!Array.isArray(ids)) return;
      let live;
      try { live = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map((client) => client.id)); }
      catch { live = undefined; }
      if (generation !== authorizationGeneration) return;
      for (const id of ids) if (typeof id === "string" && (!live || live.has(id))) authorizedClients.add(id);
    } catch { /* Missing state just means no restored approvals. */ }
  })();
  return authorizationRestore;
}

async function persistAuthorizedClients() {
  const generation = authorizationGeneration;
  try {
    const ids = Array.from(authorizedClients).slice(-MAX_AUTHORIZED_CLIENTS);
    const cache = await caches.open(STATE_CACHE);
    if (generation !== authorizationGeneration) return;
    await cache.put(AUTHORIZED_CLIENTS_URL, new Response(JSON.stringify(ids), { headers: { "Content-Type": "application/json" } }));
  } catch { /* Best effort: the page re-sends its approval on the next load. */ }
}

async function isAuthorizedClient(clientId) {
  if (!clientId) return false;
  if (!authorizedClients.has(clientId)) await restoreAuthorizedClients();
  return authorizedClients.has(clientId);
}

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
  if (!(await isAuthorizedClient(clientId))) return fetch(request);
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
  if (data.type === "consent:grant" && clientId) {
    authorizedClients.add(clientId);
    const persisted = persistAuthorizedClients();
    if (typeof event.waitUntil === "function") event.waitUntil(persisted);
    return;
  }
  if (data.type === "consent:revoke") {
    authorizedClients.clear();
    authorizationGeneration += 1;
    authorizationRestore = Promise.resolve();
    for (const job of prefetchJobs.values()) job.controller.abort();
    prefetchJobs.clear();
    event.waitUntil(clearCacheAfterWrites());
    return;
  }
  if (data.type === "scan:cancel") {
    const job = prefetchJobs.get(clientId);
    if (job) { job.controller.abort(); prefetchJobs.delete(clientId); }
    return;
  }
  if (data.type === "scan:prefetch" && Array.isArray(data.urls) && clientId) {
    const start = () => {
      prefetchJobs.get(clientId)?.controller.abort();
      const job = { controller: new AbortController(), client: event.source };
      prefetchJobs.set(clientId, job);
      const urls = data.urls.filter(isAllowedPrefetchUrl).slice(0, MAX_PREFETCH_URLS);
      const spacingMs = clampPrefetchSpacing(data.spacingMs);
      return prefetchUrls(urls, spacingMs, clientId, job);
    };
    if (authorizedClients.has(clientId)) event.waitUntil(start());
    else event.waitUntil(restoreAuthorizedClients().then(() => (authorizedClients.has(clientId) ? start() : undefined)));
  }
});

function isCurrentPrefetch(ownerClientId, job) {
  return prefetchJobs.get(ownerClientId) === job && !job.controller.signal.aborted && authorizedClients.has(ownerClientId);
}

async function prefetchUrls(urls, spacingMs, ownerClientId, job) {
  if (!isCurrentPrefetch(ownerClientId, job)) return;
  let cache;
  try { cache = await caches.open(CDX_CACHE); }
  catch {
    if (isCurrentPrefetch(ownerClientId, job)) notifyClient(job.client, { type: "scan:prefetch-done" });
    if (prefetchJobs.get(ownerClientId) === job) prefetchJobs.delete(ownerClientId);
    return;
  }
  if (!isCurrentPrefetch(ownerClientId, job)) return;
  for (let index = 0; index < urls.length; index += 1) {
    if (!isCurrentPrefetch(ownerClientId, job)) break;
    const url = urls[index];
    try {
      const existing = await getFreshCached(cache, url);
      if (!isCurrentPrefetch(ownerClientId, job)) break;
      if (!existing) {
        const response = await fetch(url, { signal: job.controller.signal });
        if (!isCurrentPrefetch(ownerClientId, job)) break;
        // Warming is optional: on a rate-limit or overload answer, stop instead
        // of adding load. The page's own scan applies the shared backoff.
        if (response.status === 429 || response.status === 503) {
          void response.body?.cancel().catch(() => {});
          break;
        }
        if (response.ok) await putInCache(cache, url, response.clone(), ownerClientId);
        if (!isCurrentPrefetch(ownerClientId, job)) break;
      }
    } catch { /* Best-effort warming. */ }
    if (!isCurrentPrefetch(ownerClientId, job)) break;
    notifyClient(job.client, { type: "scan:prefetch-progress", completed: index + 1, total: urls.length });
    if (index < urls.length - 1) {
      await delay(spacingMs);
      if (!isCurrentPrefetch(ownerClientId, job)) break;
    }
  }
  if (isCurrentPrefetch(ownerClientId, job)) notifyClient(job.client, { type: "scan:prefetch-done" });
  if (prefetchJobs.get(ownerClientId) === job) prefetchJobs.delete(ownerClientId);
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
  await caches.delete(STATE_CACHE);
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
function notifyClient(client, message) {
  if (typeof client?.postMessage === "function") client.postMessage(message);
}
