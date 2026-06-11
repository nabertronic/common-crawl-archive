import { describe, expect, it } from "vitest";
import {
  coverageDurationMs,
  coverageScanLogResults,
  captureCacheKey,
  DEFAULT_HTML_CACHE_LIMIT_BYTES,
  legacyScanSearchKey,
  legacyScanSearchKeys,
  legacyUnscopedScanSearchKey,
  scanSearchKey,
  targetIdFor
} from "@/lib/capture-store";
import type { CollectionCheckResult, CommonCrawlCollection } from "@/lib/common-crawl";

describe("capture store keys", () => {
  it("builds stable target ids from url, match type, and mock mode", () => {
    expect(targetIdFor("https://example.com/", "exact", false)).toBe(
      targetIdFor("https://example.com/", "exact", false)
    );
    expect(targetIdFor("https://example.com/", "exact", false)).not.toBe(
      targetIdFor("https://example.com/", "host", false)
    );
    expect(targetIdFor("https://example.com/", "exact", false)).not.toBe(
      targetIdFor("https://example.com/", "exact", true)
    );
  });

  it("keeps recent and full scan records in separate canonical keys", () => {
    const recent = scanSearchKey("https://example.com/", "domain", false, "recent");
    const full = scanSearchKey("https://example.com/", "domain", false, "all");

    expect(recent).not.toBe(full);
    expect(recent).toBe("live:domain:https://example.com/:scan:recent");
    expect(full).toBe("live:domain:https://example.com/:scan:all");
  });

  it("still lists old scan key formats for migration", () => {
    expect(legacyScanSearchKeys("https://example.com/", "host", false)).toEqual([
      legacyUnscopedScanSearchKey("https://example.com/", "host", false),
      legacyScanSearchKey("https://example.com/", "host", false, "recent"),
      legacyScanSearchKey("https://example.com/", "host", false, "all")
    ]);
  });

  it("builds stable HTML capture cache keys from immutable WARC range metadata", () => {
    const capture = {
      filename: "crawl-data/CC-MAIN-2026-21/segments/example.warc.gz",
      offset: "123",
      length: "456"
    };

    expect(captureCacheKey(capture)).toBe("warc:crawl-data/CC-MAIN-2026-21/segments/example.warc.gz:123:456");
    expect(captureCacheKey({ ...capture, offset: "124" })).not.toBe(captureCacheKey(capture));
  });

  it("uses a 500 MB default HTML cache limit", () => {
    expect(DEFAULT_HTML_CACHE_LIMIT_BYTES).toBe(500 * 1024 * 1024);
  });

  it("returns append-only scan log results when a coverage record has them", () => {
    const collection: CommonCrawlCollection = {
      id: "CC-MAIN-2026-21",
      name: "May 2026 Index",
      cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
      from: "2026-05-01T00:00:00",
      to: "2026-05-15T00:00:00"
    };
    const failure: CollectionCheckResult = {
      collection,
      status: "not-checked",
      captures: [],
      attempts: 1,
      runs: 1,
      error: "HTTP 503 response from Common Crawl",
      errorKind: "http_503_unavailable"
    };
    const success: CollectionCheckResult = {
      collection,
      status: "checked",
      captures: [],
      attempts: 1,
      runs: 1,
      httpStatus: 200
    };

    expect(
      coverageScanLogResults({
        targetId: "target_test",
        url: "https://example.com/",
        matchType: "exact",
        mock: false,
        collectionResults: { [collection.id]: success },
        scanLogResults: [failure, success],
        updatedAt: 123
      })
        .filter((result): result is CollectionCheckResult => !("kind" in result))
        .map((result) => result.status)
    ).toEqual(["not-checked", "checked"]);
  });

  it("adds the active scan segment to stored coverage duration", () => {
    expect(
      coverageDurationMs({
        targetId: "target_test",
        url: "https://example.com/",
        matchType: "exact",
        mock: false,
        collectionResults: {},
        durationMs: 45_000,
        activeScanStartedAt: 100_000,
        updatedAt: 100_000
      }, 130_000)
    ).toBe(75_000);
  });
});
