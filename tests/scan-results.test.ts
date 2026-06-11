import { describe, expect, it } from "vitest";
import { mergeCollectionResults } from "@/lib/scan-results";
import type { CollectionCheckResult, CommonCrawlCapture, CommonCrawlCollection } from "@/lib/common-crawl";

const collection: CommonCrawlCollection = {
  id: "CC-MAIN-2026-21",
  name: "May 2026 Index",
  cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
  from: "2026-05-01T00:00:00",
  to: "2026-05-15T00:00:00"
};

function capture(overrides: Partial<CommonCrawlCapture> = {}): CommonCrawlCapture {
  return {
    collectionId: collection.id,
    collectionName: collection.name,
    collectionFrom: collection.from,
    collectionTo: collection.to,
    timestamp: "20260501120000",
    url: "https://example.com/",
    status: "200",
    mime: "text/html",
    filename: "crawl-data/CC-MAIN-2026-21/segments/example.warc.gz",
    offset: "100",
    length: "200",
    ...overrides
  };
}

function result(overrides: Partial<CollectionCheckResult>): CollectionCheckResult {
  return {
    collection,
    status: "checked",
    captures: [],
    httpStatus: 200,
    attempts: 1,
    runs: 1,
    ...overrides
  };
}

describe("scan result merging", () => {
  it("keeps existing captures but marks the latest status failed when a later scan fails", () => {
    const existingHit = result({ captures: [capture()] });
    const laterFailure = result({
      status: "not-checked",
      captures: [],
      httpStatus: 503,
      error: "HTTP 503 response from Common Crawl",
      errorKind: "http_503_unavailable"
    });

    expect(mergeCollectionResults([existingHit], [laterFailure])).toMatchObject([
      {
        status: "not-checked",
        captures: [expect.objectContaining({ timestamp: "20260501120000" })],
        errorKind: "http_503_unavailable",
        attempts: 2,
        runs: 2
      }
    ]);
  });

  it("marks an existing checked-empty result failed when a later scan fails", () => {
    const checkedEmpty = result({ captures: [], httpStatus: 404 });
    const laterFailure = result({
      status: "not-checked",
      captures: [],
      httpStatus: 504,
      error: "HTTP 504 response from Common Crawl",
      errorKind: "http_504_gateway_timeout"
    });

    expect(mergeCollectionResults([checkedEmpty], [laterFailure])).toMatchObject([
      {
        status: "not-checked",
        captures: [],
        httpStatus: 504,
        attempts: 2,
        runs: 2
      }
    ]);
  });

  it("replaces an old failure when a retry gets a valid checked result", () => {
    const oldFailure = result({
      status: "not-checked",
      captures: [],
      httpStatus: 503,
      error: "HTTP 503 response from Common Crawl",
      errorKind: "http_503_unavailable"
    });
    const retrySuccess = result({ captures: [capture({ offset: "300" })] });

    expect(mergeCollectionResults([oldFailure], [retrySuccess])).toMatchObject([
      {
        status: "checked",
        captures: [expect.objectContaining({ offset: "300" })],
        attempts: 2,
        runs: 2
      }
    ]);
  });

  it("merges duplicate checked hits without duplicating captures", () => {
    const first = result({ captures: [capture()] });
    const second = result({ captures: [capture(), capture({ offset: "300" })] });

    expect(mergeCollectionResults([first], [second])[0].captures.map((item) => item.offset)).toEqual(["100", "300"]);
  });
});
