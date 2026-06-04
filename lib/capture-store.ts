import type { CollectionCheckResult, CommonCrawlCapture, CommonCrawlCollection, MatchType } from "./common-crawl";
import { dedupeCaptures, mergeCollectionResult } from "./scan-results";

const DB_NAME = "wayback-fallback";
const DB_VERSION = 2;
const LEGACY_SEARCH_STORE = "searches";
const TARGET_STORE = "targets";
const COVERAGE_STORE = "coverages";
const SESSION_STORE = "scanSessions";
const CHANNEL_NAME = "wayback-fallback:searches";

export type ScanScope = "recent" | "all";

export type StoredSearch = {
  key: string;
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
  url: string;
  matchType: MatchType;
  mock: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CoverageRecord = {
  targetId: string;
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
    await withStore(LEGACY_SEARCH_STORE, "readwrite", (store) => {
      store.put(record);
    });
    notifyUpdated(record.key);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function getSearch(key: string): Promise<StoredSearch | undefined> {
  try {
    return await withStore<StoredSearch>(LEGACY_SEARCH_STORE, "readonly", (store) => store.get(key));
  } catch {
    return undefined;
  }
}

export async function listSearches(): Promise<StoredSearch[]> {
  try {
    return (await withStore<StoredSearch[]>(LEGACY_SEARCH_STORE, "readonly", (store) => store.getAll())) ?? [];
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
  const next: SearchTarget = {
    targetId,
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
    return await withStore<SearchTarget>(TARGET_STORE, "readonly", (store) => store.get(targetId));
  } catch {
    return undefined;
  }
}

export async function putTarget(target: SearchTarget): Promise<void> {
  try {
    await withStore(TARGET_STORE, "readwrite", (store) => {
      store.put(target);
    });
    notifyUpdated(target.targetId);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function getCoverage(targetId: string): Promise<CoverageRecord | undefined> {
  try {
    return await withStore<CoverageRecord>(COVERAGE_STORE, "readonly", (store) => store.get(targetId));
  } catch {
    return undefined;
  }
}

export async function putCoverage(record: CoverageRecord): Promise<void> {
  try {
    await withStore(COVERAGE_STORE, "readwrite", (store) => {
      store.put(record);
    });
    notifyUpdated(record.targetId);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function upsertCoverageResult(
  target: Pick<SearchTarget, "targetId" | "url" | "matchType" | "mock">,
  result: CollectionCheckResult
): Promise<CoverageRecord> {
  const existing = await getCoverage(target.targetId);
  const merged = mergeCollectionResult(existing?.collectionResults[result.collection.id], result);
  const next: CoverageRecord = {
    targetId: target.targetId,
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
    return await withStore<ScanSession>(SESSION_STORE, "readonly", (store) => store.get(scanId));
  } catch {
    return undefined;
  }
}

export async function putScanSession(session: ScanSession): Promise<void> {
  try {
    await withStore(SESSION_STORE, "readwrite", (store) => {
      store.put(session);
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
  const session: ScanSession = {
    scanId: existing?.scanId ?? input.scanId ?? newScanId(),
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
