export const COLLECTIONS_URL = "https://index.commoncrawl.org/collinfo.json";
export const DATA_BASE_URL = "https://data.commoncrawl.org/";
export const DEFAULT_CONCURRENCY = 1;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_REQUEST_SPACING_MS = 5_000;
export const DEFAULT_RETRY_COUNT = 1;
export const DEFAULT_RETRY_DELAY_MS = 15_000;
export const DEFAULT_MAX_RETRY_DELAY_MS = 120_000;
export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 3;
export const DEFAULT_CIRCUIT_BREAKER_WINDOW_SIZE = 8;
export const DEFAULT_CIRCUIT_BREAKER_WINDOW_THRESHOLD = 7;
export const DEFAULT_CDX_LIMIT = 1000;
export const DEFAULT_COLLECTION_LOOKBACK_MONTHS = 12;
export const COLLECTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const CDX_RESULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LARGE_CAPTURE_LIMIT_BYTES = 15 * 1024 * 1024;

const COLLECTION_CACHE_KEY = "snapshot-search:common-crawl-collections:v2";
const LEGACY_COLLECTION_CACHE_KEY = "snapshot-search:common-crawl-collections";
const CDX_RESULT_CACHE_PREFIX = "snapshot-search:common-crawl-cdx:v2:";
const CACHE_VERSION = 1;
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  "index.commoncrawl.org": DEFAULT_REQUEST_SPACING_MS,
  "data.commoncrawl.org": 1_000
};

const hostStates = new Map<string, { chain: Promise<void>; nextFetchAt: number }>();

export type CommonCrawlCollection = {
  id: string;
  name: string;
  cdxApi: string;
  from: string;
  to: string;
};

export type MatchType = "exact" | "host" | "domain";

export const DEFAULT_MATCH_TYPE: MatchType = "exact";

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
};

export type CollectionAttemptLog = {
  status: "checked" | "not-checked";
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
    | "retry-started"
    | "continue-started"
    | "auto-retry-started"
    | "auto-retry-enabled"
    | "auto-retry-disabled"
    | "auto-retry-scheduled"
    | "auto-retry-skipped"
    | "cache-hit"
    | "collection-skipped"
    | "fresh-scan-cleared"
    | "html-zip-cancelled"
    | "html-zip-completed"
    | "html-zip-failed"
    | "html-zip-started"
    | "opt-out-checked"
    | "request-timeout"
    | "retry-wait-started"
    | "robots-cached"
    | "robots-checked"
    | "scan-completed"
    | "scan-cancelled"
    | "scan-paused"
    | "scan-failed"
    | "scope-selected"
    | "stored-coverage-loaded";
  checkedAt?: number;
  message: string;
  tone?: "neutral" | "amber" | "red";
};

export type ScanLogEntry = CollectionCheckResult | ScanLogEvent;

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

type CdxResultCacheRecord = {
  version: number;
  fetchedAt: number;
  result: CollectionCheckResult;
};

type RawCollection = {
  id?: unknown;
  name?: unknown;
  "cdx-api"?: unknown;
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
      if (
        typeof raw.id !== "string" ||
        typeof raw.name !== "string" ||
        typeof raw["cdx-api"] !== "string" ||
        typeof raw.from !== "string" ||
        typeof raw.to !== "string"
      ) {
        return [];
      }

      return [
        {
          id: raw.id,
          name: raw.name,
          cdxApi: raw["cdx-api"],
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

export async function fetchCollections(signal?: AbortSignal): Promise<CommonCrawlCollection[]> {
  const freshCached = readCollectionCache();
  if (freshCached.length > 0) return freshCached;

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
    const staleCached = readCollectionCache({ allowStale: true });
    if (staleCached.length > 0) return staleCached;
    if (error instanceof Error && error.message.startsWith("Common Crawl source list returned")) {
      throw error;
    }
    throw new Error("Could not reach Common Crawl from this network");
  }
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

function isRetainedCapture(capture: CommonCrawlCapture): boolean {
  if (capture.status === "200") {
    return /html/i.test(capture.mime);
  }
  return /^3\d\d$/.test(capture.status);
}

export function buildCdxjUrl(
  targetUrl: string,
  collection: CommonCrawlCollection,
  matchType: MatchType = DEFAULT_MATCH_TYPE
): string {
  const params = new URLSearchParams({
    url: targetUrl,
    output: "json",
    fl: "timestamp,url,status,mime,digest,filename,offset,length,redirect",
    limit: String(DEFAULT_CDX_LIMIT)
  });
  if (matchType !== "exact") {
    params.set("matchType", matchType);
  }
  return `${collection.cdxApi}?${params.toString()}`;
}

export function filterCollectionsByRecentMonths(
  collections: CommonCrawlCollection[],
  months = DEFAULT_COLLECTION_LOOKBACK_MONTHS,
  now = new Date()
): CommonCrawlCollection[] {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return collections.filter((collection) => {
    const timestamp = Date.parse(collection.to || collection.from);
    return Number.isFinite(timestamp) && timestamp >= cutoff.getTime();
  });
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
  const baseDelay = Math.max(exponentialDelay, boundedRetryAfter);
  const jitter = Math.round(baseDelay * 0.2 * Math.random());
  return Math.min(maxRetryDelayMs, baseDelay + jitter);
}

function shouldRetryCollectionError(errorKind: CollectionErrorKind) {
  return (
    errorKind === "network_no_response" ||
    errorKind === "timeout" ||
    errorKind === "http_429_rate_limit" ||
    errorKind === "http_500_slowdown" ||
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

export async function commonCrawlFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const hostname = commonCrawlHost(input);
  const requestInit = withCommonCrawlHeaders(init);
  if (!hostname) return fetch(input, requestInit);

  const state = hostStates.get(hostname) ?? { chain: Promise.resolve(), nextFetchAt: 0 };
  const run = state.chain
    .catch(() => {
      // Keep the queue moving after a failed request.
    })
    .then(async () => {
      const delay = Math.max(0, state.nextFetchAt - Date.now());
      if (delay > 0) await wait(delay, requestInit.signal ?? undefined);
      try {
        return await fetch(input, requestInit);
      } finally {
        state.nextFetchAt = Date.now() + hostMinimumIntervalMs(hostname);
      }
    });

  state.chain = run.then(
    () => undefined,
    () => undefined
  );
  hostStates.set(hostname, state);
  return run;
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
  onRetryWait?: (delayMs: number) => void
): Promise<CollectionCheckResult> {
  const cachedResult = readCachedCdxResult(targetUrl, collection, matchType);
  if (cachedResult) return cachedResult;

  let lastError = "request failed";
  let lastErrorKind: CollectionErrorKind = "network_no_response";
  let lastHttpStatus: number | undefined;
  let retryAfterMs: number | undefined;
  let attempts = 0;
  const attemptLogs: CollectionAttemptLog[] = [];
  const recordAttempt = (attemptLog: CollectionAttemptLog) => {
    attemptLogs.push(attemptLog);
    onAttempt?.(attemptLog);
  };

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    attempts = attempt + 1;
    const requestSignal = createChildSignal(signal, timeoutMs);
    try {
      const response = await commonCrawlFetch(buildCdxjUrl(targetUrl, collection, matchType), {
        headers: { Accept: "application/json" },
        signal: requestSignal
      });

      if (response.status === 404) {
        const checkedAt = Date.now();
        recordAttempt({
          status: "checked",
          checkedAt,
          httpStatus: response.status,
          captureCount: 0
        });
        const result: CollectionCheckResult = {
          collection,
          status: "checked",
          captures: [],
          checkedAt,
          httpStatus: response.status,
          attempts,
          runs: 1,
          attemptLogs
        };
        writeCachedCdxResult(targetUrl, collection, matchType, result);
        return result;
      }

      if (response.ok) {
        const captures = parseCdxjResponse(await response.text(), collection);
        const checkedAt = Date.now();
        recordAttempt({
          status: "checked",
          checkedAt,
          httpStatus: response.status,
          captureCount: captures.length
        });
        const result: CollectionCheckResult = {
          collection,
          status: "checked",
          captures,
          checkedAt,
          httpStatus: response.status,
          attempts,
          runs: 1,
          blockedCaptures: blockedCapturesFor(captures),
          attemptLogs
        };
        writeCachedCdxResult(targetUrl, collection, matchType, result);
        return result;
      }

      lastHttpStatus = response.status;
      retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
      const described = describeHttpError(response, await readErrorBody(response));
      lastError = described.error;
      lastErrorKind = described.errorKind;
      const checkedAt = Date.now();
      recordAttempt({
        status: "not-checked",
        checkedAt,
        httpStatus: lastHttpStatus,
        error: lastError,
        errorKind: lastErrorKind
      });

      if (response.status !== 429 && response.status < 500) {
        return {
          collection,
          status: "not-checked",
          captures: [],
          checkedAt,
          httpStatus: response.status,
          error: lastError,
          errorKind: lastErrorKind,
          attempts,
          runs: 1,
          attemptLogs
        };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      lastHttpStatus = undefined;
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

  return {
    collection,
    status: "not-checked",
    captures: [],
    checkedAt: Date.now(),
    httpStatus: lastHttpStatus,
    error: lastError,
    errorKind: lastErrorKind,
    attempts,
    runs: 1,
    attemptLogs
  };
}

function cdxCacheKey(targetUrl: string, collection: CommonCrawlCollection, matchType: MatchType): string {
  return `${CDX_RESULT_CACHE_PREFIX}${encodeURIComponent(
    JSON.stringify({
      collectionId: collection.id,
      targetUrl,
      matchType,
      retainedCaptures: "html-200-and-redirects",
      limit: DEFAULT_CDX_LIMIT
    })
  )}`;
}

function readCachedCdxResult(
  targetUrl: string,
  collection: CommonCrawlCollection,
  matchType: MatchType
): CollectionCheckResult | undefined {
  const record = readJsonStorage<CdxResultCacheRecord>(cdxCacheKey(targetUrl, collection, matchType));
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
  result: CollectionCheckResult
): void {
  if (result.status !== "checked") return;
  writeJsonStorage(cdxCacheKey(targetUrl, collection, matchType), {
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
          matchType
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

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, collections.length, 1)) }, () => worker())
  );

  if (signal?.aborted) {
    stopReason = "aborted";
  }
  onStop?.(stopReason);

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
  if (context.scope === "all") params.set("back_scope", context.scope);
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
  if (context.scope === "all") params.set("scope", context.scope);
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
