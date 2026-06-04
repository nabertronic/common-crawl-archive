import { buildRangeHeader, commonCrawlFetch, LARGE_CAPTURE_LIMIT_BYTES, warcRecordUrl } from "@/lib/common-crawl";
import type { CommonCrawlCapture } from "@/lib/common-crawl";
import {
  getCachedCaptureRecord,
  getSettings,
  putCachedCaptureRecord,
  type CachedHtmlCaptureRecord
} from "@/lib/capture-store";

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
    .replace(/\sstyle=["'][^"']*url\([^"']*["']/gi, "");
}

async function decompressGzip(blob: Blob): Promise<ArrayBuffer> {
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("This browser does not support DecompressionStream for gzip WARC records.");
  }

  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(resolve, ms);
    const abort = () => {
      globalThis.clearTimeout(timeoutId);
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

export async function fetchAndParseWarcRecord({
  filename,
  offset,
  length,
  signal
}: {
  filename: string;
  offset: string;
  length: string;
  signal?: AbortSignal;
}): Promise<ParsedWarcRecord> {
  const numericLength = Number(length);
  if (!Number.isFinite(numericLength) || numericLength <= 0) {
    throw new Error("Invalid WARC length metadata.");
  }
  if (numericLength > LARGE_CAPTURE_LIMIT_BYTES) {
    throw new Error("This capture is larger than the MVP viewer limit.");
  }

  let response: Response | undefined;
  let body = "";
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      response = await commonCrawlFetch(warcRecordUrl(filename), {
        headers: {
          Range: buildRangeHeader(offset, length)
        },
        signal
      });

      if (response.ok || response.status === 206) break;
      body = await response.clone().text().catch(() => "");
      if (attempt < 1 && shouldRetryWarcStatus(response.status, body)) {
        await wait(warcRetryDelay(attempt, parseRetryAfter(response.headers.get("Retry-After"))), signal);
        continue;
      }
      break;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt >= 1) throw error;
      await wait(warcRetryDelay(attempt), signal);
    }
  }

  if (!response || (!response.ok && response.status !== 206)) {
    throw new Error(`WARC range request returned HTTP ${response?.status ?? "unknown"}.`);
  }

  const decompressed = await decompressGzip(await response.blob());
  return parseWarcRecord(new TextDecoder("utf-8").decode(decompressed));
}

export async function loadCaptureRecord({
  capture,
  signal
}: {
  capture: CommonCrawlCapture;
  signal?: AbortSignal;
}): Promise<LoadedCaptureRecord> {
  const settings = await getSettings();
  if (settings.htmlCacheEnabled) {
    const cached = await getCachedCaptureRecord(capture);
    if (cached) return { record: parsedRecordFromCache(cached), source: "cache" };
  }

  const record = await fetchAndParseWarcRecord({
    filename: capture.filename,
    offset: capture.offset,
    length: capture.length,
    signal
  });
  await putCachedCaptureRecord({ capture, record });
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
