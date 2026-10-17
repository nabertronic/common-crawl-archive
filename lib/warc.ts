import { buildRangeHeader, commonCrawlFetch, LARGE_CAPTURE_LIMIT_BYTES, warcRecordUrl } from "@/lib/common-crawl";
import type { CommonCrawlCapture } from "@/lib/common-crawl";
import {
  getCachedCaptureRecord,
  getSettings,
  putCachedCaptureRecord,
  type CachedHtmlCaptureRecord
} from "@/lib/capture-store";
import { measureSync } from "@/lib/performance";
import { hasStorageConsent } from "@/lib/website-preferences";

const HARD_COMPRESSED_LIMIT_BYTES = 64 * 1024 * 1024;
const HARD_DECOMPRESSED_LIMIT_BYTES = 64 * 1024 * 1024;
const WARC_READ_TIMEOUT_MS = 60_000;

export type ParsedWarcRecord = {
  warcHeaders: Record<string, string>;
  httpHeaders: Record<string, string>;
  statusLine: string;
  html: string;
};

export type LoadedCaptureRecord = {
  record: ParsedWarcRecord;
  source: "cache" | "network";
};

export type CaptureCacheMode = "read-write" | "read-only" | "off";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

export function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return headers;
}

export function parseWarcRecord(text: string): ParsedWarcRecord {
  return measureSync("warc-parse", () => parseWarcRecordInner(text), { bytes: text.length });
}

function parseWarcRecordInner(text: string): ParsedWarcRecord {
  const firstSplit = text.search(/\r?\n\r?\n/);
  if (firstSplit < 0) throw new Error("WARC header boundary not found");

  const firstBoundary = text.match(/\r?\n\r?\n/);
  const firstBoundaryLength = firstBoundary?.[0].length ?? 4;
  const warcHeaderBlock = text.slice(0, firstSplit);
  const rest = text.slice(firstSplit + firstBoundaryLength);
  const secondSplit = rest.search(/\r?\n\r?\n/);
  if (secondSplit < 0) throw new Error("HTTP header boundary not found");

  const secondBoundary = rest.match(/\r?\n\r?\n/);
  const secondBoundaryLength = secondBoundary?.[0].length ?? 4;
  const httpHeaderBlock = rest.slice(0, secondSplit);
  const [statusLine = "", ...httpHeaderLines] = httpHeaderBlock.split(/\r?\n/);

  return {
    warcHeaders: parseHeaderBlock(warcHeaderBlock),
    httpHeaders: parseHeaderBlock(httpHeaderLines.join("\n")),
    statusLine,
    html: rest.slice(secondSplit + secondBoundaryLength).trim()
  };
}

// Best-effort scrub of obviously dangerous markup. This is defence-in-depth
// only: the preview always renders inside an iframe with `sandbox=""`, which is
// what actually neutralises scripts, navigation and same-origin access. Regex
// HTML sanitisation cannot be made fully robust, so it must never be the sole
// control.
export function sanitizeHtmlForPreview(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    // Archived metadata can trigger refresh navigation and link elements can
    // load stylesheets or other resources. The preview document adds its own
    // restrictive metadata after this scrub.
    .replace(/<(?:meta|link)\b[^>]*>/gi, "")
    // Strip src/href/etc. whether quoted or unquoted, and regardless of the
    // whitespace/slash that separates the attribute from the tag name.
    .replace(/[\s/](?:src|srcset|href|xlink:href|action|formaction|poster)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    // Strip inline event handlers (onclick, onerror, …) in the same way.
    .replace(/[\s/]on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    // Neutralise javascript:/vbscript: URIs in attribute-value positions
    // (after a quote or paren). src/href/action are already removed above, so
    // this targets the residual cases without touching prose that merely
    // mentions the scheme in page text.
    .replace(/(["'(])(?:javascript|vbscript):[^"'\s>]*/gi, "$1#")
    // Drop form wrappers but keep their contents; forms are inert in the
    // sandbox but must not carry an action or method into the preview.
    .replace(/<\/?form\b[^>]*>/gi, "")
    // Legacy embedding elements. Paired forms are removed with their content;
    // stray or unclosed opening/closing tags are removed on their own.
    .replace(/<applet\b[\s\S]*?<\/applet\s*>/gi, "")
    .replace(/<frameset\b[\s\S]*?<\/frameset\s*>/gi, "")
    .replace(/<\/?(?:applet|frameset|frame)\b[^>]*>/gi, "")
    // Remove @import rules from embedded stylesheets (they can pull in remote CSS).
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_match, open: string, css: string, close: string) =>
      `${open}${css.replace(/@import\b[^;]*(?:;|$)/gi, "")}${close}`)
    // Strip style attributes that load resources or run legacy expressions,
    // whatever the quoting style (double, single, or unquoted).
    .replace(/(\s)style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match: string, space: string, value: string) =>
      /url\s*\(|expression\s*\(/i.test(value) ? space : match);
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  // A pending reader.read() can stall forever, so the timeout and the external
  // abort must both (a) reject the race below and (b) cancel the stream, which
  // resolves/rejects the stalled read. Declared in this order so nothing is
  // referenced before it is initialised.
  let rejectInterrupt: ((error: Error) => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupt = reject; });
  interrupted.catch(() => undefined);
  const interrupt = (error: Error) => {
    rejectInterrupt?.(error);
    void reader.cancel(error).catch(() => undefined);
  };
  const timeoutId = globalThis.setTimeout(
    () => interrupt(new Error("WARC response read timed out.")),
    WARC_READ_TIMEOUT_MS
  );
  const onAbort = () => interrupt(new DOMException("The operation was aborted.", "AbortError"));
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("WARC response exceeded the safety limit.");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
    try { reader.releaseLock(); } catch { /* A still-pending read may block release; the stream is already cancelled. */ }
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function decompressGzip(bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("This browser does not support DecompressionStream for gzip WARC records.");
  }

  const stream = new Response(bytes.slice().buffer as ArrayBuffer).body!.pipeThrough(new DecompressionStream("gzip"));
  return readBounded(stream, HARD_DECOMPRESSED_LIMIT_BYTES, signal);
}

async function readWarcResponse(response: Response, limit: number, expectedLength: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!response.body) throw new Error("WARC response body was missing.");
  const bytes = await readBounded(response.body, limit, signal);
  if (bytes.byteLength !== expectedLength) throw new Error("WARC response body was shorter than the requested range.");
  return bytes;
}

function cancelResponse(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A response can already be locked or canceled; cleanup must stay nonblocking.
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener("abort", abort, { once: true });
      }
    }
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function warcRetryDelay(attempt: number, retryAfterMs?: number): number {
  const base = Math.max(15_000 * 2 ** attempt, retryAfterMs ?? 0);
  const capped = Math.min(base, 120_000);
  return capped + Math.round(capped * 0.2 * Math.random());
}

function shouldRetryWarcStatus(status: number, body: string): boolean {
  return status === 429 || status === 503 || status === 504 || /SlowDown|Please reduce your request rate/i.test(body);
}

// Range-fetches a single WARC record from Common Crawl with the shared
// retry/backoff policy, returning the raw HTTP response. Both the parse path and
// the raw-bytes (WARC export) path build on this so they stay consistent.
async function fetchWarcRangeResponse({
  filename,
  offset,
  length,
  largeCaptureLimitBytes = LARGE_CAPTURE_LIMIT_BYTES,
  allowLarge = false,
  retryCount = 1,
  signal
}: {
  filename: string;
  offset: string;
  length: string;
  largeCaptureLimitBytes?: number;
  allowLarge?: boolean;
  retryCount?: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const numericOffset = Number(offset);
  const numericLength = Number(length);
  if (!Number.isSafeInteger(numericOffset) || numericOffset < 0 || !Number.isSafeInteger(numericLength) || numericLength <= 0 || numericOffset + numericLength > Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid WARC length metadata.");
  }
  if (!allowLarge && numericLength > largeCaptureLimitBytes) {
    throw new Error("This capture is larger than the viewer safety limit.");
  }
  if (numericLength > HARD_COMPRESSED_LIMIT_BYTES) throw new Error("WARC record exceeds the hard safety limit.");

  let response: Response | undefined;
  let body = "";
  const attempts = Math.max(0, Math.floor(retryCount));
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      const requestController = new AbortController();
      let rejectAbort: ((error: Error) => void) | undefined;
      const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
      const abortRequest = () => {
        requestController.abort();
        rejectAbort?.(new DOMException("The operation was aborted.", "AbortError"));
      };
      const onExternalAbort = () => abortRequest();
      if (signal?.aborted) abortRequest();
      else signal?.addEventListener("abort", onExternalAbort, { once: true });
      let timedOut = false;
      let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
      // Start the header timeout once the paced host slot is acquired, so a
      // queued cooldown cannot time the request out before it is sent.
      const startTimeout = () => {
        timeoutId = globalThis.setTimeout(() => {
          timedOut = true;
          requestController.abort();
          rejectAbort?.(new Error("WARC response headers timed out."));
        }, WARC_READ_TIMEOUT_MS);
      };
      const request = commonCrawlFetch(warcRecordUrl(filename), {
        headers: {
          Range: buildRangeHeader(offset, length)
        },
        signal: requestController.signal
      }, { onSlotAcquired: startTimeout });
      void request.then((lateResponse) => { if (timedOut) cancelResponse(lateResponse); }, () => undefined);
      try {
        response = await Promise.race([request, aborted]);
      } finally {
        globalThis.clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onExternalAbort);
      }

      if (response.status === 206) break;
      if (response.status === 429 || response.status === 503 || response.status === 504 || response.status === 500) {
        try {
          const bytes = response.body ? await readBounded(response.body, 64 * 1024, signal) : new Uint8Array();
          body = new TextDecoder().decode(bytes);
        } catch {
          body = "";
        }
      }
      if (attempt < attempts && shouldRetryWarcStatus(response.status, body)) {
        await wait(warcRetryDelay(attempt, parseRetryAfter(response.headers.get("Retry-After"))), signal);
        continue;
      }
      cancelResponse(response);
      break;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt >= attempts) throw error;
      await wait(warcRetryDelay(attempt), signal);
    }
  }

  if (!response || response.status !== 206) {
    throw new Error(`WARC range request returned HTTP ${response?.status ?? "unknown"}.`);
  }
  const expectedStart = numericOffset;
  const expectedEnd = numericOffset + numericLength - 1;
  const contentRange = response.headers.get("Content-Range")?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
  if (!contentRange || Number(contentRange[1]) !== expectedStart || Number(contentRange[2]) !== expectedEnd) {
    cancelResponse(response);
    throw new Error("WARC server returned an invalid byte range.");
  }
  const contentLength = response.headers.get("Content-Length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== numericLength)) {
    cancelResponse(response);
    throw new Error("WARC response length did not match the requested range.");
  }
  return response;
}

// Returns the offset just past the first blank line at or after `from`, or -1.
function findHeaderEnd(bytes: Uint8Array, from: number): number {
  for (let i = from; i < bytes.length - 1; i += 1) {
    if (bytes[i] !== 0x0a) continue;
    if (bytes[i + 1] === 0x0a) return i + 2;
    if (bytes[i + 1] === 0x0d && bytes[i + 2] === 0x0a) return i + 3;
  }
  return -1;
}

function createTextDecoder(label: string | undefined): TextDecoder {
  try {
    return new TextDecoder(label ?? "utf-8");
  } catch {
    // Unsupported charset labels fall back to UTF-8 rather than failing the capture.
    return new TextDecoder("utf-8");
  }
}

// Decodes a decompressed WARC record in the archived page's charset instead of
// assuming UTF-8. The WARC and HTTP header blocks are ASCII, so they are decoded
// as UTF-8 and the body uses the HTTP Content-Type charset, else a <meta> charset
// sniffed from the first 2 KB, else UTF-8 (a BOM is stripped by TextDecoder).
export function decodeWarcRecordBytes(bytes: Uint8Array): string {
  const warcEnd = findHeaderEnd(bytes, 0);
  const httpEnd = warcEnd < 0 ? -1 : findHeaderEnd(bytes, warcEnd);
  if (httpEnd < 0) return new TextDecoder("utf-8").decode(bytes);

  const headerText = new TextDecoder("utf-8").decode(bytes.subarray(0, httpEnd));
  const body = bytes.subarray(httpEnd);
  const declared = headerText.match(/^content-type:[^\r\n]*charset\s*=\s*["']?([^"';\s]+)/im)?.[1]
    ?? new TextDecoder("latin1").decode(body.subarray(0, 2048))
      .match(/<meta\b[^>]*?charset\s*=\s*["']?\s*([\w-]+)/i)?.[1];
  return headerText + createTextDecoder(declared).decode(body);
}

export async function fetchAndParseWarcRecord(input: {
  filename: string;
  offset: string;
  length: string;
  largeCaptureLimitBytes?: number;
  allowLarge?: boolean;
  retryCount?: number;
  signal?: AbortSignal;
}): Promise<ParsedWarcRecord> {
  const response = await fetchWarcRangeResponse(input);
  const compressedLimit = Math.min(Number(input.length), HARD_COMPRESSED_LIMIT_BYTES);
  const compressed = await readWarcResponse(response, compressedLimit, Number(input.length), input.signal);
  const decompressed = await decompressGzip(compressed, input.signal);
  return parseWarcRecord(decodeWarcRecordBytes(decompressed));
}

/**
 * Fetch the raw, still-gzipped bytes of a single WARC record. Common Crawl
 * stores each capture as an independently-gzipped WARC member, so these bytes
 * are a valid gzip member on their own and multiple of them concatenate into a
 * standards-compliant `.warc.gz` (replayable in pywb / ReplayWeb.page).
 */
export async function fetchRawWarcRecordBytes(input: {
  filename: string;
  offset: string;
  length: string;
  largeCaptureLimitBytes?: number;
  allowLarge?: boolean;
  retryCount?: number;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const response = await fetchWarcRangeResponse(input);
  return readWarcResponse(response, Math.min(Number(input.length), HARD_COMPRESSED_LIMIT_BYTES), Number(input.length), input.signal);
}

export async function loadCaptureRecord({
  capture,
  allowLarge = false,
  cacheMode = "read-write",
  retryCount,
  signal
}: {
  capture: CommonCrawlCapture;
  allowLarge?: boolean;
  cacheMode?: CaptureCacheMode;
  retryCount?: number;
  signal?: AbortSignal;
}): Promise<LoadedCaptureRecord> {
  throwIfAborted(signal);
  const consented = hasStorageConsent();
  const settings = consented ? await getSettings() : undefined;
  throwIfAborted(signal);
  const canReadCache = consented && hasStorageConsent() && cacheMode !== "off" && settings?.htmlCacheEnabled === true;
  const canWriteCache = consented && hasStorageConsent() && cacheMode === "read-write" && settings?.htmlCacheEnabled === true;
  if (canReadCache) {
    throwIfAborted(signal);
    const cached = await getCachedCaptureRecord(capture);
    throwIfAborted(signal);
    if (cached) return { record: parsedRecordFromCache(cached), source: "cache" };
  }

  throwIfAborted(signal);
  const record = await fetchAndParseWarcRecord({
    filename: capture.filename,
    offset: capture.offset,
    length: capture.length,
    largeCaptureLimitBytes: settings?.largeCaptureLimitBytes ?? LARGE_CAPTURE_LIMIT_BYTES,
    allowLarge,
    retryCount,
    signal
  });
  throwIfAborted(signal);
  if (canWriteCache && hasStorageConsent()) {
    await putCachedCaptureRecord({ capture, record });
    throwIfAborted(signal);
  }
  return { record, source: "network" };
}

function parsedRecordFromCache(record: CachedHtmlCaptureRecord): ParsedWarcRecord {
  return {
    warcHeaders: record.warcHeaders,
    httpHeaders: record.httpHeaders,
    statusLine: record.statusLine,
    html: record.html
  };
}
