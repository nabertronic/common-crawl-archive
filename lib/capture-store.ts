import { shouldPersistScanLogEntry } from "./common-crawl";
import type { CollectionCheckResult, CommonCrawlCapture, CommonCrawlCollection, MatchType, ScanLogEntry } from "./common-crawl";
import { markPerformance, measureAsync, measurePerformance } from "./performance";
import { dedupeCaptures, mergeCollectionResult, mergeCollectionResults } from "./scan-results";
import { hasStorageConsent, requireStorageConsent, subscribeStorageConsent } from "./website-preferences";

const DB_NAME = "wayback-fallback";
const DB_VERSION = 6;
const LEGACY_SEARCH_STORE = "searches";
const HISTORY_SUMMARY_STORE = "historySummaries";
const TARGET_STORE = "targets";
const COVERAGE_STORE = "coverages";
const SESSION_STORE = "scanSessions";
const USER_STORE = "users";
const SETTINGS_STORE = "settings";
const HTML_CAPTURE_STORE = "htmlCaptures";
const HTML_CAPTURE_META_STORE = "htmlCaptureMeta";
const CHANNEL_NAME = "wayback-fallback:searches";
const DEFAULT_LOCAL_USER_ID = "local";
const ACTIVE_SETTINGS_ID = "active";
// Stored in the settings store under a dedicated id so migration progress
// survives reloads without polluting the AppSettings record (which is rebuilt
// field-by-field in normalizeSettings and would drop unknown keys).
const MIGRATIONS_ID = "migrations";
const OWNER_BACKFILL_BATCH_SIZE = 100;
export const DEFAULT_HTML_CACHE_LIMIT_BYTES = 500 * 1024 * 1024;
export const DEFAULT_SEARCH_PAGE_SIZE = 100;
export const DEFAULT_HISTORY_PAGE_SIZE = 25;
export const DEFAULT_LARGE_CAPTURE_LIMIT_BYTES = 15 * 1024 * 1024;
export const DEFAULT_SCAN_SCOPE: ScanScope = "all";

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

export type HistorySummaryRecord = {
  key: string;
  ownerId?: string;
  url: string;
  matchType: MatchType;
  mock: boolean;
  scanScope: ScanScope;
  dateFrom?: string;
  dateTo?: string;
  collections?: CommonCrawlCollection[];
  collectionIds?: string[];
  collectionListFetchedAt?: number;
  scanWindowFrom?: string;
  scanWindowTo?: string;
  captureCount: number;
  captureKeys: string[];
  sourceTotal: number;
  sourceProcessed: number;
  failedCount: number;
  durationMs?: number;
  activeScanStartedAt?: number;
  updatedAt: number;
  storageKeys?: string[];
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
  robotsTxtChecksEnabled: boolean;
  defaultMatchType: MatchType;
  defaultScanScope: ScanScope;
  /** True once the user picks a scope in settings; untouched records use DEFAULT_SCAN_SCOPE. */
  defaultScanScopeChosen?: boolean;
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

export type CachedHtmlCaptureMetaRecord = Pick<
  CachedHtmlCaptureRecord,
  "cacheKey" | "ownerId" | "filename" | "offset" | "length" | "url" | "timestamp" | "collectionId" | "mime" | "status" | "sizeBytes" | "createdAt" | "lastAccessedAt"
>;

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

// A single cached connection is shared across all transactions instead of
// opening/closing the database on every access. Opening IndexedDB is not free,
// and the previous open-per-call pattern showed up as dozens of `indexeddb-open`
// marks in a single session. The connection is released back to the cache (not
// closed) after each transaction; it is only truly closed on version change
// (another tab upgrading) or an unexpected close, which resets the cache so the
// next call reopens cleanly.
let cachedDbPromise: Promise<IDBDatabase> | undefined;
const activeTransactions = new Set<IDBTransaction>();
const CONSENT_REQUIRED = new Error("Allow browser storage before using saved app data");

function assertStorageConsent(): void {
  if (!requireStorageConsent()) throw CONSENT_REQUIRED;
}

function trackTransaction(tx: IDBTransaction): IDBTransaction {
  activeTransactions.add(tx);
  const remove = () => activeTransactions.delete(tx);
  tx.addEventListener("complete", remove, { once: true });
  tx.addEventListener("abort", remove, { once: true });
  tx.addEventListener("error", remove, { once: true });
  return tx;
}

function openTransaction(db: IDBDatabase, stores: string | string[], mode?: IDBTransactionMode): IDBTransaction {
  assertStorageConsent();
  return trackTransaction(db.transaction(stores, mode));
}

subscribeStorageConsent(() => {
  if (hasStorageConsent()) return;
  cachedSettings = undefined;
  cachedLocalUser = undefined;
  for (const tx of activeTransactions) { try { tx.abort(); } catch { /* It may already be complete. */ } }
  activeTransactions.clear();
  const pending = cachedDbPromise;
  cachedDbPromise = undefined;
  if (pending) void pending.then((db) => db.close()).catch(() => undefined);
});

function releaseDb(_db: IDBDatabase): void {
  // No-op: the connection is pooled in `cachedDbPromise` and stays open for reuse.
}

function resetDbCache(db: IDBDatabase): void {
  if (cachedDbPromise) {
    // Only clear the cache if it still points at this (now-dead) connection.
    void cachedDbPromise.then((current) => {
      if (current === db) cachedDbPromise = undefined;
    });
  }
}

function openDB(): Promise<IDBDatabase> {
  assertStorageConsent();
  if (cachedDbPromise) return cachedDbPromise;
  cachedDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      cachedDbPromise = undefined;
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const startMark = `indexeddb-open:start:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    markPerformance(startMark);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const upgradeStart = `indexeddb-upgrade:start:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      markPerformance(upgradeStart);
      const db = req.result;
      const upgradeTx = req.transaction;
      if (upgradeTx) trackTransaction(upgradeTx);
      if (!hasStorageConsent()) {
        upgradeTx?.abort();
        db.close();
        cachedDbPromise = undefined;
        reject(CONSENT_REQUIRED);
        return;
      }
      // Return the store whether it already exists (upgrade) or must be created
      // (fresh DB), so indexes can be attached in the same versionchange tx.
      const ensureStore = (name: string, options: IDBObjectStoreParameters): IDBObjectStore | undefined => {
        if (db.objectStoreNames.contains(name)) return upgradeTx?.objectStore(name);
        return db.createObjectStore(name, options);
      };
      const ensureIndex = (store: IDBObjectStore | undefined, name: string, keyPath: string | string[]) => {
        if (store && !store.indexNames.contains(name)) store.createIndex(name, keyPath);
      };

      // Only stores that are read via getAll() get an ownerId index; the rest are
      // always accessed by primary key, where an index would just cost writes.
      const searchStore = ensureStore(LEGACY_SEARCH_STORE, { keyPath: "key" });
      ensureIndex(searchStore, "ownerId", "ownerId");
      const summaryStore = ensureStore(HISTORY_SUMMARY_STORE, { keyPath: "key" });
      ensureIndex(summaryStore, "ownerId", "ownerId");
      ensureIndex(summaryStore, "owner_updatedAt", ["ownerId", "updatedAt"]);

      ensureStore(TARGET_STORE, { keyPath: "targetId" });
      ensureStore(COVERAGE_STORE, { keyPath: "targetId" });
      ensureStore(SESSION_STORE, { keyPath: "scanId" });
      ensureStore(USER_STORE, { keyPath: "userId" });
      ensureStore(SETTINGS_STORE, { keyPath: "id" });
      ensureStore(HTML_CAPTURE_STORE, { keyPath: "cacheKey" });
      ensureStore(HTML_CAPTURE_META_STORE, { keyPath: "cacheKey" });
      measurePerformance("indexeddb-upgrade", upgradeStart, { version: DB_VERSION });
    };
    req.onsuccess = () => {
      measurePerformance("indexeddb-open", startMark, { version: DB_VERSION });
      const db = req.result;
      // Close on cross-tab upgrade so we never block another tab's versionchange,
      // and drop closed connections from the cache so the next call reopens.
      db.onversionchange = () => {
        db.close();
        resetDbCache(db);
      };
      db.onclose = () => {
        resetDbCache(db);
      };
      resolve(db);
    };
    req.onerror = () => {
      measurePerformance("indexeddb-open", startMark, { version: DB_VERSION });
      cachedDbPromise = undefined;
      reject(req.error ?? new Error("IndexedDB open failed"));
    };
  });
  return cachedDbPromise;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  task: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = openTransaction(db, storeName, mode);
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
    releaseDb(db);
  }
}

// Read only the records belonging to `ownerId` by walking the ownerId index,
// instead of getAll()+filter over every owner's records. Falls back to a full
// scan if the index is somehow missing (e.g. a partially-applied upgrade).
async function listByOwnerIndex<T extends { ownerId?: string }>(
  storeName: string,
  ownerId: string
): Promise<T[]> {
  const db = await openDB();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const tx = openTransaction(db, storeName, "readonly");
      const store = tx.objectStore(storeName);
      if (!store.indexNames.contains("ownerId")) {
        const req = store.getAll();
        req.onsuccess = () => {
          const all = (req.result ?? []) as T[];
          resolve(all.filter((record) => (record.ownerId ?? DEFAULT_LOCAL_USER_ID) === ownerId));
        };
        req.onerror = () => reject(req.error);
        return;
      }
      const req = store.index("ownerId").getAll(IDBKeyRange.only(ownerId)) as IDBRequest<T[]>;
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    releaseDb(db);
  }
}

function yieldToIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 200 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Walk a store's primary keys in batches, applying `mutate` to each record.
 * `mutate` returns the updated record to persist, or undefined to skip it. Each
 * batch runs in its own short transaction and the loop yields to idle time
 * between batches, so a large migration never blocks the first paint.
 */
async function migrateStoreInBatches<T>(
  storeName: string,
  mutate: (record: T) => T | undefined,
  batchSize = OWNER_BACKFILL_BATCH_SIZE
): Promise<void> {
  const db = await openDB();
  try {
    let lastKey: IDBValidKey | undefined;
    for (;;) {
      const batch = await new Promise<{ count: number; lastKey?: IDBValidKey }>((resolve, reject) => {
        const tx = openTransaction(db, storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const range = lastKey === undefined ? null : IDBKeyRange.lowerBound(lastKey, true);
        const req = store.openCursor(range);
        let count = 0;
        let cursorKey: IDBValidKey | undefined = lastKey;
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor && count < batchSize) {
            const updated = mutate(cursor.value as T);
            if (updated !== undefined) cursor.update(updated);
            cursorKey = cursor.primaryKey;
            count += 1;
            cursor.continue();
          } else {
            resolve({ count, lastKey: cursorKey });
          }
        };
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error);
      });
      lastKey = batch.lastKey;
      if (batch.count < batchSize) break;
      await yieldToIdle();
    }
  } finally {
    releaseDb(db);
  }
}

type MigrationRecord = { id: string; ownerBackfillDone?: boolean };

async function readMigrations(): Promise<MigrationRecord | undefined> {
  try {
    return await withStore<MigrationRecord>(SETTINGS_STORE, "readonly", (store) => store.get(MIGRATIONS_ID));
  } catch {
    return undefined;
  }
}

async function writeMigrations(record: MigrationRecord): Promise<void> {
  await withStore(SETTINGS_STORE, "readwrite", (store) => {
    store.put({ ...record, id: MIGRATIONS_ID });
  });
}

// Legacy records saved before ownerId existed carry no owner. The ownerId index
// keys on that field, so those records would silently drop out of index reads.
// Stamp the active owner onto them once, chunked, before any index read. Guarded
// by a marker so it runs at most once and yields between batches.
/**
 * Backfill transform: stamp `ownerId` onto a record that lacks one, or return
 * undefined to leave records that already have an owner untouched (so the batch
 * migration skips the write). Pure and exported for testing.
 */
export function stampMissingOwner<T extends { ownerId?: string }>(record: T, ownerId: string): T | undefined {
  return record && !record.ownerId ? { ...record, ownerId } : undefined;
}

let ownerBackfillPromise: Promise<void> | undefined;
async function ensureOwnerBackfill(ownerId: string): Promise<void> {
  if (ownerBackfillPromise) return ownerBackfillPromise;
  ownerBackfillPromise = (async () => {
    const migrations = await readMigrations();
    if (migrations?.ownerBackfillDone) return;
    const stamp = (record: { ownerId?: string }) => stampMissingOwner(record, ownerId);
    await migrateStoreInBatches(LEGACY_SEARCH_STORE, stamp);
    await migrateStoreInBatches(HISTORY_SUMMARY_STORE, stamp);
    await writeMigrations({ ...(migrations ?? { id: MIGRATIONS_ID }), ownerBackfillDone: true });
  })().catch(() => {
    // Let a failed run retry on the next call rather than wedging reads.
    ownerBackfillPromise = undefined;
  });
  return ownerBackfillPromise;
}

async function mutateCoverageRecord<T>(
  targetId: string,
  task: (existing: CoverageRecord | undefined, ownerId: string) => { record?: CoverageRecord; result: T }
): Promise<T> {
  const ownerId = await activeOwnerId();
  const db = await openDB();
  let shouldNotify = false;
  try {
    const result = await new Promise<T>((resolve, reject) => {
      const tx = openTransaction(db, COVERAGE_STORE, "readwrite");
      const store = tx.objectStore(COVERAGE_STORE);
      const request = store.get(targetId);
      let resultValue: T;

      request.onsuccess = () => {
        try {
          const existing = withOwner(request.result as CoverageRecord | undefined, ownerId);
          const mutation = task(existing, ownerId);
          resultValue = mutation.result;
          if (mutation.record) {
            store.put({ ...mutation.record, ownerId: mutation.record.ownerId ?? ownerId });
            shouldNotify = true;
          }
        } catch (error) {
          try {
            tx.abort();
          } catch {
            // Transaction may already be aborting.
          }
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(resultValue);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    if (shouldNotify) notifyUpdated(targetId);
    return result;
  } finally {
    releaseDb(db);
  }
}

export async function putSearch(record: StoredSearch): Promise<void> {
  try {
    const ownerId = await activeOwnerId();
    const ownedRecord = { ...record, ownerId: record.ownerId ?? ownerId };
    await withStore(LEGACY_SEARCH_STORE, "readwrite", (store) => {
      store.put(ownedRecord);
    });
    await withStore(HISTORY_SUMMARY_STORE, "readwrite", (store) => {
      store.put(historySummaryFromStoredSearch(ownedRecord, ownerId));
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
    await ensureOwnerBackfill(ownerId);
    return (await listByOwnerIndex<StoredSearch>(LEGACY_SEARCH_STORE, ownerId))
      .map((record) => withOwner(record, ownerId))
      .filter((record): record is StoredSearch => record !== undefined);
  } catch {
    return [];
  }
}

export async function listHistorySummaries(): Promise<HistorySummaryRecord[]> {
  return measureAsync("history-summary-load", async () => {
    const ownerId = await activeOwnerId();
    await ensureOwnerBackfill(ownerId);
    const summaries = (await listByOwnerIndex<HistorySummaryRecord>(HISTORY_SUMMARY_STORE, ownerId))
      .map((record) => withOwner(record, ownerId))
      .filter((record): record is HistorySummaryRecord => record !== undefined);
    if (summaries.length > 0) return summaries;

    const searches = await listSearches();
    if (searches.length === 0) return [];
    const migrated = searches.map((record) => historySummaryFromStoredSearch(record, ownerId));
    await withStore(HISTORY_SUMMARY_STORE, "readwrite", (store) => {
      for (const summary of migrated) store.put(summary);
    });
    return migrated;
  }).catch(() => {
    return [];
  });
}

/**
 * Read the `limit` most-recently-updated history summaries for the active owner
 * via the `owner_updatedAt` compound index (newest first), without materializing
 * the whole store. Used for a fast first paint on large histories; the full list
 * is loaded separately for client-side filter/sort/search/export. Falls back to a
 * full read + sort + slice if the index is unavailable.
 */
export async function listRecentHistorySummaries(limit: number): Promise<HistorySummaryRecord[]> {
  return measureAsync(
    "history-summary-load-recent",
    async () => {
      const ownerId = await activeOwnerId();
      await ensureOwnerBackfill(ownerId);
      const db = await openDB();
      try {
        return await new Promise<HistorySummaryRecord[]>((resolve, reject) => {
          const tx = openTransaction(db, HISTORY_SUMMARY_STORE, "readonly");
          const store = tx.objectStore(HISTORY_SUMMARY_STORE);
          if (!store.indexNames.contains("owner_updatedAt")) {
            const req = store.getAll();
            req.onsuccess = () => {
              const page = ((req.result ?? []) as HistorySummaryRecord[])
                .filter((record) => (record.ownerId ?? DEFAULT_LOCAL_USER_ID) === ownerId)
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, limit)
                .map((record) => withOwner(record, ownerId))
                .filter((record): record is HistorySummaryRecord => record !== undefined);
              resolve(page);
            };
            req.onerror = () => reject(req.error);
            return;
          }
          // Canonical compound-index prefix range for one owner: [ownerId] sorts
          // before any [ownerId, updatedAt], and [ownerId, []] sorts after any of
          // them (an empty array is greater than every number). "prev" walks it
          // newest-updatedAt first.
          const range = IDBKeyRange.bound([ownerId], [ownerId, []]);
          const req = store.index("owner_updatedAt").openCursor(range, "prev");
          const out: HistorySummaryRecord[] = [];
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor && out.length < limit) {
              const owned = withOwner(cursor.value as HistorySummaryRecord, ownerId);
              if (owned) out.push(owned);
              cursor.continue();
            } else {
              resolve(out);
            }
          };
          req.onerror = () => reject(req.error);
        });
      } finally {
        releaseDb(db);
      }
    },
    { limit }
  ).catch(() => [] as HistorySummaryRecord[]);
}

export async function deleteSearch(key: string): Promise<void> {
  try {
    await withStore(LEGACY_SEARCH_STORE, "readwrite", (store) => {
      store.delete(key);
    });
    await withStore(HISTORY_SUMMARY_STORE, "readwrite", (store) => {
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
      const tx = openTransaction(db, [LEGACY_SEARCH_STORE, HISTORY_SUMMARY_STORE], "readwrite");
      const searchStore = tx.objectStore(LEGACY_SEARCH_STORE);
      const summaryStore = tx.objectStore(HISTORY_SUMMARY_STORE);
      for (const key of keys) {
        searchStore.delete(key);
        summaryStore.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    releaseDb(db);
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
  return await mutateCoverageRecord(target.targetId, (existing, ownerId) => {
    const merged = mergeCollectionResult(existing?.collectionResults[result.collection.id], result);
    const next: CoverageRecord = {
      targetId: target.targetId,
      ownerId: existing?.ownerId ?? target.ownerId ?? ownerId,
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
    return { record: next, result: next };
  });
}

export async function appendCoverageScanLogEntry(
  target: Pick<SearchTarget, "targetId" | "ownerId" | "url" | "matchType" | "mock">,
  entry: ScanLogEntry
): Promise<CoverageRecord> {
  if (!shouldPersistScanLogEntry(entry)) {
    const existing = await getCoverage(target.targetId);
    return {
      targetId: target.targetId,
      ownerId: existing?.ownerId ?? target.ownerId ?? await activeOwnerId(),
      url: target.url,
      matchType: target.matchType,
      mock: target.mock,
      collectionResults: existing?.collectionResults ?? {},
      scanLogResults: existing?.scanLogResults,
      collectionIds: existing?.collectionIds,
      collectionListFetchedAt: existing?.collectionListFetchedAt,
      scanWindowFrom: existing?.scanWindowFrom,
      scanWindowTo: existing?.scanWindowTo,
      durationMs: existing?.durationMs,
      activeScanStartedAt: existing?.activeScanStartedAt,
      updatedAt: existing?.updatedAt ?? Date.now()
    };
  }
  return await mutateCoverageRecord(target.targetId, (existing, ownerId) => {
    const next: CoverageRecord = {
      targetId: target.targetId,
      ownerId: existing?.ownerId ?? target.ownerId ?? ownerId,
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
    return { record: next, result: next };
  });
}

// Add one run's active scanning time to the stored total. Called when a scan
// run reaches a terminal state (done/paused/cancelled/error).
export async function addCoverageDuration(targetId: string, segmentMs: number): Promise<void> {
  if (!Number.isFinite(segmentMs) || segmentMs <= 0) return;
  await mutateCoverageRecord(targetId, (existing) => {
    if (!existing) return { result: undefined };
    return {
      record: {
        ...existing,
        durationMs: (existing.durationMs ?? 0) + Math.round(segmentMs),
        activeScanStartedAt: undefined,
        updatedAt: Date.now()
      },
      result: undefined
    };
  });
}

export async function startCoverageRun(
  target: Pick<SearchTarget, "targetId" | "ownerId" | "url" | "matchType" | "mock">,
  startedAt: number,
  durationMs: number,
  metadata: Pick<CoverageRecord, "collectionIds" | "collectionListFetchedAt" | "scanWindowFrom" | "scanWindowTo"> = {}
): Promise<void> {
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs < 0) return;
  await mutateCoverageRecord(target.targetId, (existing, ownerId) => {
    return {
      record: {
        targetId: target.targetId,
        ownerId: existing?.ownerId ?? target.ownerId ?? ownerId,
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
      },
      result: undefined
    };
  });
}

export function coverageDurationMs(record: CoverageRecord | undefined, now = Date.now()): number {
  const storedDuration = record?.durationMs ?? 0;
  const activeSegment = record?.activeScanStartedAt ? Math.max(0, now - record.activeScanStartedAt) : 0;
  return storedDuration + activeSegment;
}

export function scanLogDurationMs(entries: ScanLogEntry[] | undefined): number {
  const points: Array<{ timestamp: number; event?: string }> = (entries ?? []).flatMap((entry) => {
    if ("kind" in entry) {
      if (typeof entry.checkedAt !== "number" || !Number.isFinite(entry.checkedAt)) return [];
      return [{ timestamp: entry.checkedAt, event: entry.event }];
    }
    const attemptTimestamps = entry.attemptLogs?.length
      ? entry.attemptLogs.map((attempt) => attempt.checkedAt ?? entry.checkedAt)
      : [entry.checkedAt];
    return attemptTimestamps
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .map((timestamp) => ({ timestamp }));
  });
  const timestamps = points.map((point) => point.timestamp);
  if (timestamps.length < 2) return 0;
  const runStartEvents = new Set(["scan-started", "scan-restarted", "retry-started", "continue-started", "auto-retry-started"]);
  const runStopEvents = new Set(["scan-completed", "scan-paused", "scan-failed"]);
  if (!points.some((point) => point.event && runStartEvents.has(point.event))) {
    return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
  }

  let startedAt: number | undefined;
  let lastActivityAt: number | undefined;
  let durationMs = 0;
  for (const point of points) {
    if (point.event && runStartEvents.has(point.event)) {
      if (startedAt !== undefined && lastActivityAt !== undefined) {
        durationMs += Math.max(0, lastActivityAt - startedAt);
      }
      startedAt = point.timestamp;
      lastActivityAt = point.timestamp;
      continue;
    }
    if (startedAt === undefined) continue;
    lastActivityAt = Math.max(lastActivityAt ?? startedAt, point.timestamp);
    if (point.event && runStopEvents.has(point.event)) {
      durationMs += Math.max(0, point.timestamp - startedAt);
      startedAt = undefined;
      lastActivityAt = undefined;
    }
  }
  if (startedAt !== undefined && lastActivityAt !== undefined) {
    durationMs += Math.max(0, lastActivityAt - startedAt);
  }
  return durationMs;
}

export function coverageResults(record: CoverageRecord | undefined): CollectionCheckResult[] {
  return Object.values(record?.collectionResults ?? {}).map((result) => ({
    ...result,
    checkedAt: result.checkedAt ?? record?.updatedAt
  }));
}

export function coverageScanLogResults(record: CoverageRecord | undefined): ScanLogEntry[] {
  if (!record?.scanLogResults?.length) return coverageResults(record);
  return record.scanLogResults
    .filter(shouldPersistScanLogEntry)
    .map((result) => ("kind" in result
      ? { ...result, checkedAt: result.checkedAt ?? record.updatedAt }
      : { ...result, checkedAt: result.checkedAt ?? record.updatedAt }
    ));
}

export function coverageCaptures(record: CoverageRecord | undefined): CommonCrawlCapture[] {
  return dedupeCaptures(coverageResults(record).flatMap((result) => result.captures));
}

export function historySummaryFromStoredSearch(record: StoredSearch, ownerId = record.ownerId): HistorySummaryRecord {
  const results = resultsForLegacyRecord(record);
  const sourceTotal = historySourceTotal(record, results);
  const sourceProcessed = results.filter((result) => result.status === "checked" || result.status === "not-checked").length;
  const failedCount = results.filter((result) => result.status === "not-checked").length;
  return {
    key: record.key,
    ownerId,
    url: record.url,
    matchType: record.matchType,
    mock: record.mock,
    scanScope: record.scanScope ?? "recent",
    dateFrom: record.dateFrom,
    dateTo: record.dateTo,
    collections: record.collections,
    collectionIds: record.collectionIds ?? record.collections?.map((collection) => collection.id),
    collectionListFetchedAt: record.collectionListFetchedAt,
    scanWindowFrom: record.scanWindowFrom,
    scanWindowTo: record.scanWindowTo,
    captureCount: dedupeCaptures(record.captures).length,
    captureKeys: Array.from(new Set(record.captures.map(captureCacheKey))),
    sourceTotal,
    sourceProcessed,
    failedCount,
    durationMs: record.durationMs,
    activeScanStartedAt: record.activeScanStartedAt,
    updatedAt: record.updatedAt
  };
}

function historySourceTotal(record: StoredSearch, results: CollectionCheckResult[]) {
  return record.collectionIds?.length ?? record.collections?.length ?? results.length;
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
  const inferredDurationMs = scanLogDurationMs(storedScanLog);
  await mutateCoverageRecord(target.targetId, (existing, ownerId) => {
    const durationMs = Math.max(record.durationMs ?? 0, existing?.durationMs ?? 0, inferredDurationMs) || undefined;
    return {
      record: {
        targetId: target.targetId,
        ownerId: existing?.ownerId ?? target.ownerId ?? ownerId,
        url: target.url,
        matchType: target.matchType,
        mock: target.mock,
        collectionResults: existing?.collectionResults ?? {},
        scanLogResults: existing?.scanLogResults?.length ? existing.scanLogResults : storedScanLog,
        collectionIds: record.collectionIds ?? existing?.collectionIds,
        collectionListFetchedAt: record.collectionListFetchedAt ?? existing?.collectionListFetchedAt,
        scanWindowFrom: record.scanWindowFrom ?? existing?.scanWindowFrom,
        scanWindowTo: record.scanWindowTo ?? existing?.scanWindowTo,
        durationMs,
        activeScanStartedAt: existing?.activeScanStartedAt ?? record.activeScanStartedAt,
        updatedAt: Date.now()
      },
      result: undefined
    };
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
  const matchesTarget = (record: Pick<StoredSearch, "url" | "matchType" | "mock">) =>
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
  const legacySummaries = (await listHistorySummaries()).filter(matchesTarget);
  const legacyKeys = new Set(legacySummaries.flatMap((record) => record.storageKeys?.length ? record.storageKeys : [record.key]));
  const legacyCandidates = (await Promise.all(Array.from(legacyKeys).map((key) => getSearch(key))))
    .filter((record): record is StoredSearch => Boolean(record))
    .filter(matchesTarget);
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

// getSettings() and getOrCreateLocalUser()/activeOwnerId() run on many hot paths
// (every WARC load, every hover prefetch, every store mutation). Cache the
// normalized settings and the local user in memory, invalidating on any relevant
// write — same-tab directly, cross-tab via the broadcast channel — so repeated
// reads don't hit IndexedDB.
let cachedSettings: AppSettings | undefined;
let cachedLocalUser: LocalUser | undefined;
let identityChannel: BroadcastChannel | undefined;
let identityChannelReady = false;

function invalidateSettingsCache(): void {
  cachedSettings = undefined;
}

function invalidateLocalUserCache(): void {
  cachedLocalUser = undefined;
}

function ensureIdentityCacheInvalidation(): void {
  if (identityChannelReady) return;
  identityChannelReady = true;
  if (typeof BroadcastChannel === "undefined") return;
  try {
    identityChannel = new BroadcastChannel(CHANNEL_NAME);
    identityChannel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; key?: string } | null;
      if (data?.type !== "updated") return;
      if (data.key === SETTINGS_STORE || data.key === "clear-all") {
        invalidateSettingsCache();
        invalidateLocalUserCache();
      } else if (cachedLocalUser && data.key === cachedLocalUser.userId) {
        invalidateLocalUserCache();
      }
    };
  } catch {
    // BroadcastChannel unavailable; same-tab invalidation still works.
  }
}

export async function getOrCreateLocalUser(): Promise<LocalUser> {
  assertStorageConsent();
  ensureIdentityCacheInvalidation();
  if (cachedLocalUser) return cachedLocalUser;
  const settings = await readSettings();
  const userId = settings?.activeUserId ?? DEFAULT_LOCAL_USER_ID;
  const existing = await getUser(userId);
  if (existing) {
    if (!settings) await writeSettings(defaultSettings(existing.userId));
    cachedLocalUser = existing;
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
  cachedLocalUser = user;
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
  invalidateLocalUserCache();
  notifyUpdated(next.userId);
  return next;
}

export async function getSettings(): Promise<AppSettings> {
  assertStorageConsent();
  ensureIdentityCacheInvalidation();
  if (cachedSettings) return cachedSettings;
  await getOrCreateLocalUser();
  const settings = normalizeSettings((await readSettings()) ?? defaultSettings(DEFAULT_LOCAL_USER_ID));
  cachedSettings = settings;
  return settings;
}

export async function updateSettings(
  input: Partial<Pick<
    AppSettings,
    | "htmlCacheEnabled"
    | "htmlCacheLimitBytes"
    | "autoPruneEnabled"
    | "showHtmlPrivacyWarning"
    | "robotsTxtChecksEnabled"
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
    robotsTxtChecksEnabled: input.robotsTxtChecksEnabled ?? current.robotsTxtChecksEnabled ?? true,
    defaultMatchType: input.defaultMatchType ?? current.defaultMatchType,
    defaultScanScope: input.defaultScanScope ?? current.defaultScanScope,
    defaultScanScopeChosen: input.defaultScanScope !== undefined ? true : current.defaultScanScopeChosen,
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
    await putCachedCaptureMeta(cachedHtmlMeta(next));
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
    await putCachedCaptureMeta(cachedHtmlMeta(cached));
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
    const keys = Array.from(new Set(captures.map(captureCacheKey)));
    const db = await openDB();
    try {
      return await new Promise<CachedHtmlCaptureRecord[]>((resolve, reject) => {
        const tx = openTransaction(db, HTML_CAPTURE_STORE, "readonly");
        const store = tx.objectStore(HTML_CAPTURE_STORE);
        const records: CachedHtmlCaptureRecord[] = [];
        for (const key of keys) {
          const request = store.get(key);
          request.onsuccess = () => {
            const record = request.result as CachedHtmlCaptureRecord | undefined;
            if (record?.ownerId === ownerId) records.push(record);
          };
          request.onerror = () => reject(request.error);
        }
        tx.oncomplete = () => resolve(records);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      releaseDb(db);
    }
  } catch {
    return [];
  }
}

export async function countCachedCapturesForCaptures(
  captures: Pick<CommonCrawlCapture, "filename" | "offset" | "length">[]
): Promise<number> {
  return countCachedCaptureKeys(captures.map(captureCacheKey));
}

export async function countCachedCaptureKeys(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  try {
    const ownerId = await activeOwnerId();
    const uniqueKeys = Array.from(new Set(keys));
    const db = await openDB();
    try {
      return await new Promise<number>((resolve, reject) => {
        const tx = openTransaction(db, HTML_CAPTURE_META_STORE, "readonly");
        const store = tx.objectStore(HTML_CAPTURE_META_STORE);
        let count = 0;
        const missingKeys: string[] = [];
        for (const key of uniqueKeys) {
          const request = store.get(key);
          request.onsuccess = () => {
            const record = request.result as CachedHtmlCaptureMetaRecord | undefined;
            if (record?.ownerId === ownerId) {
              count += 1;
            } else {
              missingKeys.push(key);
            }
          };
          request.onerror = () => reject(request.error);
        }
        tx.oncomplete = () => {
          if (missingKeys.length === 0) {
            resolve(count);
            return;
          }
          countCachedCaptureKeysFromHtmlStore(missingKeys, ownerId)
            .then((legacyCount) => resolve(count + legacyCount))
            .catch(reject);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      releaseDb(db);
    }
  } catch {
    return 0;
  }
}

export async function deleteCachedCapture(
  captureOrKey: Pick<CommonCrawlCapture, "filename" | "offset" | "length"> | string
): Promise<void> {
  try {
    const cacheKey = typeof captureOrKey === "string" ? captureOrKey : captureCacheKey(captureOrKey);
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = openTransaction(db, [HTML_CAPTURE_STORE, HTML_CAPTURE_META_STORE], "readwrite");
      tx.objectStore(HTML_CAPTURE_STORE).delete(cacheKey);
      tx.objectStore(HTML_CAPTURE_META_STORE).delete(cacheKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    releaseDb(db);
    notifyUpdated(cacheKey);
  } catch {
    // Best-effort persistence.
  }
}

export async function deleteCachedCapturesForHistoryRecord(record: Pick<StoredSearch, "captures">): Promise<void> {
  await deleteCachedCaptures(record.captures);
}

export async function deleteCachedCaptures(captures: Pick<CommonCrawlCapture, "filename" | "offset" | "length">[]): Promise<void> {
  await deleteCachedCaptureKeys(captures.map(captureCacheKey));
}

export async function deleteCachedCaptureKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const uniqueKeys = Array.from(new Set(keys));
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = openTransaction(db, [HTML_CAPTURE_STORE, HTML_CAPTURE_META_STORE], "readwrite");
      const htmlStore = tx.objectStore(HTML_CAPTURE_STORE);
      const metaStore = tx.objectStore(HTML_CAPTURE_META_STORE);
      for (const key of uniqueKeys) {
        htmlStore.delete(key);
        metaStore.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    releaseDb(db);
    notifyUpdated(HTML_CAPTURE_STORE);
  } catch {
    // Best-effort persistence.
  }
}

export async function clearHtmlCache(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = openTransaction(db, [HTML_CAPTURE_STORE, HTML_CAPTURE_META_STORE], "readwrite");
      tx.objectStore(HTML_CAPTURE_STORE).clear();
      tx.objectStore(HTML_CAPTURE_META_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    releaseDb(db);
    notifyUpdated(HTML_CAPTURE_STORE);
  } catch {
    // Best-effort persistence.
  }
}

export async function clearAllLocalAppData(): Promise<void> {
  // The saved theme choice is the only app preference outside IndexedDB.
  try { globalThis.localStorage?.removeItem("crawlback:theme"); /* Legacy key from the retired theme switcher. */ } catch { /* Storage may be blocked. */ }
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = openTransaction(db,
        [LEGACY_SEARCH_STORE, HISTORY_SUMMARY_STORE, TARGET_STORE, COVERAGE_STORE, SESSION_STORE, USER_STORE, SETTINGS_STORE, HTML_CAPTURE_STORE, HTML_CAPTURE_META_STORE],
        "readwrite"
      );
      for (const storeName of tx.objectStoreNames) tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    releaseDb(db);
    await getOrCreateLocalUser();
    notifyUpdated("clear-all");
  } catch {
    // Best-effort persistence.
  }
}

export async function getCacheStats(): Promise<CacheStats> {
  return measureAsync("settings-cache-stats", async () => {
    const ownerId = await activeOwnerId();
    const records = await listCachedCaptureMetaRecords(ownerId);
    return cacheStatsFor(records.filter((record) => record.ownerId === ownerId));
  }).catch(() => {
    return { count: 0, sizeBytes: 0 };
  });
}

export async function pruneHtmlCache(limitBytes?: number): Promise<void> {
  const limit = normalizeCacheLimit(limitBytes ?? (await getSettings()).htmlCacheLimitBytes);
  try {
    const ownerId = await activeOwnerId();
    const records = (await listCachedCaptureMetaRecords(ownerId))
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
    await deleteCachedCaptureKeys(deleteKeys);
  } catch {
    // Best-effort pruning.
  }
}

export type CachedHtmlSearchMatch = {
  cacheKey: string;
  url?: string;
  timestamp?: string;
  collectionId?: string;
  status?: string;
  mime?: string;
  filename: string;
  offset: string;
  length: string;
  sizeBytes: number;
  snippet: string;
  inUrl: boolean;
};

// Collapse a slice of raw HTML around a match into a readable one-line snippet:
// drop tags, collapse whitespace, and window the text around the hit.
function htmlSnippet(html: string, matchIndex: number, needleLength: number): string {
  const source = matchIndex >= 0 ? html.slice(Math.max(0, matchIndex - 80), matchIndex + needleLength + 120) : html.slice(0, 200);
  const text = source
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * Pure matcher for full-text cache search: returns a search match when the
 * needle (already lower-cased) appears in the record's HTML body or URL, else
 * null. Exported so the matching/snippet behaviour can be unit-tested without
 * IndexedDB.
 */
export function matchCachedHtmlRecord(
  record: CachedHtmlCaptureRecord,
  needle: string
): CachedHtmlSearchMatch | null {
  const html = typeof record.html === "string" ? record.html : "";
  const matchIndex = html.toLowerCase().indexOf(needle);
  const inUrl = (record.url ?? "").toLowerCase().includes(needle);
  if (matchIndex < 0 && !inUrl) return null;
  return {
    cacheKey: record.cacheKey,
    url: record.url,
    timestamp: record.timestamp,
    collectionId: record.collectionId,
    status: record.status,
    mime: record.mime,
    filename: record.filename,
    offset: record.offset,
    length: record.length,
    sizeBytes: record.sizeBytes,
    snippet: htmlSnippet(html, matchIndex, needle.length),
    inUrl
  };
}

/**
 * Full-text search over locally cached HTML captures. Scans the HTML cache for
 * the query (case-insensitive) in the page body or URL and returns matches with
 * a readable snippet, newest first. Purely local — no network.
 */
export async function searchCachedHtml(
  query: string,
  { limit = 100, signal }: { limit?: number; signal?: AbortSignal } = {}
): Promise<CachedHtmlSearchMatch[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const ownerId = await activeOwnerId();
  const db = await openDB();
  try {
    const matches = await new Promise<CachedHtmlSearchMatch[]>((resolve, reject) => {
      const tx = openTransaction(db, HTML_CAPTURE_STORE, "readonly");
      const store = tx.objectStore(HTML_CAPTURE_STORE);
      const request = store.openCursor();
      const found: CachedHtmlSearchMatch[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || signal?.aborted) {
          resolve(found);
          return;
        }
        const record = cursor.value as CachedHtmlCaptureRecord;
        if (record.ownerId === ownerId) {
          const match = matchCachedHtmlRecord(record, needle);
          if (match) found.push(match);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return matches
      .sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""))
      .slice(0, limit);
  } catch {
    return [];
  } finally {
    releaseDb(db);
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
  // Any settings mutation invalidates the in-memory caches so the next read
  // reflects the write (activeUserId may change; cross-tab tabs are handled by
  // the broadcast listener).
  invalidateSettingsCache();
  invalidateLocalUserCache();
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
    robotsTxtChecksEnabled: true,
    defaultMatchType: "exact",
    defaultScanScope: DEFAULT_SCAN_SCOPE,
    defaultScanScopeChosen: false,
    defaultViewMode: "list",
    defaultSort: DEFAULT_CAPTURE_SORT,
    searchPageSize: DEFAULT_SEARCH_PAGE_SIZE,
    historyPageSize: DEFAULT_HISTORY_PAGE_SIZE,
    defaultExportColumns: DEFAULT_CAPTURE_EXPORT_COLUMNS,
    largeCaptureLimitBytes: DEFAULT_LARGE_CAPTURE_LIMIT_BYTES,
    updatedAt: Date.now()
  };
}

export function normalizeSettings(settings: AppSettings): AppSettings {
  const scanScopeChosen = settings.defaultScanScopeChosen === true;
  const normalizedScope = normalizeScanScope(settings.defaultScanScope, scanScopeChosen);
  const normalizedDateFrom = normalizeDateSetting(settings.defaultCustomDateFrom);
  const normalizedDateTo = normalizeDateSetting(settings.defaultCustomDateTo);
  return {
    id: settings.id,
    activeUserId: settings.activeUserId,
    htmlCacheEnabled: settings.htmlCacheEnabled ?? true,
    htmlCacheLimitBytes: normalizeCacheLimit(settings.htmlCacheLimitBytes),
    autoPruneEnabled: settings.autoPruneEnabled ?? true,
    showHtmlPrivacyWarning: settings.showHtmlPrivacyWarning ?? true,
    robotsTxtChecksEnabled: settings.robotsTxtChecksEnabled ?? true,
    defaultMatchType: normalizeMatchType(settings.defaultMatchType),
    defaultScanScope: normalizedScope,
    defaultScanScopeChosen: scanScopeChosen,
    defaultCustomDateFrom: normalizedScope === "custom" ? normalizedDateFrom : undefined,
    defaultCustomDateTo: normalizedScope === "custom" ? normalizedDateTo : undefined,
    defaultViewMode: settings.defaultViewMode === "calendar" ? "calendar" : "list",
    defaultSort: normalizeSortSetting(settings.defaultSort),
    searchPageSize: normalizePageSize(settings.searchPageSize, DEFAULT_SEARCH_PAGE_SIZE, 25, 500),
    historyPageSize: normalizePageSize(settings.historyPageSize, DEFAULT_HISTORY_PAGE_SIZE, 10, 100),
    defaultExportColumns: normalizeExportColumns(settings.defaultExportColumns),
    largeCaptureLimitBytes: normalizeLargeCaptureLimit(settings.largeCaptureLimitBytes),
    updatedAt: typeof settings.updatedAt === "number" && Number.isFinite(settings.updatedAt) ? settings.updatedAt : Date.now()
  };
}

function normalizeMatchType(value: unknown): MatchType {
  return value === "host" || value === "domain" || value === "exact" ? value : "exact";
}

// "recent" was the old default, so it is only kept when the user explicitly chose it.
// Records written before the choice was tracked never store that choice, so they get the current default.
function normalizeScanScope(value: unknown, chosen: boolean): ScanScope {
  if (value === "all" || value === "custom") return value;
  if (value === "recent" && chosen) return "recent";
  return DEFAULT_SCAN_SCOPE;
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

function cachedHtmlMeta(record: CachedHtmlCaptureRecord): CachedHtmlCaptureMetaRecord {
  return {
    cacheKey: record.cacheKey,
    ownerId: record.ownerId,
    filename: record.filename,
    offset: record.offset,
    length: record.length,
    url: record.url,
    timestamp: record.timestamp,
    collectionId: record.collectionId,
    mime: record.mime,
    status: record.status,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
    lastAccessedAt: record.lastAccessedAt
  };
}

async function putCachedCaptureMeta(record: CachedHtmlCaptureMetaRecord): Promise<void> {
  try {
    await withStore(HTML_CAPTURE_META_STORE, "readwrite", (store) => {
      store.put(record);
    });
  } catch {
    // Cache metadata is an optimization; HTML cache reads can still fall back.
  }
}

async function listCachedCaptureMetaRecords(ownerId: string): Promise<CachedHtmlCaptureMetaRecord[]> {
  const records = (await withStore<CachedHtmlCaptureMetaRecord[]>(HTML_CAPTURE_META_STORE, "readonly", (store) => store.getAll())) ?? [];
  const ownedRecords = records.filter((record) => record.ownerId === ownerId);
  const [htmlCount, metaCount] = await Promise.all([
    withStore<number>(HTML_CAPTURE_STORE, "readonly", (store) => store.count()),
    withStore<number>(HTML_CAPTURE_META_STORE, "readonly", (store) => store.count())
  ]);
  if (ownedRecords.length > 0 && (metaCount ?? 0) >= (htmlCount ?? 0)) return ownedRecords;

  const legacyRecords = ((await withStore<CachedHtmlCaptureRecord[]>(HTML_CAPTURE_STORE, "readonly", (store) => store.getAll())) ?? [])
    .filter((record) => record.ownerId === ownerId);
  const migrated = legacyRecords.map(cachedHtmlMeta);
  if (migrated.length > 0) {
    await withStore(HTML_CAPTURE_META_STORE, "readwrite", (store) => {
      for (const record of migrated) store.put(record);
    });
  }
  return migrated;
}

async function countCachedCaptureKeysFromHtmlStore(keys: string[], ownerId: string): Promise<number> {
  if (keys.length === 0) return 0;
  const uniqueKeys = Array.from(new Set(keys));
  const db = await openDB();
  const metas: CachedHtmlCaptureMetaRecord[] = [];
  try {
    const count = await new Promise<number>((resolve, reject) => {
      const tx = openTransaction(db, HTML_CAPTURE_STORE, "readonly");
      const store = tx.objectStore(HTML_CAPTURE_STORE);
      let found = 0;
      for (const key of uniqueKeys) {
        const request = store.get(key);
        request.onsuccess = () => {
          const record = request.result as CachedHtmlCaptureRecord | undefined;
          if (record?.ownerId !== ownerId) return;
          found += 1;
          metas.push(cachedHtmlMeta(record));
        };
        request.onerror = () => reject(request.error);
      }
      tx.oncomplete = () => resolve(found);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    if (metas.length > 0) {
      await withStore(HTML_CAPTURE_META_STORE, "readwrite", (store) => {
        for (const meta of metas) store.put(meta);
      });
    }
    return count;
  } finally {
    releaseDb(db);
  }
}

function cacheStatsFor(records: CachedHtmlCaptureMetaRecord[]): CacheStats {
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
