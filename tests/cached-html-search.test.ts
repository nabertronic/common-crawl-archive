import { describe, expect, it } from "vitest";
import { matchCachedHtmlRecord, type CachedHtmlCaptureRecord } from "@/lib/capture-store";

function record(overrides: Partial<CachedHtmlCaptureRecord> = {}): CachedHtmlCaptureRecord {
  return {
    cacheKey: "k1",
    ownerId: "owner",
    filename: "file.warc.gz",
    offset: "0",
    length: "100",
    url: "https://example.com/about",
    timestamp: "20260615120000",
    collectionId: "CC-MAIN-2026-26",
    mime: "text/html",
    status: "200",
    warcHeaders: {},
    httpHeaders: {},
    statusLine: "HTTP/1.1 200 OK",
    html: "<html><body><h1>Welcome</h1><p>The quick brown fox jumps.</p></body></html>",
    sizeBytes: 100,
    createdAt: 1,
    lastAccessedAt: 1,
    ...overrides
  };
}

describe("matchCachedHtmlRecord", () => {
  it("matches text in the HTML body and returns a tag-free snippet", () => {
    const match = matchCachedHtmlRecord(record(), "quick brown");
    expect(match).not.toBeNull();
    expect(match?.inUrl).toBe(false);
    expect(match?.snippet).toContain("quick brown fox");
    expect(match?.snippet).not.toContain("<");
  });

  it("matches case-insensitively (needle is pre-lowercased by the caller)", () => {
    // searchCachedHtml lowercases the query; matcher receives the lowered needle.
    expect(matchCachedHtmlRecord(record(), "welcome")).not.toBeNull();
  });

  it("matches on the URL even when the body does not contain the needle", () => {
    const match = matchCachedHtmlRecord(record({ html: "<html></html>" }), "about");
    expect(match?.inUrl).toBe(true);
  });

  it("returns null when neither body nor URL contains the needle", () => {
    expect(matchCachedHtmlRecord(record(), "nonexistent-term")).toBeNull();
  });

  it("carries through the fields needed to open the viewer", () => {
    const match = matchCachedHtmlRecord(record(), "welcome");
    expect(match).toMatchObject({
      cacheKey: "k1",
      filename: "file.warc.gz",
      offset: "0",
      length: "100",
      url: "https://example.com/about",
      timestamp: "20260615120000",
      collectionId: "CC-MAIN-2026-26"
    });
  });

  it("truncates very long snippets", () => {
    const long = `${"x".repeat(50)} needle ${"y".repeat(500)}`;
    const match = matchCachedHtmlRecord(record({ html: long }), "needle");
    expect(match?.snippet.length).toBeLessThanOrEqual(201);
  });
});
