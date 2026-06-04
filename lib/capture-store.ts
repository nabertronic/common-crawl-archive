import type { CollectionCheckResult, CommonCrawlCapture, CommonCrawlCollection, MatchType } from "./common-crawl";
import { dedupeCaptures, mergeCollectionResult } from "./scan-results";

const DB_NAME = "wayback-fallback";
const DB_VERSION = 3;
const LEGACY_SEARCH_STORE = "searches";
const TARGET_STORE = "targets";
const COVERAGE_STORE = "coverages";
const SESSION_STORE = "scanSessions";
const USER_STORE = "users";
const SETTINGS_STORE = "settings";
const HTML_CAPTURE_STORE = "htmlCaptures";
const CHANNEL_NAME = "wayback-fallback:searches";
const DEFAULT_LOCAL_USER_ID = "local";
const ACTIVE_SETTINGS_ID = "active";
export const DEFAULT_HTML_CACHE_LIMIT_BYTES = 500 * 1024 * 1024;

export type ScanScope = "recent" | "all";

export type StoredSearch = {
  key: string;
  ownerId?: string;
  url: string;
  matchType: MatchType;
  mock: boolean;
  captures: CommonCrawlCapture[];
  scanScope?: ScanScope;
  collections?: CommonCrawlCollection[];
  results?: CollectionCheckResult[];
  updatedAt: number;
};

export type SearchTarget = {
  targetId: string;
  ownerId?: string;
  url: string;
  matchType: MatchType;
  mock: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CoverageRecord = {
  targetId: string;
  ownerId?: string;
  url: string;
  matchType: MatchType;
  mock: boolean;
  collectionResults: Record<string, CollectionCheckResult>;
  // Accumulated active scanning time across all runs, so a scan reopened from
  // history can show how long the run actually took instead of 0:00.
  durationMs?: number;
  updatedAt: number;
};

export type ScanSession = {
  scanId: string;
  ownerId?: string;
  targetId: string;
  url: string;
  matchType: MatchType;
  mock: boolean;
  scope: ScanScope;
  year?: string;
  collection?: string;
  mime?: string;
  status?: string;
  filter?: string;
  sort?: string;
  view?: string;
  page?: number;
  createdAt: number;
  updatedAt: number;
};

export type LocalUser = {
  userId: string;
  displayName?: string;
  createdAt: number;
  updatedAt: number;
};

export type AppSettings = {
  id: string;
  activeUserId: string;
  htmlCacheEnabled: boolean;
  htmlCacheLimitBytes: number;
  autoPruneEnabled: boolean;
  updatedAt: number;
};

export type CachedHtmlCaptureRecord = {
  cacheKey: string;
  ownerId: string;
  filename: string;
  offset: string;
  length: string;
  url?: string;
  timestamp?: string;
  collectionId?: string;
  mime?: string;
  status?: string;
  warcHeaders: Record<string, string>;
  httpHeaders: Record<string, string>;
  statusLine: string;
  html: string;
  sizeBytes: number;
  createdAt: number;
  lastAccessedAt: number;
};

export type CacheStats = {
  count: number;
  sizeBytes: number;
  lastAccessedAt?: number;
};

export function searchKey(url: string, matchType: MatchType | string, mock: boolean): string {
  return `${mock ? "mock" : "live"}:${matchType}:${url}`;
}

export function scanSearchKey(
  url: string,
  matchType: MatchType | string,
  mock: boolean,
  scope: ScanScope
): string {
  return `${searchKey(url, matchType, mock)}:scan:${scope}`;
}

export function legacyUnscopedScanSearchKey(url: string, matchType: MatchType | string, mock: boolean): string {
  return `${searchKey(url, matchType, mock)}:scan`;
}

export function legacyScanSearchKey(
  url: string,
  matchType: MatchType | string,
  mock: boolean,
  scope: ScanScope
): string {
  return `${searchKey(url, matchType, mock)}:${scope}`;
}

export function legacyScanSearchKeys(url: string, matchType: MatchType | string, mock: boolean): string[] {
  return [
    legacyUnscopedScanSearchKey(url, matchType, mock),
    legacyScanSearchKey(url, matchType, mock, "recent"),
    legacyScanSearchKey(url, matchType, mock, "all")
  ];
}

export function normalizeTargetUrl(url: string): string {
  return url.trim();
}

export function targetIdFor(url: string, matchType: MatchType | string, mock: boolean): string {
  const raw = JSON.stringify({ url: normalizeTargetUrl(url), matchType, mock });
  return `target_${fnv1a(raw)}`;
}

export function newScanId(): string {
  return `scan_${newStableId()}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function newStableId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEGACY_SEARCH_STORE)) {
        db.createObjectStore(LEGACY_SEARCH_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(TARGET_STORE)) {
        db.createObjectStore(TARGET_STORE, { keyPath: "targetId" });
      }
      if (!db.objectStoreNames.contains(COVERAGE_STORE)) {
        db.createObjectStore(COVERAGE_STORE, { keyPath: "targetId" });
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "scanId" });
      }
      if (!db.objectStoreNames.contains(USER_STORE)) {
        db.createObjectStore(USER_STORE, { keyPath: "userId" });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HTML_CAPTURE_STORE)) {
        db.createObjectStore(HTML_CAPTURE_STORE, { keyPath: "cacheKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  task: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = task(tx.objectStore(storeName));
      let requestValue: T | undefined;
      if (request) {
        request.onsuccess = () => {
          requestValue = request.result;
        };
        request.onerror = () => reject(request.error);
      }
      tx.oncomplete = () => resolve(requestValue);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function putSearch(record: StoredSearch): Promise<void> {
  try {
    const ownerId = await activeOwnerId();
    await withStore(LEGACY_SEARCH_STORE, "readwrite", (store) => {
      store.put({ ...record, ownerId: record.ownerId ?? ownerId });
    });
    notifyUpdated(record.key);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function getSearch(key: string): Promise<StoredSearch | undefined> {
  try {
    return withOwner(await withStore<StoredSearch>(LEGACY_SEARCH_STORE, "readonly", (store) => store.get(key)));
  } catch {
    return undefined;
  }
}

export async function listSearches(): Promise<StoredSearch[]> {
  try {
    const ownerId = await activeOwnerId();
    return ((await withStore<StoredSearch[]>(LEGACY_SEARCH_STORE, "readonly", (store) => store.getAll())) ?? [])
      .map((record) => withOwner(record, ownerId))
      .filter((record): record is StoredSearch => record !== undefined && record.ownerId === ownerId);
  } catch {
    return [];
  }
}

export async function deleteSearch(key: string): Promise<void> {
  try {
    await withStore(LEGACY_SEARCH_STORE, "readwrite", (store) => {
      store.delete(key);
    });
    notifyUpdated(key);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function deleteSearches(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LEGACY_SEARCH_STORE, "readwrite");
      const store = tx.objectStore(LEGACY_SEARCH_STORE);
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    for (const key of keys) notifyUpdated(key);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function ensureTarget(url: string, matchType: MatchType, mock: boolean): Promise<SearchTarget> {
  const targetId = targetIdFor(url, matchType, mock);
  const existing = await getTarget(targetId);
  const now = Date.now();
  const ownerId = await activeOwnerId();
  const next: SearchTarget = {
    targetId,
    ownerId: existing?.ownerId ?? ownerId,
    url: normalizeTargetUrl(url),
    matchType,
    mock,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  await putTarget(next);
  return next;
}

export async function getTarget(targetId: string): Promise<SearchTarget | undefined> {
  try {
    return withOwner(await withStore<SearchTarget>(TARGET_STORE, "readonly", (store) => store.get(targetId)));
  } catch {
    return undefined;
  }
}

export async function putTarget(target: SearchTarget): Promise<void> {
  try {
    const ownerId = await activeOwnerId();
    await withStore(TARGET_STORE, "readwrite", (store) => {
      store.put({ ...target, ownerId: target.ownerId ?? ownerId });
    });
    notifyUpdated(target.targetId);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function getCoverage(targetId: string): Promise<CoverageRecord | undefined> {
  try {
    return withOwner(await withStore<CoverageRecord>(COVERAGE_STORE, "readonly", (store) => store.get(targetId)));
  } catch {
    return undefined;
  }
}

export async function putCoverage(record: CoverageRecord): Promise<void> {
  try {
    const ownerId = await activeOwnerId();
    await withStore(COVERAGE_STORE, "readwrite", (store) => {
      store.put({ ...record, ownerId: record.ownerId ?? ownerId });
    });
    notifyUpdated(record.targetId);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function upsertCoverageResult(
  target: Pick<SearchTarget, "targetId" | "ownerId" | "url" | "matchType" | "mock">,
  result: CollectionCheckResult
): Promise<CoverageRecord> {
  const existing = await getCoverage(target.targetId);
  const merged = mergeCollectionResult(existing?.collectionResults[result.collection.id], result);
  const next: CoverageRecord = {
    targetId: target.targetId,
    ownerId: existing?.ownerId ?? target.ownerId ?? await activeOwnerId(),
    url: target.url,
    matchType: target.matchType,
    mock: target.mock,
    collectionResults: {
      ...(existing?.collectionResults ?? {}),
      [result.collection.id]: merged
    },
    durationMs: existing?.durationMs,
    updatedAt: Date.now()
  };
  await putCoverage(next);
  return next;
}

// Add one run's active scanning time to the stored total. Called when a scan
// run reaches a terminal state (done/paused/cancelled/error).
export async function addCoverageDuration(targetId: string, segmentMs: number): Promise<void> {
  if (!Number.isFinite(segmentMs) || segmentMs <= 0) return;
  const existing = await getCoverage(targetId);
  if (!existing) return;
  await putCoverage({
    ...existing,
    durationMs: (existing.durationMs ?? 0) + Math.round(segmentMs),
    updatedAt: Date.now()
  });
}

export function coverageResults(record: CoverageRecord | undefined): CollectionCheckResult[] {
  return Object.values(record?.collectionResults ?? {}).map((result) => ({
    ...result,
    checkedAt: result.checkedAt ?? record?.updatedAt
  }));
}

export function coverageCaptures(record: CoverageRecord | undefined): CommonCrawlCapture[] {
  return dedupeCaptures(coverageResults(record).flatMap((result) => result.captures));
}

export async function getScanSession(scanId: string): Promise<ScanSession | undefined> {
  try {
    return withOwner(await withStore<ScanSession>(SESSION_STORE, "readonly", (store) => store.get(scanId)));
  } catch {
    return undefined;
  }
}

export async function putScanSession(session: ScanSession): Promise<void> {
  try {
    const ownerId = await activeOwnerId();
    await withStore(SESSION_STORE, "readwrite", (store) => {
      store.put({ ...session, ownerId: session.ownerId ?? ownerId });
    });
    notifyUpdated(session.scanId);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function ensureScanSession(input: {
  scanId?: string;
  url: string;
  matchType: MatchType;
  mock: boolean;
  scope: ScanScope;
  year?: string;
  collection?: string;
  mime?: string;
  status?: string;
  filter?: string;
  sort?: string;
  view?: string;
  page?: number;
}): Promise<ScanSession> {
  const target = await ensureTarget(input.url, input.matchType, input.mock);
  const existing = input.scanId ? await getScanSession(input.scanId) : undefined;
  const now = Date.now();
  const ownerId = await activeOwnerId();
  const session: ScanSession = {
    scanId: existing?.scanId ?? input.scanId ?? newScanId(),
    ownerId: existing?.ownerId ?? target.ownerId ?? ownerId,
    targetId: target.targetId,
    url: target.url,
    matchType: target.matchType,
    mock: target.mock,
    scope: input.scope,
    year: input.year,
    collection: input.collection,
    mime: input.mime,
    status: input.status,
    filter: input.filter,
    sort: input.sort,
    view: input.view,
    page: input.page,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  await putScanSession(session);
  return session;
}

export async function migrateLegacySearchToSession(
  record: StoredSearch,
  scope: ScanScope = record.scanScope === "all" ? "all" : "recent"
): Promise<ScanSession> {
  const session = await ensureScanSession({
    url: record.url,
    matchType: record.matchType,
    mock: record.mock,
    scope
  });
  const target = await ensureTarget(record.url, record.matchType, record.mock);
  for (const result of record.results ?? []) {
    await upsertCoverageResult(target, result);
  }
  return session;
}

export async function findOrCreateLegacySession(url: string, matchType: MatchType, mock: boolean, scope: ScanScope) {
  const keys = [scanSearchKey(url, matchType, mock, scope), searchKey(url, matchType, mock), ...legacyScanSearchKeys(url, matchType, mock)];
  const records = (await Promise.all(keys.map((key) => getSearch(key))))
    .filter((record): record is StoredSearch => Boolean(record))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  if (records[0]) return migrateLegacySearchToSession(records[0], scope);
  return ensureScanSession({ url, matchType, mock, scope });
}

function notifyUpdated(key: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: "updated", key });
    channel.close();
  } catch {
    // BroadcastChannel may not be available in every environment.
  }
}

export function subscribeToSearch(key: string, onUpdate: () => void): () => void {
  return subscribeToSearchChanges(onUpdate, key);
}

export function subscribeToSearchChanges(onUpdate: () => void, key?: string): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (event.data?.type === "updated" && (!key || event.data.key === key)) onUpdate();
    };
  } catch {
    return () => {};
  }
  return () => channel?.close();
}

export async function getOrCreateLocalUser(): Promise<LocalUser> {
  const settings = await readSettings();
  const userId = settings?.activeUserId ?? DEFAULT_LOCAL_USER_ID;
  const existing = await getUser(userId);
  if (existing) {
    if (!settings) await writeSettings(defaultSettings(existing.userId));
    return existing;
  }
  const now = Date.now();
  const user: LocalUser = {
    userId,
    createdAt: now,
    updatedAt: now
  };
  await withStore(USER_STORE, "readwrite", (store) => {
    store.put(user);
  });
  if (!settings) await writeSettings(defaultSettings(user.userId));
  return user;
}

export async function updateLocalUser(input: { displayName?: string }): Promise<LocalUser> {
  const current = await getOrCreateLocalUser();
  const next: LocalUser = {
    ...current,
    displayName: input.displayName?.trim() || undefined,
    updatedAt: Date.now()
  };
  await withStore(USER_STORE, "readwrite", (store) => {
    store.put(next);
  });
  notifyUpdated(next.userId);
  return next;
}

export async function getSettings(): Promise<AppSettings> {
  await getOrCreateLocalUser();
  return (await readSettings()) ?? defaultSettings(DEFAULT_LOCAL_USER_ID);
}

export async function updateSettings(input: Partial<Pick<AppSettings, "htmlCacheEnabled" | "htmlCacheLimitBytes" | "autoPruneEnabled">>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    ...current,
    htmlCacheEnabled: input.htmlCacheEnabled ?? current.htmlCacheEnabled,
    htmlCacheLimitBytes: normalizeCacheLimit(input.htmlCacheLimitBytes ?? current.htmlCacheLimitBytes),
    autoPruneEnabled: input.autoPruneEnabled ?? current.autoPruneEnabled,
    updatedAt: Date.now()
  };
  await writeSettings(next);
  if (next.autoPruneEnabled && next.htmlCacheEnabled) await pruneHtmlCache(next.htmlCacheLimitBytes);
  notifyUpdated(SETTINGS_STORE);
  return next;
}

export async function resetSettings(): Promise<AppSettings> {
  const user = await getOrCreateLocalUser();
  const next = defaultSettings(user.userId);
  await writeSettings(next);
  notifyUpdated(SETTINGS_STORE);
  return next;
}

export function captureCacheKey(capture: Pick<CommonCrawlCapture, "filename" | "offset" | "length">): string {
  return `warc:${capture.filename}:${capture.offset}:${capture.length}`;
}

export async function getCachedCaptureRecord(
  capture: Pick<CommonCrawlCapture, "filename" | "offset" | "length">
): Promise<CachedHtmlCaptureRecord | undefined> {
  try {
    const ownerId = await activeOwnerId();
    const cacheKey = captureCacheKey(capture);
    const record = await withStore<CachedHtmlCaptureRecord>(HTML_CAPTURE_STORE, "readonly", (store) => store.get(cacheKey));
    if (!record || record.ownerId !== ownerId) return undefined;
    const next = { ...record, lastAccessedAt: Date.now() };
    await withStore(HTML_CAPTURE_STORE, "readwrite", (store) => {
      store.put(next);
    });
    return next;
  } catch {
    return undefined;
  }
}

export async function putCachedCaptureRecord(input: {
  capture: CommonCrawlCapture;
  record: Pick<CachedHtmlCaptureRecord, "warcHeaders" | "httpHeaders" | "statusLine" | "html">;
}): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.htmlCacheEnabled) return;
    const now = Date.now();
    const ownerId = settings.activeUserId;
    const cached: CachedHtmlCaptureRecord = {
      cacheKey: captureCacheKey(input.capture),
      ownerId,
      filename: input.capture.filename,
      offset: input.capture.offset,
      length: input.capture.length,
      url: input.capture.url,
      timestamp: input.capture.timestamp,
      collectionId: input.capture.collectionId,
      mime: input.capture.mime,
      status: input.capture.status,
      warcHeaders: input.record.warcHeaders,
      httpHeaders: input.record.httpHeaders,
      statusLine: input.record.statusLine,
      html: input.record.html,
      sizeBytes: byteSize(input.record.html),
      createdAt: now,
      lastAccessedAt: now
    };
    await withStore(HTML_CAPTURE_STORE, "readwrite", (store) => {
      store.put(cached);
    });
    if (settings.autoPruneEnabled) await pruneHtmlCache(settings.htmlCacheLimitBytes);
    notifyUpdated(cached.cacheKey);
  } catch {
    // Cache writes are best-effort.
  }
}

export async function listCachedCaptureRecordsForCaptures(
  captures: Pick<CommonCrawlCapture, "filename" | "offset" | "length">[]
): Promise<CachedHtmlCaptureRecord[]> {
  if (captures.length === 0) return [];
  try {
    const ownerId = await activeOwnerId();
    const keys = new Set(captures.map(captureCacheKey));
    const records = (await withStore<CachedHtmlCaptureRecord[]>(HTML_CAPTURE_STORE, "readonly", (store) => store.getAll())) ?? [];
    return records.filter((record) => record.ownerId === ownerId && keys.has(record.cacheKey));
  } catch {
    return [];
  }
}

export async function deleteCachedCapture(
  captureOrKey: Pick<CommonCrawlCapture, "filename" | "offset" | "length"> | string
): Promise<void> {
  try {
    const cacheKey = typeof captureOrKey === "string" ? captureOrKey : captureCacheKey(captureOrKey);
    await withStore(HTML_CAPTURE_STORE, "readwrite", (store) => {
      store.delete(cacheKey);
    });
    notifyUpdated(cacheKey);
  } catch {
    // Best-effort persistence.
  }
}

export async function deleteCachedCapturesForHistoryRecord(record: Pick<StoredSearch, "captures">): Promise<void> {
  await deleteCachedCaptures(record.captures);
}

export async function deleteCachedCaptures(captures: Pick<CommonCrawlCapture, "filename" | "offset" | "length">[]): Promise<void> {
  if (captures.length === 0) return;
  try {
    const keys = Array.from(new Set(captures.map(captureCacheKey)));
    await withStore(HTML_CAPTURE_STORE, "readwrite", (store) => {
      for (const key of keys) store.delete(key);
    });
    notifyUpdated(HTML_CAPTURE_STORE);
  } catch {
    // Best-effort persistence.
  }
}

export async function clearHtmlCache(): Promise<void> {
  try {
    await withStore(HTML_CAPTURE_STORE, "readwrite", (store) => {
      store.clear();
    });
    notifyUpdated(HTML_CAPTURE_STORE);
  } catch {
    // Best-effort persistence.
  }
}

export async function clearAllLocalAppData(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [LEGACY_SEARCH_STORE, TARGET_STORE, COVERAGE_STORE, SESSION_STORE, USER_STORE, SETTINGS_STORE, HTML_CAPTURE_STORE],
        "readwrite"
      );
      for (const storeName of tx.objectStoreNames) tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    await getOrCreateLocalUser();
    notifyUpdated("clear-all");
  } catch {
    // Best-effort persistence.
  }
}

export async function getCacheStats(): Promise<CacheStats> {
  try {
    const ownerId = await activeOwnerId();
    const records = (await withStore<CachedHtmlCaptureRecord[]>(HTML_CAPTURE_STORE, "readonly", (store) => store.getAll())) ?? [];
    return cacheStatsFor(records.filter((record) => record.ownerId === ownerId));
  } catch {
    return { count: 0, sizeBytes: 0 };
  }
}

export async function pruneHtmlCache(limitBytes?: number): Promise<void> {
  const limit = normalizeCacheLimit(limitBytes ?? (await getSettings()).htmlCacheLimitBytes);
  try {
    const ownerId = await activeOwnerId();
    const records = ((await withStore<CachedHtmlCaptureRecord[]>(HTML_CAPTURE_STORE, "readonly", (store) => store.getAll())) ?? [])
      .filter((record) => record.ownerId === ownerId)
      .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
    let size = records.reduce((sum, record) => sum + record.sizeBytes, 0);
    const deleteKeys: string[] = [];
    for (const record of records) {
      if (size <= limit) break;
      deleteKeys.push(record.cacheKey);
      size -= record.sizeBytes;
    }
    if (deleteKeys.length === 0) return;
    await withStore(HTML_CAPTURE_STORE, "readwrite", (store) => {
      for (const key of deleteKeys) store.delete(key);
    });
    notifyUpdated(HTML_CAPTURE_STORE);
  } catch {
    // Best-effort pruning.
  }
}

async function getUser(userId: string): Promise<LocalUser | undefined> {
  try {
    return await withStore<LocalUser>(USER_STORE, "readonly", (store) => store.get(userId));
  } catch {
    return undefined;
  }
}

async function readSettings(): Promise<AppSettings | undefined> {
  try {
    return await withStore<AppSettings>(SETTINGS_STORE, "readonly", (store) => store.get(ACTIVE_SETTINGS_ID));
  } catch {
    return undefined;
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await withStore(SETTINGS_STORE, "readwrite", (store) => {
    store.put(settings);
  });
}

async function activeOwnerId(): Promise<string> {
  return (await getOrCreateLocalUser()).userId;
}

function defaultSettings(activeUserId: string): AppSettings {
  return {
    id: ACTIVE_SETTINGS_ID,
    activeUserId,
    htmlCacheEnabled: true,
    htmlCacheLimitBytes: DEFAULT_HTML_CACHE_LIMIT_BYTES,
    autoPruneEnabled: true,
    updatedAt: Date.now()
  };
}

function withOwner<T extends { ownerId?: string }>(record: T | undefined, ownerId = DEFAULT_LOCAL_USER_ID): T | undefined {
  return record ? { ...record, ownerId: record.ownerId ?? ownerId } : undefined;
}

function normalizeCacheLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_HTML_CACHE_LIMIT_BYTES;
  return Math.max(5 * 1024 * 1024, Math.round(value));
}

function byteSize(value: string): number {
  if (typeof Blob !== "undefined") return new Blob([value]).size;
  return value.length;
}

function cacheStatsFor(records: CachedHtmlCaptureRecord[]): CacheStats {
  const lastAccessedAt = records.reduce<number | undefined>(
    (latest, record) => latest === undefined ? record.lastAccessedAt : Math.max(latest, record.lastAccessedAt),
    undefined
  );
  return {
    count: records.length,
    sizeBytes: records.reduce((sum, record) => sum + record.sizeBytes, 0),
    lastAccessedAt
  };
}
