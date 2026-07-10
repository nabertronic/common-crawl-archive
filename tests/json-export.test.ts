import { describe, expect, it } from "vitest";
import { buildCapturesJson, captureToExportRecord, toJsonText } from "@/lib/json-export";
import type { CommonCrawlCapture } from "@/lib/common-crawl";

function capture(overrides: Partial<CommonCrawlCapture> = {}): CommonCrawlCapture {
  return {
    collectionId: "CC-MAIN-2026-26",
    collectionName: "June 2026",
    collectionFrom: "2026-06-01",
    collectionTo: "2026-06-30",
    timestamp: "20260615000000",
    url: "https://example.com/",
    status: "200",
    mime: "text/html",
    digest: "sha1:abc",
    filename: "crawl-data/CC-MAIN-2026-26/segment/file.warc.gz",
    offset: "100",
    length: "2048",
    ...overrides
  };
}

describe("captureToExportRecord", () => {
  it("maps all fields and derives the WARC URL", () => {
    const record = captureToExportRecord(capture());
    expect(record).toMatchObject({
      url: "https://example.com/",
      timestamp: "20260615000000",
      collectionId: "CC-MAIN-2026-26",
      status: "200",
      mime: "text/html",
      digest: "sha1:abc",
      warcFilename: "crawl-data/CC-MAIN-2026-26/segment/file.warc.gz",
      offset: "100",
      length: "2048"
    });
    expect(record.warcUrl).toBe("https://data.commoncrawl.org/crawl-data/CC-MAIN-2026-26/segment/file.warc.gz");
  });

  it("omits optional fields when absent", () => {
    const record = captureToExportRecord(capture({ digest: undefined, redirect: undefined }));
    expect(record).not.toHaveProperty("digest");
    expect(record).not.toHaveProperty("redirect");
  });

  it("includes redirect when present", () => {
    const record = captureToExportRecord(capture({ status: "301", redirect: "https://example.com/new" }));
    expect(record.redirect).toBe("https://example.com/new");
  });
});

describe("buildCapturesJson", () => {
  it("produces valid, self-describing JSON with provenance", () => {
    const json = buildCapturesJson([capture(), capture({ url: "https://example.com/a" })], new Date("2026-07-08T00:00:00Z"));
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({
      source: "Common Crawl",
      tool: "Crawlback",
      exportedAt: "2026-07-08T00:00:00.000Z",
      captureCount: 2
    });
    expect(parsed.captures).toHaveLength(2);
    expect(parsed.captures[1].url).toBe("https://example.com/a");
    expect(json.endsWith("\n")).toBe(true);
  });
});

describe("toJsonText", () => {
  it("pretty-prints with a trailing newline", () => {
    expect(toJsonText({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
