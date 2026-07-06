import { describe, expect, it } from "vitest";
import {
  coverageDurationMs,
  coverageScanLogResults,
  captureCacheKey,
  DEFAULT_CAPTURE_EXPORT_COLUMNS,
  DEFAULT_CAPTURE_SORT,
  DEFAULT_HTML_CACHE_LIMIT_BYTES,
  DEFAULT_HISTORY_PAGE_SIZE,
  DEFAULT_LARGE_CAPTURE_LIMIT_BYTES,
  DEFAULT_SEARCH_PAGE_SIZE,
  legacyScanSearchKey,
  legacyScanSearchKeys,
  legacyUnscopedScanSearchKey,
  mergeStoredSearchRecords,
  normalizeScanUrl,
  scanSearchKey,
  scanLogDurationMs,
  targetIdFor,
  type StoredSearch
} from "@/lib/capture-store";
import type { CollectionCheckResult, CommonCrawlCapture, CommonCrawlCollection, ScanLogEvent } from "@/lib/common-crawl";

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

  it("maps raw pre-normalization inputs to the same target as their canonical URL", () => {
    expect(normalizeScanUrl("hutt.io")).toBe("https://hutt.io/");
    expect(normalizeScanUrl("  https://hutt.io ")).toBe("https://hutt.io/");
    expect(normalizeScanUrl("https://hutt.io/page#section")).toBe("https://hutt.io/page");
    expect(normalizeScanUrl("https://hutt.io/")).toBe("https://hutt.io/");
    expect(normalizeScanUrl("not a url")).toBe("not a url");

    expect(targetIdFor("hutt.io", "domain", false)).toBe(
      targetIdFor("https://hutt.io/", "domain", false)
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

  it("exposes stable defaults for configurable UI preferences", () => {
    expect(DEFAULT_CAPTURE_SORT).toBe("timestamp-desc");
    expect(DEFAULT_SEARCH_PAGE_SIZE).toBe(100);
    expect(DEFAULT_HISTORY_PAGE_SIZE).toBe(25);
    expect(DEFAULT_LARGE_CAPTURE_LIMIT_BYTES).toBe(15 * 1024 * 1024);
    expect(DEFAULT_CAPTURE_EXPORT_COLUMNS).toEqual([
      "url",
      "timestamp",
      "collection",
      "status",
      "mime",
      "digest",
      "warcUrl",
      "warcPosition"
    ]);
  });

  it("merges saved scan records without letting a later missing run hide previous coverage", () => {
    const firstCollection: CommonCrawlCollection = {
      id: "CC-MAIN-2026-21",
      name: "May 2026 Index",
      cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
      from: "2026-05-01T00:00:00",
      to: "2026-05-15T00:00:00"
    };
    const secondCollection: CommonCrawlCollection = {
      id: "CC-MAIN-2026-25",
      name: "June 2026 Index",
      cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-25-index",
      from: "2026-06-01T00:00:00",
      to: "2026-06-15T00:00:00"
    };
    const checkedCapture: CommonCrawlCapture = {
      url: "https://example.com/",
      timestamp: "20260501120000",
      status: "200",
      mime: "text/html",
      digest: "digest",
      length: "100",
      offset: "10",
      filename: "crawl-data/old.warc.gz",
      collectionId: firstCollection.id,
      collectionName: firstCollection.name,
      collectionFrom: firstCollection.from,
      collectionTo: firstCollection.to
    };
    const storedFullScan: StoredSearch = {
      key: "live:domain:https://example.com/:scan:all:old",
      url: "https://example.com/",
      matchType: "domain",
      mock: false,
      captures: [checkedCapture],
      scanScope: "all",
      collections: [firstCollection],
      collectionIds: [firstCollection.id],
      results: [
        {
          collection: firstCollection,
          status: "checked",
          captures: [checkedCapture],
          attempts: 1,
          runs: 1
        }
      ],
      updatedAt: 1
    };
    const failedMissingRun: StoredSearch = {
      key: "live:domain:https://example.com/:scan:all",
      url: "https://example.com/",
      matchType: "domain",
      mock: false,
      captures: [],
      scanScope: "all",
      collectionIds: [firstCollection.id, secondCollection.id],
      results: [
        {
          collection: secondCollection,
          status: "not-checked",
          captures: [],
          attempts: 1,
          runs: 1,
          error: "browser/network request failed before an HTTP response"
        }
      ],
      updatedAt: 2
    };

    const merged = mergeStoredSearchRecords([failedMissingRun, storedFullScan]);

    expect(merged?.collectionIds).toEqual([firstCollection.id]);
    expect(merged?.results?.map((result) => [result.collection.id, result.status])).toEqual([
      [secondCollection.id, "not-checked"],
      [firstCollection.id, "checked"]
    ]);
    expect(merged?.captures).toEqual([checkedCapture]);
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

  it("filters restore-only coverage events from persisted scan logs", () => {
    const collection: CommonCrawlCollection = {
      id: "CC-MAIN-2026-21",
      name: "May 2026 Index",
      cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
      from: "2026-05-08T07:40:46",
      to: "2026-05-21T22:06:58"
    };
    const result: CollectionCheckResult = {
      collection,
      status: "checked",
      captures: [],
      checkedAt: 1_000,
      attempts: 1,
      runs: 1
    };
    const restoreEvent: ScanLogEvent = {
      kind: "event",
      event: "stored-coverage-loaded",
      checkedAt: 2_000,
      message: "Loaded stored coverage · 1 collection · 0 captures."
    };

    expect(coverageScanLogResults({
      targetId: "target:https://example.com/:exact:live",
      ownerId: "owner_test",
      url: "https://example.com/",
      matchType: "exact",
      mock: false,
      collectionResults: { [collection.id]: result },
      scanLogResults: [result, restoreEvent],
      updatedAt: 3_000
    })).toEqual([result]);
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

  it("infers stored scan duration from scan log timestamps", () => {
    const collection: CommonCrawlCollection = {
      id: "CC-MAIN-2026-21",
      name: "May 2026 Index",
      cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
      from: "2026-05-01T00:00:00",
      to: "2026-05-15T00:00:00"
    };

    expect(scanLogDurationMs([
      {
        kind: "event",
        event: "scan-started",
        checkedAt: 10_000,
        message: "Scan started."
      },
      {
        collection,
        status: "checked",
        captures: [],
        attempts: 1,
        runs: 1,
        checkedAt: 70_000
      },
      {
        kind: "event",
        event: "scan-completed",
        checkedAt: 75_000,
        message: "Scan completed."
      }
    ])).toBe(65_000);
  });
});
