import type { CommonCrawlCapture } from "@/lib/common-crawl";
import type { ParsedWarcRecord } from "@/lib/warc";

const encoder = new TextEncoder();

/** Concatenate raw gzip members into one buffer (a valid multi-member .warc.gz). */
export function concatByteChunks(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** Convert a 14-digit CDX timestamp (YYYYMMDDHHMMSS) to a WARC-Date ISO string. */
export function warcDateFromTimestamp(timestamp: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(timestamp);
  if (!match) return new Date().toISOString();
  const [, y, mo, d, h, mi, s] = match;
  const parsed = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

/**
 * Build a standards-shaped WARC/1.0 `response` record (text) from a parsed
 * capture. Used for mock captures, which have no real Common Crawl bytes to
 * range-fetch; real captures are exported from their raw gzip members instead.
 */
export function buildWarcResponseRecord(capture: CommonCrawlCapture, record: ParsedWarcRecord): string {
  const headerLines = Object.entries(record.httpHeaders).map(([key, value]) => `${key}: ${value}`);
  const httpBlock = `${record.statusLine}\r\n${headerLines.join("\r\n")}\r\n\r\n${record.html}`;
  const contentLength = encoder.encode(httpBlock).length;
  const recordId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  const warcHeader = [
    "WARC/1.0",
    "WARC-Type: response",
    `WARC-Target-URI: ${capture.url}`,
    `WARC-Date: ${warcDateFromTimestamp(capture.timestamp)}`,
    `WARC-Record-ID: <urn:uuid:${recordId}>`,
    "Content-Type: application/http; msgtype=response",
    `Content-Length: ${contentLength}`
  ].join("\r\n");

  return `${warcHeader}\r\n\r\n${httpBlock}\r\n\r\n`;
}

/** Gzip UTF-8 text into a single gzip member. Browser-only (needs CompressionStream). */
export async function gzipText(text: string): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser cannot gzip WARC records (no CompressionStream).");
  }
  const stream = new Blob([encoder.encode(text)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function warcExportFilename(part: number, parts: number, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  if (parts <= 1) return `common-crawl-${day}.warc.gz`;
  return `common-crawl-${day}-part-${String(part).padStart(2, "0")}.warc.gz`;
}
