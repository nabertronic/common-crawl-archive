#!/usr/bin/env node

const COLLECTIONS_URL = "https://index.commoncrawl.org/collinfo.json";
const DEFAULT_SPACING_MS = 1000;
const DEFAULT_RETRY_DELAY_MS = 10000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60000;
const DEFAULT_TIMEOUT_MS = 30000;
const CLEAN_REQUESTS_PER_RECOVERY_STEP = 10;
const BAD_GATEWAY_SIGNAL_WINDOW_MS = 2 * 60 * 1000;
const USER_AGENT = "Crawlback CDX benchmark (local diagnostic; https://github.com/nabertronic/common-crawl-archive)";

function parseArgs(argv) {
  const args = {
    url: "",
    match: "exact",
    scope: "recent",
    from: "",
    to: "",
    spacingMs: DEFAULT_SPACING_MS,
    retryCount: 1,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    maxRetryDelayMs: DEFAULT_MAX_RETRY_DELAY_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxCollections: 0,
    maxPages: 1,
    json: false
  };

  for (const arg of argv) {
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const [, key, value] = match;
    if (key === "url") args.url = value;
    else if (key === "match") args.match = value;
    else if (key === "scope") args.scope = value;
    else if (key === "from") args.from = value;
    else if (key === "to") args.to = value;
    else if (key === "spacing-ms") args.spacingMs = Number(value);
    else if (key === "retry-count") args.retryCount = Number(value);
    else if (key === "retry-delay-ms") args.retryDelayMs = Number(value);
    else if (key === "max-retry-delay-ms") args.maxRetryDelayMs = Number(value);
    else if (key === "timeout-ms") args.timeoutMs = Number(value);
    else if (key === "max-collections") args.maxCollections = Number(value);
    else if (key === "max-pages") args.maxPages = Number(value);
    else throw new Error(`Unknown argument: --${key}`);
  }

  if (!args.url) throw new Error("Missing --url=https://example.com/");
  if (!["exact", "host", "domain"].includes(args.match)) throw new Error("--match must be exact, host, or domain");
  if (!["recent", "all", "custom"].includes(args.scope)) throw new Error("--scope must be recent, all, or custom");
  if (args.scope === "custom" && (!args.from || !args.to)) throw new Error("--scope=custom requires --from=YYYY-MM-DD and --to=YYYY-MM-DD");

  return args;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function retryDelayForAttempt(attempt, args, retryAfterMs) {
  const exponential = args.retryDelayMs * 2 ** attempt;
  const boundedRetryAfter = retryAfterMs === undefined ? 0 : Math.min(retryAfterMs, args.maxRetryDelayMs);
  return Math.min(args.maxRetryDelayMs, Math.max(exponential, boundedRetryAfter));
}

function paceInterval(limiter, args) {
  if (limiter.pace === "fast") return args.spacingMs;
  if (limiter.pace === "normal") return 1000;
  if (limiter.pace === "cautious") return 2500;
  return 5000;
}

function setPace(limiter, pace, reason, httpStatus, args) {
  limiter.cleanRequestCount = 0;
  if (limiter.pace === pace) return;
  const previousPace = limiter.pace;
  limiter.pace = pace;
  limiter.paceChanges.push({
    previousPace,
    pace,
    reason,
    httpStatus,
    intervalMs: paceInterval(limiter, args)
  });
}

function fasterPace(pace) {
  if (pace === "cooldown") return "cautious";
  if (pace === "cautious") return "normal";
  return "fast";
}

function noteCleanResponse(limiter) {
  limiter.consecutiveAvailabilitySignals = 0;
}

function noteCleanCollection(limiter, args) {
  if (limiter.pace === "fast") {
    limiter.cleanRequestCount = 0;
    return;
  }
  limiter.cleanRequestCount += 1;
  if (limiter.cleanRequestCount >= CLEAN_REQUESTS_PER_RECOVERY_STEP) {
    setPace(limiter, fasterPace(limiter.pace), "recovered", undefined, args);
  }
}

function notePaceSignal(limiter, pace, reason, response, args) {
  limiter.availabilitySignals += 1;
  limiter.consecutiveAvailabilitySignals += 1;
  setPace(limiter, pace, reason, response.status, args);
  const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
  limiter.nextFetchAt = Math.max(limiter.nextFetchAt, Date.now() + Math.max(paceInterval(limiter, args), retryAfterMs ?? 0));
}

function noteNetworkPaceSignal(limiter, args) {
  limiter.availabilitySignals += 1;
  limiter.consecutiveAvailabilitySignals += 1;
  setPace(limiter, limiter.consecutiveAvailabilitySignals >= 2 ? "cooldown" : "cautious", "network_error", undefined, args);
  limiter.nextFetchAt = Math.max(limiter.nextFetchAt, Date.now() + paceInterval(limiter, args));
}

function noteBadGatewayPaceSignal(limiter, args) {
  const now = Date.now();
  limiter.badGatewayCount += 1;
  const clustered = limiter.lastBadGatewayAt !== undefined && now - limiter.lastBadGatewayAt <= BAD_GATEWAY_SIGNAL_WINDOW_MS;
  limiter.lastBadGatewayAt = now;
  if (!clustered) return;
  limiter.availabilitySignals += 1;
  limiter.consecutiveAvailabilitySignals += 1;
  setPace(limiter, "cautious", "http_502", 502, args);
  limiter.nextFetchAt = Math.max(limiter.nextFetchAt, Date.now() + paceInterval(limiter, args));
}

function isCleanStatus(status) {
  return (status >= 200 && status < 300) || status === 400 || status === 404;
}

function isRetryableStatus(status) {
  return [429, 500, 502, 503, 504, 509].includes(status);
}

function normalizeCollection(raw) {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw["cdx-api"] !== "string") return undefined;
  if (typeof raw.from !== "string" || typeof raw.to !== "string") return undefined;
  return {
    id: raw.id,
    name: raw.name,
    cdxApi: raw["cdx-api"],
    from: raw.from,
    to: raw.to
  };
}

function selectCollections(collections, args) {
  let selected = [...collections].sort((a, b) => b.from.localeCompare(a.from));
  if (args.scope === "recent") {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    selected = selected.filter((collection) => new Date(collection.to || collection.from) >= cutoff);
  } else if (args.scope === "custom") {
    const from = new Date(`${args.from}T00:00:00Z`);
    const to = new Date(`${args.to}T23:59:59Z`);
    selected = selected.filter((collection) => new Date(collection.to || collection.from) >= from && new Date(collection.from) <= to);
  }
  if (args.maxCollections > 0) selected = selected.slice(0, args.maxCollections);
  return selected;
}

function buildCdxUrl(targetUrl, collection, args, page) {
  const params = new URLSearchParams({
    url: targetUrl,
    output: "json",
    fl: "timestamp,url,status,mime,digest,filename,offset,length,redirect"
  });
  if (args.match !== "exact") params.set("matchType", args.match);
  if (args.scope === "custom") {
    params.set("from", `${args.from.replace(/-/g, "")}000000`);
    params.set("to", `${args.to.replace(/-/g, "")}235959`);
  }
  params.set("page", String(page));
  return `${collection.cdxApi}?${params.toString()}`;
}

async function fetchWithTimeout(url, args) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), args.timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function countLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

async function queryCollection(targetUrl, collection, args, limiter) {
  const startedAt = Date.now();
  const pages = [];
  let captures = 0;
  let attempts = 0;
  let status = "checked";
  let error = "";
  let lastHttpStatus;
  let hadFailedAttempt = false;

  for (let page = 0; page < args.maxPages; page += 1) {
    let pageDone = false;
    for (let attempt = 0; attempt <= args.retryCount; attempt += 1) {
      attempts += 1;
      const now = Date.now();
      const waitMs = Math.max(0, limiter.nextFetchAt - now);
      if (waitMs > 0) await wait(waitMs);
      limiter.nextFetchAt = Date.now() + paceInterval(limiter, args);

      const requestStartedAt = Date.now();
      try {
        const response = await fetchWithTimeout(buildCdxUrl(targetUrl, collection, args, page), args);
        lastHttpStatus = response.status;
        const requestMs = Date.now() - requestStartedAt;
        if (response.status === 429) {
          hadFailedAttempt = true;
          notePaceSignal(limiter, "cooldown", "http_429", response, args);
          pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines: 0 });
          if (attempt < args.retryCount) await wait(retryDelayForAttempt(attempt, args, parseRetryAfter(response.headers.get("Retry-After"))));
          continue;
        }
        if (response.status === 503) {
          hadFailedAttempt = true;
          notePaceSignal(limiter, "cautious", "http_503", response, args);
          pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines: 0 });
          if (attempt < args.retryCount) await wait(retryDelayForAttempt(attempt, args, parseRetryAfter(response.headers.get("Retry-After"))));
          continue;
        }
        if (response.status === 500) {
          const body = await response.text();
          if (/SlowDown|Please reduce your request rate/i.test(body)) {
            hadFailedAttempt = true;
            notePaceSignal(limiter, "cautious", "http_500_slowdown", response, args);
            pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines: 0 });
            if (attempt < args.retryCount) await wait(retryDelayForAttempt(attempt, args, parseRetryAfter(response.headers.get("Retry-After"))));
            continue;
          }
          if (attempt < args.retryCount) {
            hadFailedAttempt = true;
            pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines: 0 });
            await wait(retryDelayForAttempt(attempt, args, parseRetryAfter(response.headers.get("Retry-After"))));
            continue;
          }
          status = "not-checked";
          error = `HTTP ${response.status}`;
          pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines: 0 });
          return { collection: collection.id, status, captures, attempts, pages, durationMs: Date.now() - startedAt, lastHttpStatus, error };
        }
        if (response.status === 502) {
          hadFailedAttempt = true;
          noteBadGatewayPaceSignal(limiter, args);
        }
        if (isCleanStatus(response.status)) {
          noteCleanResponse(limiter);
        }
        if (response.status === 404 || (response.status === 400 && page > 0)) {
          pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines: 0 });
          if (!hadFailedAttempt) noteCleanCollection(limiter, args);
          return { collection: collection.id, status, captures, attempts, pages, durationMs: Date.now() - startedAt, lastHttpStatus };
        }
        if (isRetryableStatus(response.status) && attempt < args.retryCount) {
          hadFailedAttempt = true;
          pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines: 0 });
          await wait(retryDelayForAttempt(attempt, args, parseRetryAfter(response.headers.get("Retry-After"))));
          continue;
        }
        if (!response.ok) {
          status = "not-checked";
          error = `HTTP ${response.status}`;
          pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines: 0 });
          return { collection: collection.id, status, captures, attempts, pages, durationMs: Date.now() - startedAt, lastHttpStatus, error };
        }

        const text = await response.text();
        const lines = countLines(text);
        pages.push({ page, attempt: attempt + 1, httpStatus: response.status, requestMs, lines });
        captures += lines;
        pageDone = true;
        if (lines === 0) {
          if (!hadFailedAttempt) noteCleanCollection(limiter, args);
          return { collection: collection.id, status, captures, attempts, pages, durationMs: Date.now() - startedAt, lastHttpStatus };
        }
        break;
      } catch (err) {
        hadFailedAttempt = true;
        limiter.networkErrors += 1;
        noteNetworkPaceSignal(limiter, args);
        error = err instanceof Error ? err.message : String(err);
        if (attempt < args.retryCount) await wait(retryDelayForAttempt(attempt, args));
      }
    }
    if (!pageDone) {
      status = "not-checked";
      return { collection: collection.id, status, captures, attempts, pages, durationMs: Date.now() - startedAt, lastHttpStatus, error: error || "request failed" };
    }
  }

  return { collection: collection.id, status, captures, attempts, pages, durationMs: Date.now() - startedAt, lastHttpStatus, truncated: true };
}

function printUsage() {
  console.error(`Usage:
  node scripts/benchmark-cdx-scan.mjs --url=https://example.com/ [--scope=recent|all|custom] [--from=YYYY-MM-DD --to=YYYY-MM-DD]

Useful comparisons:
  node scripts/benchmark-cdx-scan.mjs --url=https://example.com/ --scope=all --spacing-ms=5000 --max-pages=1
  node scripts/benchmark-cdx-scan.mjs --url=https://example.com/ --scope=all --spacing-ms=1000 --max-pages=1

Options:
  --match=exact|host|domain       default: exact
  --spacing-ms=1000               fast healthy-path spacing between index requests
  --max-collections=20            0 means no cap
  --max-pages=1                   use 100 for app-like full pagination
  --retry-count=1
  --json                          print JSON summary only`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const collectionResponse = await fetch(COLLECTIONS_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT
    }
  });
  if (!collectionResponse.ok) throw new Error(`collinfo returned HTTP ${collectionResponse.status}`);
  const collections = selectCollections((await collectionResponse.json()).map(normalizeCollection).filter(Boolean), args);
  const limiter = {
    pace: "fast",
    nextFetchAt: 0,
    cleanRequestCount: 0,
    availabilitySignals: 0,
    consecutiveAvailabilitySignals: 0,
    networkErrors: 0,
    badGatewayCount: 0,
    lastBadGatewayAt: undefined,
    paceChanges: []
  };
  const startedAt = Date.now();
  const results = [];

  if (!args.json) {
    console.log(`Benchmarking ${collections.length} collections at ${args.spacingMs}ms spacing (${args.scope}, ${args.match}, max-pages=${args.maxPages})`);
  }

  for (const collection of collections) {
    const result = await queryCollection(args.url, collection, args, limiter);
    results.push(result);
    if (!args.json) {
      const pageSummary = result.pages.map((page) => `${page.httpStatus}:${page.lines}`).join(",");
      console.log(`${collection.id} ${result.status} ${result.durationMs}ms captures=${result.captures} attempts=${result.attempts} pages=[${pageSummary}]${result.error ? ` error=${result.error}` : ""}`);
    }
    if (limiter.consecutiveAvailabilitySignals >= 3) {
      if (!args.json) console.log("Circuit breaker: paused after 3 consecutive Common Crawl availability signals.");
      break;
    }
  }

  const durationMs = Date.now() - startedAt;
  const summary = {
    url: args.url,
    scope: args.scope,
    match: args.match,
    spacingMs: args.spacingMs,
    maxPages: args.maxPages,
    collectionsPlanned: collections.length,
    collectionsChecked: results.length,
    durationMs,
    requests: results.reduce((sum, result) => sum + result.attempts, 0),
    captures: results.reduce((sum, result) => sum + result.captures, 0),
    availabilitySignals: limiter.availabilitySignals,
    networkErrors: limiter.networkErrors,
    badGatewaySignals: limiter.badGatewayCount,
    finalPace: limiter.pace,
    paceChanges: limiter.paceChanges,
    statuses: results.reduce((counts, result) => {
      for (const page of result.pages) counts[page.httpStatus] = (counts[page.httpStatus] ?? 0) + 1;
      return counts;
    }, {}),
    results
  };

  console.log(args.json ? JSON.stringify(summary, null, 2) : `Summary ${JSON.stringify({ ...summary, results: undefined })}`);
}

main().catch((error) => {
  printUsage();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
