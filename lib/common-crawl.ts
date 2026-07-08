import { markPerformance, measurePerformance } from "@/lib/performance";

export const COLLECTIONS_URL = "https://index.commoncrawl.org/collinfo.json";
export const DATA_BASE_URL = "https://data.commoncrawl.org/";
export const DEFAULT_CONCURRENCY = 1;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_REQUEST_SPACING_MS = 1_100;
export const DEFAULT_RETRY_COUNT = 1;
export const DEFAULT_RETRY_DELAY_MS = 10_000;
export const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 3;
export const DEFAULT_CIRCUIT_BREAKER_WINDOW_SIZE = 8;
export const DEFAULT_CIRCUIT_BREAKER_WINDOW_THRESHOLD = 7;
export const DEFAULT_CDX_LIMIT = 1000;
// Common Crawl's pywb CDX API paginates block-based results via `page`. We walk
// pages until the server signals the end (HTTP 400 past the last page, or an
// empty body) instead of stopping at a single 1000-record response, so hosts and
// domains with more than one page of captures are fully covered. These caps keep
// a single collection query bounded for a browser tab.
export const DEFAULT_MAX_CAPTURES_PER_COLLECTION = 10_000;
export const DEFAULT_MAX_CDX_PAGES = 100;
export const DEFAULT_COLLECTION_LOOKBACK_MONTHS = 12;
export const COLLECTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const CDX_RESULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LARGE_CAPTURE_LIMIT_BYTES = 15 * 1024 * 1024;

const COLLECTION_CACHE_KEY = "snapshot-search:common-crawl-collections:v2";
const LEGACY_COLLECTION_CACHE_KEY = "snapshot-search:common-crawl-collections";
const HOST_RATE_STATE_PREFIX = "snapshot-search:common-crawl-host-rate:v1:";
const HOST_RATE_STATE_TTL_MS = 15 * 60 * 1000;
const BAD_GATEWAY_SIGNAL_WINDOW_MS = 2 * 60 * 1000;
// Bumped to v6 when the redundant http/https protocol-variant query was removed:
// v5 entries could hold each capture twice, so they must not be reused.
const CDX_RESULT_CACHE_PREFIX = "snapshot-search:common-crawl-cdx:v6:";
const CACHE_VERSION = 1;
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  "index.commoncrawl.org": DEFAULT_REQUEST_SPACING_MS,
  "data.commoncrawl.org": 1_000
};
const CLEAN_REQUESTS_PER_RECOVERY_STEP = 10;
const HOST_PACE_INTERVAL_MS = {
  normal: DEFAULT_REQUEST_SPACING_MS,
  cautious: 2_500,
  cooldown: 5_000
} as const;

type HostRateState = {
  chain: Promise<void>;
  nextFetchAt: number;
  pace: CommonCrawlPaceLevel;
  cleanRequestCount: number;
  consecutiveAvailabilitySignals: number;
  requestCount: number;
  availabilitySignalCount: number;
  networkErrorCount: number;
  badGatewayCount: number;
  lastBadGatewayAt?: number;
  lastStatus?: number;
  lastSignalAt?: number;
  lastDelayMs?: number;
  lastDelayReason?: "minimum-interval" | "shared-tab" | "availability-cooldown";
};

type SharedHostRateRecord = {
  version?: unknown;
  updatedAt?: unknown;
  nextFetchAt?: unknown;
  pace?: unknown;
  cleanRequestCount?: unknown;
  consecutiveAvailabilitySignals?: unknown;
  availabilitySignalCount?: unknown;
  networkErrorCount?: unknown;
  badGatewayCount?: unknown;
  lastBadGatewayAt?: unknown;
  lastStatus?: unknown;
  lastSignalAt?: unknown;
};

const hostStates = new Map<string, HostRateState>();
const rateLimitListeners = new Set<(change: CommonCrawlRateLimitChange) => void>();

export type CommonCrawlPaceLevel = keyof typeof HOST_PACE_INTERVAL_MS;

export type CommonCrawlRateLimitChange = {
  hostname: string;
  previousPace: CommonCrawlPaceLevel;
  pace: CommonCrawlPaceLevel;
  intervalMs: number;
  reason: "http_429" | "http_502" | "http_503" | "http_500_slowdown" | "network_error" | "recovered";
  cleanRequestCount: number;
  httpStatus?: number;
};

export type CommonCrawlCollection = {
  id: string;
  name: string;
  cdxApi: string;
  from: string;
  to: string;
};

export type MatchType = "exact" | "host" | "domain";

export const DEFAULT_MATCH_TYPE: MatchType = "exact";

// Inclusive day range (YYYY-MM-DD) used both to constrain a CDX query server-side
// (via the API's `from`/`to` params) and to record which window a stored result
// is known to fully cover. An undefined window means "no date bound" (full crawl).
export type ScanDateWindow = { from: string; to: string };

// True when a stored result's coverage window is broad enough to satisfy a newly
// requested window, so the result can be reused instead of re-fetched. A result
// with no window (full) covers everything; a windowed result cannot satisfy an
// unbounded (full) request. YYYY-MM-DD strings compare correctly lexicographically.
export function resultCoversWindow(
  resultWindow: ScanDateWindow | undefined,
  requestedWindow: ScanDateWindow | undefined
): boolean {
  if (!resultWindow) return true;
  if (!requestedWindow) return false;
  return resultWindow.from <= requestedWindow.from && resultWindow.to >= requestedWindow.to;
}

export type CommonCrawlCapture = {
  collectionId: string;
  collectionName: string;
  collectionFrom: string;
  collectionTo: string;
  timestamp: string;
  url: string;
  status: string;
  mime: string;
  digest?: string;
  filename: string;
  offset: string;
  length: string;
  redirect?: string;
};

export type CollectionCheckResult = {
  collection: CommonCrawlCollection;
  status: "checked" | "not-checked";
  captures: CommonCrawlCapture[];
  checkedAt?: number;
  httpStatus?: number;
  error?: string;
  errorKind?: CollectionErrorKind;
  attempts: number;
  runs: number;
  fromCache?: boolean;
  blockedCaptures?: BlockedCapture[];
  attemptLogs?: CollectionAttemptLog[];
  // Set when pagination hit the per-collection capture/page cap and stopped
  // before exhausting the index, so the capture list is a prefix of what exists.
  truncated?: boolean;
  // The date window this result is known to fully cover, when the query was
  // constrained server-side. Undefined means the whole crawl was queried.
  window?: ScanDateWindow;
};

export type CollectionAttemptLog = {
  status: "checked" | "not-checked";
  attemptNumber?: number;
  checkedAt?: number;
  httpStatus?: number;
  error?: string;
  errorKind?: CollectionErrorKind;
  captureCount?: number;
};

export type ScanLogEvent = {
  kind: "event";
  event:
    | "scan-started"
    | "scan-restarted"
    | "retry-started"
    | "continue-started"
    | "auto-retry-started"
    | "auto-retry-enabled"
    | "auto-retry-disabled"
    | "auto-retry-scheduled"
    | "auto-retry-skipped"
    | "cache-hit"
    | "collection-skipped"
    | "collection-truncated"
    | "fresh-scan-cleared"
    | "html-zip-cancelled"
    | "html-zip-completed"
    | "html-zip-failed"
    | "html-zip-started"
    | "opt-out-checked"
    | "pace-changed"
    | "request-timeout"
    | "retry-wait-started"
    | "robots-cached"
    | "robots-checked"
    | "scan-completed"
    | "scan-paused"
    | "scan-failed"
    | "scope-selected"
    | "stored-coverage-loaded";
  checkedAt?: number;
  message: string;
  tone?: "neutral" | "amber" | "red" | "green";
};

export type ScanLogEntry = CollectionCheckResult | ScanLogEvent;

export function shouldPersistScanLogEntry(entry: ScanLogEntry) {
  return !("kind" in entry && entry.event === "stored-coverage-loaded");
}

export type BlockedCapture = {
  capture: CommonCrawlCapture;
  reason: "too-large";
  sizeBytes: number;
  limitBytes: number;
};

export type CollectionErrorKind =
  | "network_no_response"
  | "timeout"
  | "http_429_rate_limit"
  | "http_500_slowdown"
  | "http_500_server_error"
  | "http_502_bad_gateway"
  | "http_503_unavailable"
  | "http_504_gateway_timeout"
  | "http_other";

export type SearchProgress = {
  checked: number;
  total: number;
  hits: number;
  failed: number;
  activeCollections: string[];
};

export type SearchStopReason = "completed" | "aborted" | "circuit-breaker";

type CollectionCacheRecord = {
  version: number;
  fetchedAt: number;
  collections: CommonCrawlCollection[];
};

export type CollectionCacheInfo = {
  fetchedAt?: number;
  count: number;
};

type CdxResultCacheRecord = {
  version: number;
  fetchedAt: number;
  result: CollectionCheckResult;
};

type RawCollection = {
  id?: unknown;
  name?: unknown;
  "cdx-api"?: unknown;
  cdxApi?: unknown;
  from?: unknown;
  to?: unknown;
};

type RawCapture = {
  timestamp?: unknown;
  url?: unknown;
  status?: unknown;
  mime?: unknown;
  digest?: unknown;
  filename?: unknown;
  offset?: unknown;
  length?: unknown;
  redirect?: unknown;
};

export function parseCollections(value: unknown): CommonCrawlCollection[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): CommonCrawlCollection[] => {
      const raw = item as RawCollection;
      const cdxApi = typeof raw["cdx-api"] === "string" ? raw["cdx-api"] : raw.cdxApi;
      if (
        typeof raw.id !== "string" ||
        typeof raw.name !== "string" ||
        typeof cdxApi !== "string" ||
        typeof raw.from !== "string" ||
        typeof raw.to !== "string"
      ) {
        return [];
      }

      return [
        {
          id: raw.id,
          name: raw.name,
          cdxApi,
          from: raw.from,
          to: raw.to
        }
      ];
    })
    .sort((a, b) => b.from.localeCompare(a.from));
}

function readJsonStorage<T>(key: string): T | undefined {
  try {
    if (typeof globalThis.localStorage === "undefined") return undefined;
    const value = globalThis.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  try {
    if (typeof globalThis.localStorage === "undefined") return;
    globalThis.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache writes are best-effort.
  }
}

function normalizeCollectionCache(value: unknown): CollectionCacheRecord | undefined {
  if (Array.isArray(value)) {
    const collections = parseCollections(
      value.map((item) => ({
        id: (item as CommonCrawlCollection).id,
        name: (item as CommonCrawlCollection).name,
        "cdx-api": (item as CommonCrawlCollection).cdxApi,
        from: (item as CommonCrawlCollection).from,
        to: (item as CommonCrawlCollection).to
      }))
    );
    return collections.length > 0
      ? { version: CACHE_VERSION, fetchedAt: 0, collections }
      : undefined;
  }

  const record = value as Partial<CollectionCacheRecord> | undefined;
  if (!record || !Array.isArray(record.collections) || typeof record.fetchedAt !== "number") {
    return undefined;
  }
  const collections = record.collections.filter(
    (item): item is CommonCrawlCollection =>
      typeof item?.id === "string" &&
      typeof item.name === "string" &&
      typeof item.cdxApi === "string" &&
      typeof item.from === "string" &&
      typeof item.to === "string"
  );
  return collections.length > 0
    ? { version: CACHE_VERSION, fetchedAt: record.fetchedAt, collections }
    : undefined;
}

function readCollectionCache({ allowStale = false } = {}): CommonCrawlCollection[] {
  const current = normalizeCollectionCache(readJsonStorage<unknown>(COLLECTION_CACHE_KEY));
  const legacy = normalizeCollectionCache(readJsonStorage<unknown>(LEGACY_COLLECTION_CACHE_KEY));
  const cached = current ?? legacy;
  if (!cached) return [];
  if (!allowStale && Date.now() - cached.fetchedAt > COLLECTION_CACHE_TTL_MS) return [];
  return cached.collections;
}

function writeCollectionCache(collections: CommonCrawlCollection[]): void {
  writeJsonStorage(COLLECTION_CACHE_KEY, {
    version: CACHE_VERSION,
    fetchedAt: Date.now(),
    collections
  } satisfies CollectionCacheRecord);
}

export function getCollectionCacheInfo(): CollectionCacheInfo {
  const cached = normalizeCollectionCache(readJsonStorage<unknown>(COLLECTION_CACHE_KEY));
  if (!cached) return { count: 0 };
  return {
    fetchedAt: cached.fetchedAt,
    count: cached.collections.length
  };
}

export async function fetchCollections(
  input?: AbortSignal | { signal?: AbortSignal; forceRefresh?: boolean }
): Promise<CommonCrawlCollection[]> {
  const signal = input instanceof AbortSignal ? input : input?.signal;
  const forceRefresh = !(input instanceof AbortSignal) && Boolean(input?.forceRefresh);
  const freshCached = forceRefresh ? [] : readCollectionCache();
  if (freshCached.length > 0) return freshCached;

  if (typeof window !== "undefined") {
    try {
      const response = await fetch(`/api/common-crawl/collections${forceRefresh ? "?refresh=1" : ""}`, {
        headers: { Accept: "application/json" },
        signal,
        cache: "no-store"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `Common Crawl source list returned HTTP ${response.status}`;
        throw new Error(message);
      }
      const collections = parseCollections(await response.json());
      writeCollectionCache(collections);
      return collections;
    } catch (error) {
      if (signal?.aborted) throw error;
      const staleCached = forceRefresh ? [] : readCollectionCache({ allowStale: true });
      if (staleCached.length > 0) return staleCached;
      if (error instanceof Error && error.message.startsWith("Common Crawl source list returned")) {
        throw error;
      }
      throw new Error("Could not reach Common Crawl from this network");
    }
  }

  try {
    const response = await commonCrawlFetch(COLLECTIONS_URL, {
      headers: { Accept: "application/json" },
      signal
    });
    if (!response.ok) {
      throw new Error(`Common Crawl source list returned HTTP ${response.status}`);
    }
    const collections = parseCollections(await response.json());
    writeCollectionCache(collections);
    return collections;
  } catch (error) {
    if (signal?.aborted) throw error;
    const staleCached = forceRefresh ? [] : readCollectionCache({ allowStale: true });
    if (staleCached.length > 0) return staleCached;
    if (error instanceof Error && error.message.startsWith("Common Crawl source list returned")) {
      throw error;
    }
    throw new Error("Could not reach Common Crawl from this network");
  }
}

export function refreshCollections(signal?: AbortSignal): Promise<CommonCrawlCollection[]> {
  return fetchCollections({ signal, forceRefresh: true });
}

export function parseCdxjResponse(
  text: string,
  collection: CommonCrawlCollection
): CommonCrawlCapture[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): CommonCrawlCapture[] => {
      let raw: RawCapture;
      try {
        raw = JSON.parse(line) as RawCapture;
      } catch {
        return [];
      }

      if (
        typeof raw.timestamp !== "string" ||
        typeof raw.url !== "string" ||
        typeof raw.status !== "string" ||
        typeof raw.mime !== "string" ||
        typeof raw.filename !== "string" ||
        typeof raw.offset !== "string" ||
        typeof raw.length !== "string"
      ) {
        return [];
      }

      return [
        {
          collectionId: collection.id,
          collectionName: collection.name,
          collectionFrom: collection.from,
          collectionTo: collection.to,
          timestamp: raw.timestamp,
          url: raw.url,
          status: raw.status,
          mime: raw.mime,
          digest: typeof raw.digest === "string" ? raw.digest : undefined,
          filename: raw.filename,
          offset: raw.offset,
          length: raw.length,
          redirect: typeof raw.redirect === "string" ? raw.redirect : undefined
        }
      ];
    })
    .filter((capture) => isRetainedCapture(capture))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// A capture is HTML if its MIME contains "html" (covers "text/html",
// "text/html; charset=utf-8", "application/xhtml+xml"). Shared so retention and
// prefetch agree on what counts as HTML.
export function isHtmlCaptureMime(mime: string): boolean {
  return /html/i.test(mime);
}

function isRetainedCapture(capture: CommonCrawlCapture): boolean {
  if (capture.status === "200") {
    return isHtmlCaptureMime(capture.mime);
  }
  return /^3\d\d$/.test(capture.status);
}

export function buildCdxjUrl(
  targetUrl: string,
  collection: CommonCrawlCollection,
  matchType: MatchType = DEFAULT_MATCH_TYPE,
  page?: number,
  dateWindow?: ScanDateWindow
): string {
  const params = new URLSearchParams({
    url: targetUrl,
    output: "json",
    fl: "timestamp,url,status,mime,digest,filename,offset,length,redirect"
  });
  if (matchType !== "exact") {
    params.set("matchType", matchType);
  }
  // Constrain the query server-side so Common Crawl only returns captures within
  // the window, instead of fetching everything and filtering in the browser.
  // `from`/`to` take 14-digit timestamps; pad the day to the full inclusive range.
  if (dateWindow) {
    params.set("from", `${dateWindow.from.replace(/-/g, "")}000000`);
    params.set("to", `${dateWindow.to.replace(/-/g, "")}235959`);
  }
  // No fixed `limit`: it caps a single response and would silently drop records
  // beyond the cap on every page. Pagination walks the full result set via
  // `page` instead, bounded client-side by maxCaptures/maxPages.
  if (page !== undefined) {
    params.set("page", String(page));
  }
  return `${collection.cdxApi}?${params.toString()}`;
}

// Counts non-blank lines in a raw CDXJ response so pagination can distinguish an
// in-range page (has lines, keep going) from the end of results (empty body),
// independently of how many captures survive the HTML/redirect filter.
function countCdxLines(text: string): number {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) count += 1;
  }
  return count;
}

export function filterCollectionsByRecentMonths(
  collections: CommonCrawlCollection[],
  months = DEFAULT_COLLECTION_LOOKBACK_MONTHS,
  now = new Date()
): CommonCrawlCollection[] {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return collections.filter((collection) => {
    const timestamp = parseArchiveTimestamp(collection.to || collection.from);
    return Number.isFinite(timestamp) && timestamp >= cutoff.getTime();
  });
}

export function filterCollectionsByDateRange(
  collections: CommonCrawlCollection[],
  dateFrom: string,
  dateTo: string
): CommonCrawlCollection[] {
  const fromTimestamp = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const toTimestamp = Date.parse(`${dateTo}T23:59:59.999Z`);
  if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp) || fromTimestamp > toTimestamp) {
    return [];
  }

  return collections.filter((collection) => {
    const collectionFrom = parseArchiveTimestamp(collection.from);
    const collectionTo = parseArchiveTimestamp(collection.to || collection.from);
    if (!Number.isFinite(collectionFrom) || !Number.isFinite(collectionTo)) return false;
    return collectionFrom <= toTimestamp && collectionTo >= fromTimestamp;
  });
}

function parseArchiveTimestamp(value: string): number {
  if (!value) return Number.NaN;
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : Date.parse(`${value}Z`);
}

export function buildRangeHeader(offset: string | number, length: string | number): string {
  const start = Number(offset);
  const size = Number(length);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size <= 0) {
    throw new Error("Invalid WARC range metadata");
  }
  return `bytes=${start}-${start + size - 1}`;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      globalThis.clearTimeout(timeoutId);
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener("abort", abort, { once: true });
      }
    }
  });
}

function createChildSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abort = () => controller.abort(parent?.reason);

  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      parent.addEventListener("abort", abort, { once: true });
    }
  }

  controller.signal.addEventListener(
    "abort",
    () => {
      globalThis.clearTimeout(timeoutId);
      parent?.removeEventListener("abort", abort);
    },
    { once: true }
  );

  return controller.signal;
}

function describeRequestError(
  error: unknown,
  requestSignal: AbortSignal
): { error: string; errorKind: CollectionErrorKind } {
  if (requestSignal.aborted && requestSignal.reason === "timeout") {
    return { error: "request timed out", errorKind: "timeout" };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { error: "request timed out", errorKind: "timeout" };
  }
  if (error instanceof TypeError) {
    return { error: "browser/network request failed before an HTTP response", errorKind: "network_no_response" };
  }
  return { error: "request failed before an HTTP response", errorKind: "network_no_response" };
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function describeHttpError(
  response: Response,
  body: string
): { error: string; errorKind: CollectionErrorKind } {
  if (response.status === 429) {
    return { error: "Rate limit response from Common Crawl", errorKind: "http_429_rate_limit" };
  }
  if (/SlowDown|Please reduce your request rate/i.test(body)) {
    return { error: "SlowDown response from Common Crawl", errorKind: "http_500_slowdown" };
  }
  if (response.status === 502) {
    return { error: "Bad gateway response from Common Crawl", errorKind: "http_502_bad_gateway" };
  }
  if (response.status === 503) {
    return { error: "Service unavailable response from Common Crawl", errorKind: "http_503_unavailable" };
  }
  if (response.status === 504) {
    return { error: "Gateway timeout response from Common Crawl", errorKind: "http_504_gateway_timeout" };
  }
  if (response.status >= 500) {
    return { error: "Server error response from Common Crawl", errorKind: "http_500_server_error" };
  }
  return { error: `HTTP ${response.status} response from Common Crawl`, errorKind: "http_other" };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function retryDelayForAttempt(
  attempt: number,
  retryDelayMs: number,
  retryAfterMs?: number,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS
) {
  const exponentialDelay = retryDelayMs * 2 ** attempt;
  const boundedRetryAfter = retryAfterMs === undefined ? 0 : Math.min(retryAfterMs, maxRetryDelayMs);
  return Math.min(maxRetryDelayMs, Math.max(exponentialDelay, boundedRetryAfter));
}

function shouldRetryCollectionError(errorKind: CollectionErrorKind) {
  return (
    errorKind === "network_no_response" ||
    errorKind === "timeout" ||
    errorKind === "http_429_rate_limit" ||
    errorKind === "http_500_slowdown" ||
    errorKind === "http_502_bad_gateway" ||
    errorKind === "http_503_unavailable" ||
    errorKind === "http_504_gateway_timeout"
  );
}

function commonCrawlHost(input: RequestInfo | URL): string | undefined {
  try {
    const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url);
    if (url.hostname.endsWith("commoncrawl.org")) return url.hostname;
  } catch {
    return undefined;
  }
  return undefined;
}

function withCommonCrawlHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "*/*");
  return { ...init, headers };
}

function hostMinimumIntervalMs(hostname: string): number {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test") return 0;
  return HOST_MIN_INTERVAL_MS[hostname] ?? 1_000;
}

function hostPaceIntervalMs(hostname: string, state: HostRateState): number {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test") return 0;
  if (usesAdaptivePace(hostname)) return HOST_PACE_INTERVAL_MS[state.pace];
  return hostMinimumIntervalMs(hostname);
}

function isCleanPaceStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 400 || status === 404;
}

function paceIndex(pace: CommonCrawlPaceLevel): number {
  return (["normal", "cautious", "cooldown"] satisfies CommonCrawlPaceLevel[]).indexOf(pace);
}

function fasterPace(pace: CommonCrawlPaceLevel): CommonCrawlPaceLevel {
  const paces = ["normal", "cautious", "cooldown"] satisfies CommonCrawlPaceLevel[];
  return paces[Math.max(0, paceIndex(pace) - 1)] ?? "normal";
}

function isCommonCrawlPaceLevel(value: unknown): value is CommonCrawlPaceLevel {
  return value === "normal" || value === "cautious" || value === "cooldown";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function emitRateLimitChange(change: CommonCrawlRateLimitChange): void {
  for (const listener of rateLimitListeners) {
    try {
      listener(change);
    } catch {
      // Diagnostics must not break the scan.
    }
  }
}

export function subscribeCommonCrawlRateLimitChanges(listener: (change: CommonCrawlRateLimitChange) => void): () => void {
  rateLimitListeners.add(listener);
  return () => {
    rateLimitListeners.delete(listener);
  };
}

function setHostPace(
  hostname: string,
  state: HostRateState,
  pace: CommonCrawlPaceLevel,
  reason: CommonCrawlRateLimitChange["reason"],
  httpStatus?: number
): void {
  if (!usesAdaptivePace(hostname) || state.pace === pace) return;
  const previousPace = state.pace;
  state.pace = pace;
  state.cleanRequestCount = 0;
  emitRateLimitChange({
    hostname,
    previousPace,
    pace,
    intervalMs: hostPaceIntervalMs(hostname, state),
    reason,
    cleanRequestCount: state.cleanRequestCount,
    httpStatus
  });
}

function usesAdaptivePace(hostname: string): boolean {
  return hostname === "index.commoncrawl.org" || hostname === "data.commoncrawl.org";
}

function noteCleanPaceResponse(hostname: string, state: HostRateState): void {
  if (!usesAdaptivePace(hostname)) return;
  state.consecutiveAvailabilitySignals = 0;
  if (hostname !== "data.commoncrawl.org" || state.pace === "normal") return;
  state.cleanRequestCount += 1;
  if (state.cleanRequestCount >= CLEAN_REQUESTS_PER_RECOVERY_STEP) {
    setHostPace(hostname, state, fasterPace(state.pace), "recovered");
  }
}

function noteCleanCollectionPace(hostname: string): void {
  if (!usesAdaptivePace(hostname)) return;
  const state = hostStates.get(hostname) ?? freshHostRateState(hostname);
  if (state.pace === "normal") {
    state.cleanRequestCount = 0;
    writeSharedHostRateState(hostname, state);
    return;
  }
  state.cleanRequestCount += 1;
  if (state.cleanRequestCount >= CLEAN_REQUESTS_PER_RECOVERY_STEP) {
    setHostPace(hostname, state, fasterPace(state.pace), "recovered");
  }
  writeSharedHostRateState(hostname, state);
  hostStates.set(hostname, state);
}

function noteRateLimitPaceSignal(
  hostname: string,
  state: HostRateState,
  pace: CommonCrawlPaceLevel,
  reason: CommonCrawlRateLimitChange["reason"],
  retryAfterMs?: number,
  httpStatus?: number
): void {
  state.cleanRequestCount = 0;
  state.consecutiveAvailabilitySignals += 1;
  state.availabilitySignalCount += 1;
  state.lastSignalAt = Date.now();
  setHostPace(hostname, state, pace, reason, httpStatus);
  const cooldownUntil = Date.now() + Math.max(hostPaceIntervalMs(hostname, state), retryAfterMs ?? 0);
  state.lastDelayReason = "availability-cooldown";
  extendSharedHostSlot(hostname, state, cooldownUntil);
}

function noteNetworkPaceSignal(hostname: string, state: HostRateState): void {
  if (!usesAdaptivePace(hostname)) return;
  noteRateLimitPaceSignal(hostname, state, "cooldown", "network_error");
}

function noteBadGatewayPaceSignal(hostname: string, state: HostRateState): void {
  if (!usesAdaptivePace(hostname)) return;
  const now = Date.now();
  state.badGatewayCount += 1;
  const clustered = state.lastBadGatewayAt !== undefined && now - state.lastBadGatewayAt <= BAD_GATEWAY_SIGNAL_WINDOW_MS;
  state.lastBadGatewayAt = now;
  if (clustered) {
    noteRateLimitPaceSignal(hostname, state, "cautious", "http_502", undefined, 502);
  } else {
    writeSharedHostRateState(hostname, state);
  }
}

function sharedHostRateKey(hostname: string): string {
  return `${HOST_RATE_STATE_PREFIX}${hostname}`;
}

function readSharedHostRateRecord(hostname: string): Partial<Omit<HostRateState, "chain" | "requestCount">> {
  const record = readJsonStorage<SharedHostRateRecord>(sharedHostRateKey(hostname));
  if (!record || record.version !== CACHE_VERSION) return {};
  const nextFetchAt = finiteNumber(record.nextFetchAt) ?? 0;
  const updatedAt = finiteNumber(record.updatedAt);
  if (updatedAt !== undefined && Date.now() - updatedAt > HOST_RATE_STATE_TTL_MS && nextFetchAt <= Date.now()) {
    return {};
  }
  return {
    nextFetchAt,
    pace: isCommonCrawlPaceLevel(record.pace) ? record.pace : undefined,
    cleanRequestCount: finiteNumber(record.cleanRequestCount),
    consecutiveAvailabilitySignals: finiteNumber(record.consecutiveAvailabilitySignals),
    availabilitySignalCount: finiteNumber(record.availabilitySignalCount),
    networkErrorCount: finiteNumber(record.networkErrorCount),
    badGatewayCount: finiteNumber(record.badGatewayCount),
    lastBadGatewayAt: finiteNumber(record.lastBadGatewayAt),
    lastStatus: finiteNumber(record.lastStatus),
    lastSignalAt: finiteNumber(record.lastSignalAt)
  };
}

function readSharedNextFetchAt(hostname: string): number {
  return readSharedHostRateRecord(hostname).nextFetchAt ?? 0;
}

function writeSharedHostRateState(hostname: string, state: HostRateState, nextFetchAt = state.nextFetchAt): void {
  writeJsonStorage(sharedHostRateKey(hostname), {
    version: CACHE_VERSION,
    updatedAt: Date.now(),
    nextFetchAt,
    pace: state.pace,
    cleanRequestCount: state.cleanRequestCount,
    consecutiveAvailabilitySignals: state.consecutiveAvailabilitySignals,
    availabilitySignalCount: state.availabilitySignalCount,
    networkErrorCount: state.networkErrorCount,
    badGatewayCount: state.badGatewayCount,
    lastBadGatewayAt: state.lastBadGatewayAt,
    lastStatus: state.lastStatus,
    lastSignalAt: state.lastSignalAt
  } satisfies SharedHostRateRecord);
}

function reserveSharedHostSlot(hostname: string, state: HostRateState): number {
  const now = Date.now();
  const minimumIntervalMs = hostPaceIntervalMs(hostname, state);
  const scheduledAt = Math.max(now, state.nextFetchAt, readSharedNextFetchAt(hostname));
  const nextFetchAt = scheduledAt + minimumIntervalMs;
  state.nextFetchAt = nextFetchAt;
  writeSharedHostRateState(hostname, state, nextFetchAt);
  return scheduledAt;
}

function extendSharedHostSlot(hostname: string, state: HostRateState, nextFetchAt: number): void {
  const sharedNextFetchAt = readSharedNextFetchAt(hostname);
  const extendedNextFetchAt = Math.max(sharedNextFetchAt, nextFetchAt);
  state.nextFetchAt = Math.max(state.nextFetchAt, extendedNextFetchAt);
  writeSharedHostRateState(hostname, state, extendedNextFetchAt);
}

function freshHostRateState(hostname?: string): HostRateState {
  const shared = hostname ? readSharedHostRateRecord(hostname) : {};
  return {
    chain: Promise.resolve(),
    nextFetchAt: shared.nextFetchAt ?? 0,
    pace: shared.pace ?? "normal",
    cleanRequestCount: shared.cleanRequestCount ?? 0,
    consecutiveAvailabilitySignals: shared.consecutiveAvailabilitySignals ?? 0,
    requestCount: 0,
    availabilitySignalCount: shared.availabilitySignalCount ?? 0,
    networkErrorCount: shared.networkErrorCount ?? 0,
    badGatewayCount: shared.badGatewayCount ?? 0,
    lastBadGatewayAt: shared.lastBadGatewayAt,
    lastStatus: shared.lastStatus,
    lastSignalAt: shared.lastSignalAt
  };
}

export async function commonCrawlFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const hostname = commonCrawlHost(input);
  const requestInit = withCommonCrawlHeaders(init);
  if (!hostname) return fetch(input, requestInit);

  const state = hostStates.get(hostname) ?? freshHostRateState(hostname);
  const run = state.chain
    .catch(() => {
      // Keep the queue moving after a failed request.
    })
    .then(async () => {
      const scheduledAt = reserveSharedHostSlot(hostname, state);
      const delay = Math.max(0, scheduledAt - Date.now());
      state.lastDelayMs = delay;
      state.lastDelayReason =
        delay > hostPaceIntervalMs(hostname, state) ? "shared-tab" : delay > 0 ? "minimum-interval" : undefined;
      if (delay > 0) await wait(delay, requestInit.signal ?? undefined);
      state.requestCount += 1;
      try {
        const response = await fetch(input, requestInit);
        state.lastStatus = response.status;
        if (response.status === 429) {
          const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
          noteRateLimitPaceSignal(hostname, state, "cooldown", "http_429", retryAfterMs, response.status);
        } else if (response.status === 503) {
          const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
          noteRateLimitPaceSignal(hostname, state, "cautious", "http_503", retryAfterMs, response.status);
        } else if (response.status === 502) {
          noteBadGatewayPaceSignal(hostname, state);
          extendSharedHostSlot(hostname, state, Date.now() + hostPaceIntervalMs(hostname, state));
        } else if (isCleanPaceStatus(response.status)) {
          noteCleanPaceResponse(hostname, state);
          extendSharedHostSlot(hostname, state, Date.now() + hostPaceIntervalMs(hostname, state));
        } else {
          extendSharedHostSlot(hostname, state, Date.now() + hostPaceIntervalMs(hostname, state));
        }
        return response;
      } catch (error) {
        state.networkErrorCount += 1;
        if (requestInit.signal?.aborted) {
          extendSharedHostSlot(hostname, state, Date.now() + hostPaceIntervalMs(hostname, state));
        } else {
          noteNetworkPaceSignal(hostname, state);
        }
        throw error;
      }
    });

  state.chain = run.then(
    () => undefined,
    () => undefined
  );
  hostStates.set(hostname, state);
  return run;
}

export type CommonCrawlRateLimitSnapshot = {
  hostname: string;
  minimumIntervalMs: number;
  pace: CommonCrawlPaceLevel;
  intervalMs: number;
  cleanRequestCount: number;
  localNextFetchAt: number;
  sharedNextFetchAt: number;
  consecutiveAvailabilitySignals: number;
  requestCount: number;
  availabilitySignalCount: number;
  networkErrorCount: number;
  badGatewayCount: number;
  lastBadGatewayAt?: number;
  lastStatus?: number;
  lastSignalAt?: number;
  lastDelayMs?: number;
  lastDelayReason?: HostRateState["lastDelayReason"];
};

export function getCommonCrawlRateLimitSnapshot(hostname = "index.commoncrawl.org"): CommonCrawlRateLimitSnapshot {
  const state = hostStates.get(hostname) ?? freshHostRateState(hostname);
  return {
    hostname,
    minimumIntervalMs: hostMinimumIntervalMs(hostname),
    pace: state.pace,
    intervalMs: hostPaceIntervalMs(hostname, state),
    cleanRequestCount: state.cleanRequestCount,
    localNextFetchAt: state.nextFetchAt,
    sharedNextFetchAt: readSharedNextFetchAt(hostname),
    consecutiveAvailabilitySignals: state.consecutiveAvailabilitySignals,
    requestCount: state.requestCount,
    availabilitySignalCount: state.availabilitySignalCount,
    networkErrorCount: state.networkErrorCount,
    badGatewayCount: state.badGatewayCount,
    lastBadGatewayAt: state.lastBadGatewayAt,
    lastStatus: state.lastStatus,
    lastSignalAt: state.lastSignalAt,
    lastDelayMs: state.lastDelayMs,
    lastDelayReason: state.lastDelayReason
  };
}

export function resetCommonCrawlRateLimitState(): void {
  hostStates.clear();
  try {
    if (typeof globalThis.localStorage === "undefined") return;
    for (let index = globalThis.localStorage.length - 1; index >= 0; index -= 1) {
      const key = globalThis.localStorage.key(index);
      if (key?.startsWith(HOST_RATE_STATE_PREFIX)) {
        globalThis.localStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort test/diagnostic reset.
  }
}

function noteCommonCrawlSlowDown(input: RequestInfo | URL): void {
  const hostname = commonCrawlHost(input);
  if (!hostname) return;
  const state = hostStates.get(hostname) ?? freshHostRateState(hostname);
  noteRateLimitPaceSignal(hostname, state, "cautious", "http_500_slowdown", undefined, 500);
  hostStates.set(hostname, state);
}

export function isLikelyRateLimitError(
  error: string | undefined,
  httpStatus?: number,
  errorKind?: CollectionErrorKind
): boolean {
  return (
    errorKind === "http_429_rate_limit" ||
    errorKind === "http_500_slowdown" ||
    errorKind === "http_503_unavailable" ||
    httpStatus === 429 ||
    httpStatus === 503 ||
    /rate limit|rate-limited|SlowDown|HTTP 429|HTTP 503|timeout/i.test(error ?? "")
  );
}

export function isLikelyCommonCrawlAvailabilityIssue(
  error: string | undefined,
  httpStatus?: number,
  errorKind?: CollectionErrorKind
): boolean {
  return (
    isLikelyRateLimitError(error, httpStatus, errorKind) ||
    errorKind === "network_no_response" ||
    errorKind === "timeout" ||
    errorKind === "http_500_server_error" ||
    errorKind === "http_502_bad_gateway" ||
    errorKind === "http_504_gateway_timeout" ||
    httpStatus === 500 ||
    httpStatus === 504 ||
    /Common Crawl index|response from Common Crawl|storage SlowDown|network|timed out/i.test(error ?? "")
  );
}

export async function queryCollection(
  targetUrl: string,
  collection: CommonCrawlCollection,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  retryCount = DEFAULT_RETRY_COUNT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
  matchType: MatchType = DEFAULT_MATCH_TYPE,
  onAttempt?: (attempt: CollectionAttemptLog) => void,
  onRetryWait?: (delayMs: number) => void,
  maxCaptures: number | null | undefined = DEFAULT_MAX_CAPTURES_PER_COLLECTION,
  maxPages: number | null | undefined = DEFAULT_MAX_CDX_PAGES,
  dateWindow?: ScanDateWindow
): Promise<CollectionCheckResult> {
  const captureLimit = normalizeCdxLimit(maxCaptures, DEFAULT_MAX_CAPTURES_PER_COLLECTION);
  const pageLimit = normalizeCdxLimit(maxPages, DEFAULT_MAX_CDX_PAGES);
  const cachedResult = readCachedCdxResult(targetUrl, collection, matchType, captureLimit, dateWindow);
  if (cachedResult) return cachedResult;

  let attempts = 0;
  const attemptLogs: CollectionAttemptLog[] = [];
  // Number attempts by their position among *logged* attempts, so the scan log
  // reads 1, 2, 3… without gaps. The raw request counter (`attempts`) skips
  // unlogged probes such as the HTTP 400 end-of-pagination signal, so it must
  // not drive the user-facing numbering.
  const recordAttempt = (attemptLog: Omit<CollectionAttemptLog, "attemptNumber">) => {
    const numbered: CollectionAttemptLog = { ...attemptLog, attemptNumber: attemptLogs.length + 1 };
    attemptLogs.push(numbered);
    onAttempt?.(numbered);
  };

  // Fetches one CDX page, applying the retry/backoff policy per request. The
  // outcome tells the pagination loop whether to keep walking pages, stop
  // cleanly, or surface a hard failure for the whole collection.
  type PageOutcome =
    | { kind: "page"; captures: CommonCrawlCapture[]; rawLineCount: number; httpStatus: number; checkedAt: number }
    | { kind: "end"; httpStatus?: number; checkedAt: number }
    | { kind: "failed"; error: string; errorKind: CollectionErrorKind; httpStatus?: number; checkedAt: number };

  const fetchPage = async (page: number): Promise<PageOutcome> => {
    let lastError = "request failed";
    let lastErrorKind: CollectionErrorKind = "network_no_response";
    let lastHttpStatus: number | undefined;
    let retryAfterMs: number | undefined;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      attempts += 1;
      const requestSignal = createChildSignal(signal, timeoutMs);
      const requestUrl = buildCdxjUrl(targetUrl, collection, matchType, page, dateWindow);
      try {
        const response = await commonCrawlFetch(requestUrl, {
          headers: { Accept: "application/json" },
          signal: requestSignal
        });

        if (response.status === 404) {
          // pywb returns 404 with a JSON error body when there are no captures.
          const checkedAt = Date.now();
          recordAttempt({ status: "checked", checkedAt, httpStatus: response.status, captureCount: 0 });
          return { kind: "end", httpStatus: response.status, checkedAt };
        }

        if (response.status === 400 && page > 0) {
          // Requesting a page past the last one is how pywb signals the end.
          return { kind: "end", httpStatus: response.status, checkedAt: Date.now() };
        }

        if (response.ok) {
          const text = await response.text();
          const rawLineCount = countCdxLines(text);
          const captures = parseCdxjResponse(text, collection);
          const checkedAt = Date.now();
          recordAttempt({ status: "checked", checkedAt, httpStatus: response.status, captureCount: captures.length });
          return { kind: "page", captures, rawLineCount, httpStatus: response.status, checkedAt };
        }

        lastHttpStatus = response.status;
        retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
        const described = describeHttpError(response, await readErrorBody(response));
        lastError = described.error;
        lastErrorKind = described.errorKind;
        if (lastErrorKind === "http_500_slowdown") {
          noteCommonCrawlSlowDown(requestUrl);
        }
        const checkedAt = Date.now();
        recordAttempt({
          status: "not-checked",
          checkedAt,
          httpStatus: lastHttpStatus,
          error: lastError,
          errorKind: lastErrorKind
        });

        if (response.status !== 429 && response.status < 500) {
          return { kind: "failed", error: lastError, errorKind: lastErrorKind, httpStatus: response.status, checkedAt };
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        lastHttpStatus = undefined;
        retryAfterMs = undefined;
        const described = describeRequestError(error, requestSignal);
        lastError = described.error;
        lastErrorKind = described.errorKind;
        recordAttempt({
          status: "not-checked",
          checkedAt: Date.now(),
          error: lastError,
          errorKind: lastErrorKind
        });
      }

      if (attempt < retryCount && shouldRetryCollectionError(lastErrorKind)) {
        const delayMs = retryDelayForAttempt(attempt, retryDelayMs, retryAfterMs, maxRetryDelayMs);
        onRetryWait?.(delayMs);
        await wait(delayMs, signal);
      } else {
        break;
      }
    }

    return { kind: "failed", error: lastError, errorKind: lastErrorKind, httpStatus: lastHttpStatus, checkedAt: Date.now() };
  };

  const allCaptures: CommonCrawlCapture[] = [];
  let lastHttpStatus: number | undefined;
  let lastCheckedAt = Date.now();
  let truncated = false;

  // Common Crawl's CDX index is keyed by a scheme-less SURT, so a single exact
  // query already returns captures crawled under both http:// and https://.
  // Querying protocol variants separately only doubled the requests (and the
  // capture counts) for an identical result set, so we walk the URL once.
  for (let page = 0; page < pageLimit; page += 1) {
    const outcome = await fetchPage(page);
    lastCheckedAt = outcome.checkedAt;

    if (outcome.kind === "failed") {
      // A page failed after retries. Report the whole collection as not-checked
      // so it is retried in full rather than cached as a partial result.
      return {
        collection,
        status: "not-checked",
        captures: allCaptures.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
        checkedAt: outcome.checkedAt,
        httpStatus: outcome.httpStatus,
        error: outcome.error,
        errorKind: outcome.errorKind,
        attempts,
        runs: 1,
        attemptLogs,
        ...(dateWindow ? { window: dateWindow } : {})
      };
    }

    if (outcome.httpStatus !== undefined) lastHttpStatus = outcome.httpStatus;

    if (outcome.kind === "end" || outcome.rawLineCount === 0) {
      break;
    }

    allCaptures.push(...outcome.captures);

    if (allCaptures.length >= captureLimit) {
      truncated = true;
      break;
    }

    if (page + 1 >= pageLimit) {
      truncated = true;
    }
  }

  const captures = allCaptures
    .slice(0, captureLimit)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const result: CollectionCheckResult = {
    collection,
    status: "checked",
    captures,
    checkedAt: lastCheckedAt,
    httpStatus: lastHttpStatus,
    attempts,
    runs: 1,
    blockedCaptures: blockedCapturesFor(captures),
    attemptLogs,
    ...(truncated ? { truncated: true } : {}),
    ...(dateWindow ? { window: dateWindow } : {})
  };
  const hadFailedAttempt = attemptLogs.some((attempt) => attempt.status === "not-checked");
  if (!truncated && !hadFailedAttempt) {
    noteCleanCollectionPace(commonCrawlHost(collection.cdxApi) ?? "");
  }
  writeCachedCdxResult(targetUrl, collection, matchType, captureLimit, dateWindow, result);
  return result;
}

function normalizeCdxLimit(value: number | null | undefined, fallback: number): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.round(numeric));
}

function cdxLimitCacheValue(value: number): number | "unlimited" {
  return Number.isFinite(value) ? value : "unlimited";
}

function cdxCacheKey(
  targetUrl: string,
  collection: CommonCrawlCollection,
  matchType: MatchType,
  maxCaptures: number,
  dateWindow?: ScanDateWindow
): string {
  return `${CDX_RESULT_CACHE_PREFIX}${encodeURIComponent(
    JSON.stringify({
      collectionId: collection.id,
      targetUrl,
      matchType,
      retainedCaptures: "html-200-and-redirects",
      paginated: true,
      maxCaptures: cdxLimitCacheValue(maxCaptures),
      // A windowed result is not interchangeable with a full one, so the window
      // is part of the cache identity.
      window: dateWindow ? `${dateWindow.from}:${dateWindow.to}` : "full"
    })
  )}`;
}

function readCachedCdxResult(
  targetUrl: string,
  collection: CommonCrawlCollection,
  matchType: MatchType,
  maxCaptures: number,
  dateWindow?: ScanDateWindow
): CollectionCheckResult | undefined {
  const record = readJsonStorage<CdxResultCacheRecord>(cdxCacheKey(targetUrl, collection, matchType, maxCaptures, dateWindow));
  if (!record || record.version !== CACHE_VERSION || Date.now() - record.fetchedAt > CDX_RESULT_CACHE_TTL_MS) {
    return undefined;
  }
  if (record.result?.status !== "checked") return undefined;
  return {
    ...record.result,
    collection,
    attempts: 0,
    runs: 1,
    fromCache: true,
    checkedAt: record.result.checkedAt ?? record.fetchedAt,
    blockedCaptures: blockedCapturesFor(record.result.captures ?? []),
    attemptLogs: undefined
  };
}

function writeCachedCdxResult(
  targetUrl: string,
  collection: CommonCrawlCollection,
  matchType: MatchType,
  maxCaptures: number,
  dateWindow: ScanDateWindow | undefined,
  result: CollectionCheckResult
): void {
  if (result.status !== "checked") return;
  writeJsonStorage(cdxCacheKey(targetUrl, collection, matchType, maxCaptures, dateWindow), {
    version: CACHE_VERSION,
    fetchedAt: Date.now(),
    result
  } satisfies CdxResultCacheRecord);
}

function blockedCapturesFor(captures: CommonCrawlCapture[]): BlockedCapture[] {
  return captures
    .map((capture) => ({ capture, sizeBytes: Number(capture.length) }))
    .filter((item) => Number.isFinite(item.sizeBytes) && item.sizeBytes > LARGE_CAPTURE_LIMIT_BYTES)
    .map(({ capture, sizeBytes }) => ({
      capture,
      sizeBytes,
      limitBytes: LARGE_CAPTURE_LIMIT_BYTES,
      reason: "too-large" as const
    }));
}

export async function searchCollections({
  targetUrl,
  collections,
  signal,
  concurrency = DEFAULT_CONCURRENCY,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  requestSpacingMs = DEFAULT_REQUEST_SPACING_MS,
  retryCount = DEFAULT_RETRY_COUNT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
  circuitBreakerThreshold = DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  circuitBreakerWindowSize = DEFAULT_CIRCUIT_BREAKER_WINDOW_SIZE,
  circuitBreakerWindowThreshold = DEFAULT_CIRCUIT_BREAKER_WINDOW_THRESHOLD,
  matchType = DEFAULT_MATCH_TYPE,
  maxCaptures = DEFAULT_MAX_CAPTURES_PER_COLLECTION,
  dateWindow,
  onResult,
  onProgress,
  onStop
}: {
  targetUrl: string;
  collections: CommonCrawlCollection[];
  signal?: AbortSignal;
  concurrency?: number;
  timeoutMs?: number;
  requestSpacingMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerWindowSize?: number;
  circuitBreakerWindowThreshold?: number;
  matchType?: MatchType;
  maxCaptures?: number | null;
  dateWindow?: ScanDateWindow;
  onResult?: (result: CollectionCheckResult) => void;
  onProgress?: (progress: SearchProgress) => void;
  onStop?: (reason: SearchStopReason) => void;
}) {
  let nextIndex = 0;
  let checked = 0;
  let hits = 0;
  let failed = 0;
  const active = new Set<string>();
  const results: CollectionCheckResult[] = [];
  let consecutiveRateLimitSignals = 0;
  const recentAvailabilitySignals: boolean[] = [];
  let stopReason: SearchStopReason = "completed";
  const scanStartMark = `cdx-scan:start:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  markPerformance(scanStartMark);

  const emit = () => {
    onProgress?.({
      checked,
      total: collections.length,
      hits,
      failed,
      activeCollections: Array.from(active)
    });
  };

  const worker = async () => {
    while (!signal?.aborted && nextIndex < collections.length) {
      const collection = collections[nextIndex++];
      active.add(collection.id);
      emit();
      try {
        const result = await queryCollection(
          targetUrl,
          collection,
          signal,
          timeoutMs,
          retryCount,
          retryDelayMs,
          maxRetryDelayMs,
          matchType,
          undefined,
          undefined,
          maxCaptures,
          maxCaptures === null ? null : undefined,
          dateWindow
        );
        checked += 1;
        hits += result.captures.length;
        const availabilitySignal =
          result.status === "not-checked" &&
          isLikelyCommonCrawlAvailabilityIssue(result.error, result.httpStatus, result.errorKind);
        if (result.status === "not-checked") {
          failed += 1;
          consecutiveRateLimitSignals = availabilitySignal ? consecutiveRateLimitSignals + 1 : 0;
        } else {
          consecutiveRateLimitSignals = 0;
        }
        recentAvailabilitySignals.push(availabilitySignal);
        if (!availabilitySignal) {
          recentAvailabilitySignals.length = 0;
        }
        if (recentAvailabilitySignals.length > circuitBreakerWindowSize) {
          recentAvailabilitySignals.shift();
        }
        results.push(result);
        onResult?.(result);
      } finally {
        active.delete(collection.id);
        emit();
      }

      const rollingAvailabilitySignals = recentAvailabilitySignals.filter(Boolean).length;
      if (
        consecutiveRateLimitSignals >= circuitBreakerThreshold ||
        (recentAvailabilitySignals.length >= circuitBreakerWindowSize &&
          rollingAvailabilitySignals >= circuitBreakerWindowThreshold)
      ) {
        stopReason = "circuit-breaker";
        break;
      }

      if (!signal?.aborted && requestSpacingMs > 0) {
        await wait(requestSpacingMs, signal);
      }
    }
  };

  const workerCount = Math.max(
    1,
    Math.min(Number.isFinite(concurrency) ? Math.floor(concurrency) : DEFAULT_CONCURRENCY, collections.length)
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (signal?.aborted) {
    stopReason = "aborted";
  }
  onStop?.(stopReason);

  measurePerformance("cdx-scan", scanStartMark, {
    collections: collections.length,
    hits,
    captures: results.reduce((total, result) => total + (result.captures?.length ?? 0), 0),
    stopReason
  });
  return results;
}

export function captureToViewerParams(capture: CommonCrawlCapture): URLSearchParams {
  return new URLSearchParams({
    url: capture.url,
    timestamp: capture.timestamp,
    collection: capture.collectionId,
    filename: capture.filename,
    offset: capture.offset,
    length: capture.length
  });
}

export type ResultsBackContext = {
  url?: string | null;
  match?: string | null;
  mock?: string | null;
  scope?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  history?: string | null;
  year?: string | null;
  collection?: string | null;
  mime?: string | null;
  status?: string | null;
  filter?: string | null;
  sort?: string | null;
  view?: string | null;
  page?: string | number | null;
};

export function appendResultsBackContext(params: URLSearchParams, context: ResultsBackContext): URLSearchParams {
  if (context.url) params.set("back_url", context.url);
  if (context.match) params.set("back_match", context.match);
  if (context.mock) params.set("back_mock", context.mock);
  if (context.scope === "all" || context.scope === "custom") params.set("back_scope", context.scope);
  if (context.dateFrom) params.set("back_from", context.dateFrom);
  if (context.dateTo) params.set("back_to", context.dateTo);
  if (context.history === "1") params.set("back_history", context.history);
  if (context.year && context.year !== "all") params.set("back_year", context.year);
  if (context.collection && context.collection !== "all") params.set("back_collection", context.collection);
  if (context.mime && context.mime !== "all") params.set("back_mime", context.mime);
  if (context.status && context.status !== "all") params.set("back_status", context.status);
  if (context.filter) params.set("back_filter", context.filter);
  if (context.sort) params.set("back_sort", context.sort);
  if (context.view && context.view !== "list") params.set("back_view", context.view);
  if (context.page && Number(context.page) > 1) params.set("back_page", String(context.page));
  return params;
}

export function buildResultsBackHref(context: ResultsBackContext): string | null {
  if (!context.url) return null;
  const params = new URLSearchParams();
  if (context.mock) params.set("mock", context.mock);
  if (context.match) params.set("match", context.match);
  if (context.scope === "all" || context.scope === "custom") params.set("scope", context.scope);
  if (context.dateFrom) params.set("from", context.dateFrom);
  if (context.dateTo) params.set("to", context.dateTo);
  if (context.history === "1") params.set("history", context.history);
  if (context.year && context.year !== "all") params.set("year", context.year);
  if (context.collection && context.collection !== "all") params.set("collection", context.collection);
  if (context.mime && context.mime !== "all") params.set("mime", context.mime);
  if (context.status && context.status !== "all") params.set("status", context.status);
  if (context.filter) params.set("filter", context.filter);
  if (context.sort) params.set("sort", context.sort);
  if (context.view && context.view !== "list") params.set("view", context.view);
  if (context.page && Number(context.page) > 1) params.set("page", String(context.page));
  params.set("url", context.url);
  return `/search?${params.toString()}`;
}

export function searchUrlCoversTarget(
  sourceUrl: string,
  sourceMatchType: MatchType,
  targetUrl: string,
  targetMatchType: MatchType
): boolean {
  if (sourceMatchType === "exact") {
    return canonicalComparableUrl(sourceUrl) === canonicalComparableUrl(targetUrl);
  }

  const sourceHost = comparableHost(sourceUrl);
  const targetHost = comparableHost(targetUrl);
  if (!sourceHost || !targetHost) return false;

  if (sourceMatchType === "host") {
    return sourceHost === targetHost && targetMatchType !== "domain";
  }

  return targetHost === sourceHost || targetHost.endsWith(`.${sourceHost}`);
}

function canonicalComparableUrl(value: string) {
  const parsed = parseComparableUrl(value);
  if (!parsed) return value.trim();
  parsed.hash = "";
  return parsed.toString();
}

function comparableHost(value: string) {
  const host = parseComparableUrl(value)?.hostname.toLowerCase();
  if (!host) return "";
  return host.startsWith("www.") ? host.slice(4) : host;
}

function parseComparableUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
}

export function warcRecordUrl(filename: string): string {
  return new URL(filename, DATA_BASE_URL).toString();
}
