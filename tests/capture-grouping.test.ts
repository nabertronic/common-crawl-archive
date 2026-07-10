import { describe, expect, it } from "vitest";
import { groupCapturesByUrl } from "@/lib/capture-grouping";
import type { CommonCrawlCapture } from "@/lib/common-crawl";

function capture(url: string, timestamp: string): CommonCrawlCapture {
  return {
    collectionId: `CC-${timestamp.slice(0, 4)}`,
    collectionName: "col",
    collectionFrom: "",
    collectionTo: "",
    timestamp,
    url,
    status: "200",
    mime: "text/html",
    filename: `f-${timestamp}.warc.gz`,
    offset: "0",
    length: "10"
  };
}

describe("groupCapturesByUrl", () => {
  it("groups captures by URL with versions newest-first", () => {
    const groups = groupCapturesByUrl([
      capture("https://example.com/a", "20240101000000"),
      capture("https://example.com/a", "20260101000000"),
      capture("https://example.com/a", "20250101000000")
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].versions.map((version) => version.timestamp)).toEqual([
      "20260101000000",
      "20250101000000",
      "20240101000000"
    ]);
    expect(groups[0].latestTimestamp).toBe("20260101000000");
    expect(groups[0].earliestTimestamp).toBe("20240101000000");
  });

  it("orders groups alphabetically by URL", () => {
    const groups = groupCapturesByUrl([
      capture("https://example.com/zebra", "20260101000000"),
      capture("https://example.com/apple", "20260101000000"),
      capture("https://example.com/mango", "20260101000000")
    ]);
    expect(groups.map((group) => group.url)).toEqual([
      "https://example.com/apple",
      "https://example.com/mango",
      "https://example.com/zebra"
    ]);
  });

  it("returns an empty array for no captures", () => {
    expect(groupCapturesByUrl([])).toEqual([]);
  });

  it("keeps distinct URLs separate", () => {
    const groups = groupCapturesByUrl([
      capture("https://example.com/a", "20260101000000"),
      capture("https://example.com/b", "20260101000000"),
      capture("https://example.com/a", "20250101000000")
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.url.endsWith("/a"))?.versions).toHaveLength(2);
    expect(groups.find((group) => group.url.endsWith("/b"))?.versions).toHaveLength(1);
  });
});
