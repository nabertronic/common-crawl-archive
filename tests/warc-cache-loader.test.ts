import { describe, expect, it, vi } from "vitest";
import type { CommonCrawlCapture } from "@/lib/common-crawl";

const getCachedCaptureRecord = vi.fn();
const putCachedCaptureRecord = vi.fn();

vi.mock("@/lib/capture-store", () => ({
  getSettings: vi.fn(async () => ({
    id: "active",
    activeUserId: "local",
    htmlCacheEnabled: true,
    htmlCacheLimitBytes: 500 * 1024 * 1024,
    autoPruneEnabled: true,
    updatedAt: 1
  })),
  getCachedCaptureRecord,
  putCachedCaptureRecord
}));

describe("WARC capture cache loader", () => {
  it("returns cached HTML captures without writing a duplicate cache record", async () => {
    const capture: CommonCrawlCapture = {
      collectionId: "CC-MAIN-2026-21",
      collectionName: "May 2026 Index",
      collectionFrom: "2026-05-01T00:00:00",
      collectionTo: "2026-05-31T00:00:00",
      timestamp: "20260512000000",
      url: "https://example.com/",
      status: "200",
      mime: "text/html",
      filename: "crawl-data/example.warc.gz",
      offset: "10",
      length: "100"
    };
    getCachedCaptureRecord.mockResolvedValueOnce({
      cacheKey: "warc:crawl-data/example.warc.gz:10:100",
      ownerId: "local",
      filename: capture.filename,
      offset: capture.offset,
      length: capture.length,
      warcHeaders: { "WARC-Type": "response" },
      httpHeaders: { "Content-Type": "text/html" },
      statusLine: "HTTP/1.1 200 OK",
      html: "<html>Cached</html>",
      sizeBytes: 19,
      createdAt: 1,
      lastAccessedAt: 2
    });

    const { loadCaptureRecord } = await import("@/lib/warc");
    const loaded = await loadCaptureRecord({ capture });

    expect(loaded.source).toBe("cache");
    expect(loaded.record.html).toBe("<html>Cached</html>");
    expect(putCachedCaptureRecord).not.toHaveBeenCalled();
  });
});
