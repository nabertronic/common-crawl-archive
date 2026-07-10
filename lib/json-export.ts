import { warcRecordUrl, type CommonCrawlCapture } from "@/lib/common-crawl";

/**
 * A self-describing, machine-readable view of a capture for JSON export. Unlike
 * the CSV export (which honours the user's selected columns), JSON always
 * carries every field so downstream tooling has the full record.
 */
export type CaptureExportRecord = {
  url: string;
  timestamp: string;
  collectionId: string;
  collectionName: string;
  status: string;
  mime: string;
  digest?: string;
  warcUrl: string;
  warcFilename: string;
  offset: string;
  length: string;
  redirect?: string;
};

export function captureToExportRecord(capture: CommonCrawlCapture): CaptureExportRecord {
  return {
    url: capture.url,
    timestamp: capture.timestamp,
    collectionId: capture.collectionId,
    collectionName: capture.collectionName,
    status: capture.status,
    mime: capture.mime,
    ...(capture.digest ? { digest: capture.digest } : {}),
    warcUrl: warcRecordUrl(capture.filename),
    warcFilename: capture.filename,
    offset: capture.offset,
    length: capture.length,
    ...(capture.redirect ? { redirect: capture.redirect } : {})
  };
}

/** Pretty-print a value as JSON text with a trailing newline. */
export function toJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Build a JSON export document for a set of captures. The top-level object wraps
 * the records with a little provenance so an exported file is self-explanatory.
 */
export function buildCapturesJson(captures: CommonCrawlCapture[], exportedAt = new Date()): string {
  return toJsonText({
    source: "Common Crawl",
    tool: "Crawlback",
    exportedAt: exportedAt.toISOString(),
    captureCount: captures.length,
    captures: captures.map(captureToExportRecord)
  });
}
