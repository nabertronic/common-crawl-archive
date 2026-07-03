import type { CollectionCheckResult, CommonCrawlCapture, CommonCrawlCollection, MatchType, ScanLogEntry } from "./common-crawl";
import { dedupeCaptures, mergeCollectionResult, mergeCollectionResults } from "./scan-results";

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
export const DEFAULT_SEARCH_PAGE_SIZE = 100;
export const DEFAULT_HISTORY_PAGE_SIZE = 25;
export const DEFAULT_LARGE_CAPTURE_LIMIT_BYTES = 15 * 1024 * 1024;

export type AppViewMode = "list" | "calendar";
export type AppCaptureColumnKey =
  | "url"
  | "timestamp"
  | "collection"
  | "status"
  | "mime"
  | "digest"
  | "warcUrl"
  | "warcPosition";

export const DEFAULT_CAPTURE_EXPORT_COLUMNS: AppCaptureColumnKey[] = [
  "url",
  "timestamp",
  "collection",
  "status",
  "mime",
  "digest",
  "warcUrl",
  "warcPosition"
];

export const DEFAULT_CAPTURE_SORT = "timestamp-desc";

export type ScanScope = "recent" | "all" | "custom";

export type StoredSearch = {
  key: string;
  ownerId?: string;
  url: string;
  matchType: MatchType;
  mock: boolean;
  captures: CommonCrawlCapture[];
  scanScope?: ScanScope;
  dateFrom?: string;
  dateTo?: string;
  collections?: CommonCrawlCollection[];
  collectionIds?: string[];
  collectionListFetchedAt?: number;
  scanWindowFrom?: string;
  scanWindowTo?: string;
  results?: CollectionCheckResult[];
  scanLogResults?: ScanLogEntry[];
  durationMs?: number;
  activeScanStartedAt?: number;
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
  scanLogResults?: ScanLogEntry[];
  collectionIds?: string[];
  collectionListFetchedAt?: number;
  scanWindowFrom?: string;
  scanWindowTo?: string;
  // Accumulated active scanning time across all runs, so a scan reopened from
  // history can show how long the run actually took instead of 0:00.
  durationMs?: number;
  activeScanStartedAt?: number;
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
  dateFrom?: string;
  dateTo?: string;
  collectionIds?: string[];
  collectionListFetchedAt?: number;
  scanWindowFrom?: string;
  scanWindowTo?: string;
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
  showHtmlPrivacyWarning: boolean;
  defaultMatchType: MatchType;
  defaultScanScope: ScanScope;
  defaultCustomDateFrom?: string;
  defaultCustomDateTo?: string;
  defaultViewMode: AppViewMode;
  defaultSort: string;
  searchPageSize: number;
  historyPageSize: number;
  defaultExportColumns: AppCaptureColumnKey[];
  largeCaptureLimitBytes: number;
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
  scope: ScanScope,
  options?: { dateFrom?: string; dateTo?: string }
): string {
  if (scope === "custom") {
    const rangeKey = `${options?.dateFrom ?? ""}:${options?.dateTo ?? ""}`;
    return `${searchKey(url, matchType, mock)}:scan:${scope}:${rangeKey}`;
  }
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
  if (scope === "custom") return `${searchKey(url, matchType, mock)}:${scope}`;
  return `${searchKey(url, matchType, mock)}:${scope}`;
}

export function legacyScanSearchKeys(url: string, matchType: MatchType | string, mock: boolean): string[] {
  return [
    legacyUnscopedScanSearchKey(url, matchType, mock),
    legacyScanSearchKey(url, matchType, mock, "recent"),
    legacyScanSearchKey(url, matchType, mock, "all")
  ];
}

// Older app versions persisted the raw search input ("hutt.io") while newer
// ones normalize it ("https://hutt.io/") before storing. Every URL comparison
// and target hash must go through this normalization, otherwise records saved
// before the change can no longer be matched to their target.
export function normalizeScanUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  try {
    const parsed = new URL(hasExplicitScheme ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return trimmed;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function normalizeTargetUrl(url: string): string {
  return normalizeScanUrl(url);
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
    scanLogResults: existing?.scanLogResults,
    collectionIds: existing?.collectionIds,
    collectionListFetchedAt: existing?.collectionListFetchedAt,
    scanWindowFrom: existing?.scanWindowFrom,
    scanWindowTo: existing?.scanWindowTo,
    durationMs: existing?.durationMs,
    activeScanStartedAt: existing?.activeScanStartedAt,
    updatedAt: Date.now()
  };
  await putCoverage(next);
  return next;
}

export async function appendCoverageScanLogEntry(
  target: Pick<SearchTarget, "targetId" | "ownerId" | "url" | "matchType" | "mock">,
  entry: ScanLogEntry
): Promise<CoverageRecord> {
  const existing = await getCoverage(target.targetId);
  const next: CoverageRecord = {
    targetId: target.targetId,
    ownerId: existing?.ownerId ?? target.ownerId ?? await activeOwnerId(),
    url: target.url,
    matchType: target.matchType,
    mock: target.mock,
    collectionResults: existing?.collectionResults ?? {},
    scanLogResults: [...(existing?.scanLogResults ?? coverageResults(existing)), entry],
    collectionIds: existing?.collectionIds,
    collectionListFetchedAt: existing?.collectionListFetchedAt,
    scanWindowFrom: existing?.scanWindowFrom,
    scanWindowTo: existing?.scanWindowTo,
    durationMs: existing?.durationMs,
    activeScanStartedAt: existing?.activeScanStartedAt,
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
    activeScanStartedAt: undefined,
    updatedAt: Date.now()
  });
}

export async function startCoverageRun(
  target: Pick<SearchTarget, "targetId" | "ownerId" | "url" | "matchType" | "mock">,
  startedAt: number,
  durationMs: number,
  metadata: Pick<CoverageRecord, "collectionIds" | "collectionListFetchedAt" | "scanWindowFrom" | "scanWindowTo"> = {}
): Promise<void> {
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs < 0) return;
  const existing = await getCoverage(target.targetId);
  await putCoverage({
    targetId: target.targetId,
    ownerId: existing?.ownerId ?? target.ownerId ?? await activeOwnerId(),
    url: target.url,
    matchType: target.matchType,
    mock: target.mock,
    collectionResults: existing?.collectionResults ?? {},
    scanLogResults: existing?.scanLogResults,
    collectionIds: metadata.collectionIds ?? existing?.collectionIds,
    collectionListFetchedAt: metadata.collectionListFetchedAt ?? existing?.collectionListFetchedAt,
    scanWindowFrom: metadata.scanWindowFrom ?? existing?.scanWindowFrom,
    scanWindowTo: metadata.scanWindowTo ?? existing?.scanWindowTo,
    durationMs: Math.round(durationMs),
    activeScanStartedAt: Math.round(startedAt),
    updatedAt: Date.now()
  });
}

export function coverageDurationMs(record: CoverageRecord | undefined, now = Date.now()): number {
  const storedDuration = record?.durationMs ?? 0;
  const activeSegment = record?.activeScanStartedAt ? Math.max(0, now - record.activeScanStartedAt) : 0;
  return storedDuration + activeSegment;
}

export function scanLogDurationMs(entries: ScanLogEntry[] | undefined): number {
  const timestamps = (entries ?? []).flatMap((entry) => {
    if ("kind" in entry) return [entry.checkedAt];
    return entry.attemptLogs?.length
      ? entry.attemptLogs.map((attempt) => attempt.checkedAt ?? entry.checkedAt)
      : [entry.checkedAt];
  }).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (timestamps.length < 2) return 0;
  return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
}

export function coverageResults(record: CoverageRecord | undefined): CollectionCheckResult[] {
  return Object.values(record?.collectionResults ?? {}).map((result) => ({
    ...result,
    checkedAt: result.checkedAt ?? record?.updatedAt
  }));
}

export function coverageScanLogResults(record: CoverageRecord | undefined): ScanLogEntry[] {
  if (!record?.scanLogResults?.length) return coverageResults(record);
  return record.scanLogResults.map((result) => ("kind" in result
    ? { ...result, checkedAt: result.checkedAt ?? record.updatedAt }
    : { ...result, checkedAt: result.checkedAt ?? record.updatedAt }
  ));
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
  dateFrom?: string;
  dateTo?: string;
  collectionIds?: string[];
  collectionListFetchedAt?: number;
  scanWindowFrom?: string;
  scanWindowTo?: string;
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
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    collectionIds: input.collectionIds ?? existing?.collectionIds,
    collectionListFetchedAt: input.collectionListFetchedAt ?? existing?.collectionListFetchedAt,
    scanWindowFrom: input.scanWindowFrom ?? existing?.scanWindowFrom,
    scanWindowTo: input.scanWindowTo ?? existing?.scanWindowTo,
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
  const storedResults = resultsForLegacyRecord(record);
  const collectionIds =
    record.collectionIds ??
    record.collections?.map((collection) => collection.id) ??
    Array.from(new Set(storedResults.map((result) => result.collection.id)));
  const session = await ensureScanSession({
    url: record.url,
    matchType: record.matchType,
    mock: record.mock,
    scope,
    dateFrom: record.dateFrom,
    dateTo: record.dateTo,
    collectionIds,
    collectionListFetchedAt: record.collectionListFetchedAt,
    scanWindowFrom: record.scanWindowFrom,
    scanWindowTo: record.scanWindowTo
  });
  const target = await ensureTarget(record.url, record.matchType, record.mock);
  const storedScanLog = record.scanLogResults ?? record.results;
  for (const result of storedResults) {
    await upsertCoverageResult(target, result);
  }
  const existing = await getCoverage(target.targetId);
  const inferredDurationMs = scanLogDurationMs(storedScanLog);
  await putCoverage({
    targetId: target.targetId,
    ownerId: existing?.ownerId ?? target.ownerId,
    url: target.url,
    matchType: target.matchType,
    mock: target.mock,
    collectionResults: existing?.collectionResults ?? {},
    scanLogResults: existing?.scanLogResults?.length ? existing.scanLogResults : storedScanLog,
    collectionIds: record.collectionIds ?? existing?.collectionIds,
    collectionListFetchedAt: record.collectionListFetchedAt ?? existing?.collectionListFetchedAt,
    scanWindowFrom: record.scanWindowFrom ?? existing?.scanWindowFrom,
    scanWindowTo: record.scanWindowTo ?? existing?.scanWindowTo,
    durationMs: record.durationMs ?? existing?.durationMs ?? inferredDurationMs,
    activeScanStartedAt: record.activeScanStartedAt ?? existing?.activeScanStartedAt,
    updatedAt: Date.now()
  });
  return session;
}

function resultsForLegacyRecord(record: StoredSearch): CollectionCheckResult[] {
  const storedScanLog = record.scanLogResults ?? record.results;
  const storedResults = record.results ?? storedScanLog?.filter((entry): entry is CollectionCheckResult => !("kind" in entry)) ?? [];
  const resultIds = new Set(storedResults.map((result) => result.collection.id));
  const collectionsById = new Map((record.collections ?? []).map((collection) => [collection.id, collection]));
  const capturesByCollection = new Map<string, CommonCrawlCapture[]>();
  for (const capture of record.captures) {
    if (resultIds.has(capture.collectionId)) continue;
    const captures = capturesByCollection.get(capture.collectionId);
    if (captures) captures.push(capture);
    else capturesByCollection.set(capture.collectionId, [capture]);
  }
  const synthesizedResults = Array.from(capturesByCollection, ([collectionId, captures]) => {
    const firstCapture = captures[0];
    return {
      collection: collectionsById.get(collectionId) ?? {
        id: collectionId,
        name: firstCapture?.collectionName ?? collectionId,
        cdxApi: "",
        from: firstCapture?.collectionFrom ?? "",
        to: firstCapture?.collectionTo ?? ""
      },
      status: "checked" as const,
      captures,
      checkedAt: record.updatedAt,
      httpStatus: 200,
      attempts: 1,
      runs: 1,
      fromCache: true
    };
  });
  return [...storedResults, ...synthesizedResults];
}

export function mergeStoredSearchRecords(records: StoredSearch[]): StoredSearch | undefined {
  if (records.length === 0) return undefined;
  const [first, ...rest] = records;
  const coverageAnchor = records.reduce((best, record) =>
    storedCoverageScore(record) > storedCoverageScore(best) ? record : best
  , first);
  return rest.reduce<StoredSearch>((merged, record) => ({
    ...merged,
    captures: dedupeCaptures([...merged.captures, ...record.captures]),
    collections: mergeCollectionsById(merged.collections, record.collections),
    collectionIds: coverageAnchor.collectionIds ?? coverageAnchor.collections?.map((collection) => collection.id),
    collectionListFetchedAt: Math.max(merged.collectionListFetchedAt ?? 0, record.collectionListFetchedAt ?? 0) || undefined,
    scanWindowFrom: coverageAnchor.scanWindowFrom ?? merged.scanWindowFrom ?? record.scanWindowFrom,
    scanWindowTo: coverageAnchor.scanWindowTo ?? merged.scanWindowTo ?? record.scanWindowTo,
    results: mergeCollectionResults(resultsForLegacyRecord(merged), resultsForLegacyRecord(record)),
    scanLogResults: [...(merged.scanLogResults ?? merged.results ?? []), ...(record.scanLogResults ?? record.results ?? [])],
    durationMs: Math.max(merged.durationMs ?? 0, record.durationMs ?? 0) || undefined,
    activeScanStartedAt: merged.activeScanStartedAt ?? record.activeScanStartedAt,
    updatedAt: Math.max(merged.updatedAt, record.updatedAt)
  }), {
    ...first,
    collectionIds: coverageAnchor.collectionIds ?? coverageAnchor.collections?.map((collection) => collection.id),
    scanWindowFrom: coverageAnchor.scanWindowFrom ?? first.scanWindowFrom,
    scanWindowTo: coverageAnchor.scanWindowTo ?? first.scanWindowTo,
    results: resultsForLegacyRecord(first)
  });
}

function storedCoverageScore(record: StoredSearch) {
  return resultsForLegacyRecord(record).filter((result) => result.status === "checked").length;
}

function mergeCollectionsById(
  left: CommonCrawlCollection[] | undefined,
  right: CommonCrawlCollection[] | undefined
) {
  const byId = new Map<string, CommonCrawlCollection>();
  for (const collection of [...(left ?? []), ...(right ?? [])]) {
    byId.set(collection.id, collection);
  }
  return byId.size > 0 ? Array.from(byId.values()) : undefined;
}

// Move a record stored under a pre-normalization URL ("hutt.io") onto its
// canonical key/URL so future lookups find it directly. If a record already
// exists at the canonical key (e.g. junk left behind by a run that could not
// see the legacy record), merge the two instead of dropping either side.
async function rekeyLegacyRecord(
  record: StoredSearch,
  canonicalUrl: string,
  fallbackScope: ScanScope
): Promise<StoredSearch> {
  if (record.url === canonicalUrl) return record;
  const canonicalKey = record.key === searchKey(record.url, record.matchType, record.mock)
    ? searchKey(canonicalUrl, record.matchType, record.mock)
    : scanSearchKey(canonicalUrl, record.matchType, record.mock, record.scanScope ?? fallbackScope, {
        dateFrom: record.dateFrom,
        dateTo: record.dateTo
      });
  const existing = await getSearch(canonicalKey);
  const merged = existing ? mergeStoredSearchRecords([record, existing]) ?? record : record;
  const healed: StoredSearch = { ...merged, key: canonicalKey, url: canonicalUrl };
  await putSearch(healed);
  if (record.key !== canonicalKey) await deleteSearch(record.key);
  return healed;
}

export async function findOrCreateLegacySession(
  url: string,
  matchType: MatchType,
  mock: boolean,
  scope: ScanScope,
  options?: { dateFrom?: string; dateTo?: string; savedKey?: string }
) {
  const canonicalUrl = normalizeScanUrl(url);
  const matchesTarget = (record: StoredSearch) =>
    normalizeScanUrl(record.url) === canonicalUrl && record.matchType === matchType && record.mock === mock;
  const migrateRecords = async (records: StoredSearch[]) => {
    const healedRecords: StoredSearch[] = [];
    for (const record of records) {
      healedRecords.push(await rekeyLegacyRecord(record, canonicalUrl, scope));
    }
    const merged = mergeStoredSearchRecords(healedRecords);
    return merged ? migrateLegacySearchToSession(merged, scope) : undefined;
  };

  const savedKeys = options?.savedKey?.split(",").map((key) => key.trim()).filter(Boolean) ?? [];
  const savedRecords = (await Promise.all(savedKeys.map((key) => getSearch(key))))
    .filter((record): record is StoredSearch => record !== undefined && matchesTarget(record));
  const savedSession = await migrateRecords(savedRecords);
  if (savedSession) return savedSession;

  const scopedKeys = [
    scanSearchKey(canonicalUrl, matchType, mock, scope, options),
    ...legacyScanSearchKeys(canonicalUrl, matchType, mock)
  ];
  const scopedRecords = (await Promise.all(scopedKeys.map((key) => getSearch(key))))
    .filter((record): record is StoredSearch => Boolean(record))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  if (scopedRecords[0]) return migrateLegacySearchToSession(scopedRecords[0], scope);
  const genericRecord = await getSearch(searchKey(canonicalUrl, matchType, mock));
  if (genericRecord) return migrateLegacySearchToSession(genericRecord, scope);

  // Key-based lookups only see canonical keys; records saved by older app
  // versions sit under raw-input keys and are only reachable by scanning.
  const legacyCandidates = (await listSearches()).filter(matchesTarget);
  const preferredCandidates = legacyCandidates.filter((record) => (record.scanScope ?? "recent") === scope);
  const legacySession = await migrateRecords(preferredCandidates.length > 0 ? preferredCandidates : legacyCandidates);
  if (legacySession) return legacySession;

  return ensureScanSession({ url: canonicalUrl, matchType, mock, scope, dateFrom: options?.dateFrom, dateTo: options?.dateTo });
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
  return normalizeSettings((await readSettings()) ?? defaultSettings(DEFAULT_LOCAL_USER_ID));
}

export async function updateSettings(
  input: Partial<Pick<
    AppSettings,
    | "htmlCacheEnabled"
    | "htmlCacheLimitBytes"
    | "autoPruneEnabled"
    | "showHtmlPrivacyWarning"
    | "defaultMatchType"
    | "defaultScanScope"
    | "defaultCustomDateFrom"
    | "defaultCustomDateTo"
    | "defaultViewMode"
    | "defaultSort"
    | "searchPageSize"
    | "historyPageSize"
    | "defaultExportColumns"
    | "largeCaptureLimitBytes"
  >>
): Promise<AppSettings> {
  const current = await getSettings();
  const next = normalizeSettings({
    ...current,
    htmlCacheEnabled: input.htmlCacheEnabled ?? current.htmlCacheEnabled,
    htmlCacheLimitBytes: normalizeCacheLimit(input.htmlCacheLimitBytes ?? current.htmlCacheLimitBytes),
    autoPruneEnabled: input.autoPruneEnabled ?? current.autoPruneEnabled,
    showHtmlPrivacyWarning: input.showHtmlPrivacyWarning ?? current.showHtmlPrivacyWarning ?? true,
    defaultMatchType: input.defaultMatchType ?? current.defaultMatchType,
    defaultScanScope: input.defaultScanScope ?? current.defaultScanScope,
    defaultCustomDateFrom: input.defaultCustomDateFrom ?? current.defaultCustomDateFrom,
    defaultCustomDateTo: input.defaultCustomDateTo ?? current.defaultCustomDateTo,
    defaultViewMode: input.defaultViewMode ?? current.defaultViewMode,
    defaultSort: input.defaultSort ?? current.defaultSort,
    searchPageSize: input.searchPageSize ?? current.searchPageSize,
    historyPageSize: input.historyPageSize ?? current.historyPageSize,
    defaultExportColumns: input.defaultExportColumns ?? current.defaultExportColumns,
    largeCaptureLimitBytes: input.largeCaptureLimitBytes ?? current.largeCaptureLimitBytes,
    updatedAt: Date.now()
  });
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
    showHtmlPrivacyWarning: true,
    defaultMatchType: "exact",
    defaultScanScope: "recent",
    defaultViewMode: "list",
    defaultSort: DEFAULT_CAPTURE_SORT,
    searchPageSize: DEFAULT_SEARCH_PAGE_SIZE,
    historyPageSize: DEFAULT_HISTORY_PAGE_SIZE,
    defaultExportColumns: DEFAULT_CAPTURE_EXPORT_COLUMNS,
    largeCaptureLimitBytes: DEFAULT_LARGE_CAPTURE_LIMIT_BYTES,
    updatedAt: Date.now()
  };
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const normalizedScope = normalizeScanScope(settings.defaultScanScope);
  const normalizedDateFrom = normalizeDateSetting(settings.defaultCustomDateFrom);
  const normalizedDateTo = normalizeDateSetting(settings.defaultCustomDateTo);
  return {
    ...settings,
    showHtmlPrivacyWarning: settings.showHtmlPrivacyWarning ?? true,
    defaultMatchType: normalizeMatchType(settings.defaultMatchType),
    defaultScanScope: normalizedScope,
    defaultCustomDateFrom: normalizedScope === "custom" ? normalizedDateFrom : undefined,
    defaultCustomDateTo: normalizedScope === "custom" ? normalizedDateTo : undefined,
    defaultViewMode: settings.defaultViewMode === "calendar" ? "calendar" : "list",
    defaultSort: normalizeSortSetting(settings.defaultSort),
    searchPageSize: normalizePageSize(settings.searchPageSize, DEFAULT_SEARCH_PAGE_SIZE, 25, 500),
    historyPageSize: normalizePageSize(settings.historyPageSize, DEFAULT_HISTORY_PAGE_SIZE, 10, 100),
    defaultExportColumns: normalizeExportColumns(settings.defaultExportColumns),
    largeCaptureLimitBytes: normalizeLargeCaptureLimit(settings.largeCaptureLimitBytes)
  };
}

function normalizeMatchType(value: unknown): MatchType {
  return value === "host" || value === "domain" || value === "exact" ? value : "exact";
}

function normalizeScanScope(value: unknown): ScanScope {
  return value === "all" || value === "custom" || value === "recent" ? value : "recent";
}

function normalizeDateSetting(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function normalizeSortSetting(value: unknown): string {
  if (
    value === "timestamp-asc" ||
    value === "timestamp-desc" ||
    value === "url-asc" ||
    value === "url-desc" ||
    value === "status-asc" ||
    value === "status-desc" ||
    value === "collection-asc" ||
    value === "collection-desc" ||
    value === "size-asc" ||
    value === "size-desc"
  ) {
    return value;
  }
  return DEFAULT_CAPTURE_SORT;
}

function normalizePageSize(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeExportColumns(value: unknown): AppCaptureColumnKey[] {
  const valid = new Set<AppCaptureColumnKey>([
    "url",
    "timestamp",
    "collection",
    "status",
    "mime",
    "digest",
    "warcUrl",
    "warcPosition"
  ]);
  if (!Array.isArray(value)) return DEFAULT_CAPTURE_EXPORT_COLUMNS;
  const columns = value.filter((item): item is AppCaptureColumnKey => valid.has(item as AppCaptureColumnKey));
  return columns.length > 0 ? Array.from(new Set(columns)) : DEFAULT_CAPTURE_EXPORT_COLUMNS;
}

function normalizeLargeCaptureLimit(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_LARGE_CAPTURE_LIMIT_BYTES;
  return Math.min(500 * 1024 * 1024, Math.max(1 * 1024 * 1024, Math.round(numeric)));
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
