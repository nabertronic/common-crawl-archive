import { describe, expect, it } from "vitest";
import { findChangedCaptures } from "@/lib/capture-changes";
import { captureKey } from "@/lib/scan-results";
import type { CommonCrawlCapture } from "@/lib/common-crawl";

function capture(
  url: string,
  timestamp: string,
  overrides: Partial<CommonCrawlCapture> = {}
): CommonCrawlCapture {
  return {
    collectionId: `CC-${timestamp.slice(0, 4)}`,
    collectionName: "col",
    collectionFrom: "",
    collectionTo: "",
    timestamp,
    url,
    status: "200",
    mime: "text/html",
    digest: `digest-${timestamp}`,
    filename: `f-${timestamp}.warc.gz`,
    offset: "0",
    length: "10",
    ...overrides
  };
}

describe("findChangedCaptures", () => {
  it("does not mark the first capture of a URL", () => {
    const only = capture("https://example.com/a", "20240101000000");
    expect(findChangedCaptures([only]).size).toBe(0);
  });

  it("does not mark captures with the same digest as the previous one", () => {
    const first = capture("https://example.com/a", "20240101000000", { digest: "AAA" });
    const second = capture("https://example.com/a", "20250101000000", { digest: "AAA" });
    expect(findChangedCaptures([first, second]).size).toBe(0);
  });

  it("marks a capture whose digest differs from the previous capture", () => {
    const first = capture("https://example.com/a", "20240101000000", { digest: "AAA" });
    const second = capture("https://example.com/a", "20250101000000", { digest: "BBB" });
    const third = capture("https://example.com/a", "20260101000000", { digest: "BBB" });
    const changed = findChangedCaptures([first, second, third]);
    expect([...changed]).toEqual([captureKey(second)]);
  });

  it("skips captures without a digest and keeps the comparison chain across them", () => {
    const first = capture("https://example.com/a", "20240101000000", { digest: "AAA" });
    const missing = capture("https://example.com/a", "20250101000000", { digest: undefined });
    const same = capture("https://example.com/a", "20260101000000", { digest: "AAA" });
    const changed = findChangedCaptures([first, missing, same]);
    expect(changed.has(captureKey(missing))).toBe(false);
    expect(changed.has(captureKey(same))).toBe(false);
    expect(changed.size).toBe(0);
  });

  it("compares against the last digest seen, not the first capture, when a digest is missing", () => {
    const first = capture("https://example.com/a", "20240101000000", { digest: "AAA" });
    const missing = capture("https://example.com/a", "20250101000000", { digest: undefined });
    const changed = capture("https://example.com/a", "20260101000000", { digest: "BBB" });
    expect([...findChangedCaptures([first, missing, changed])]).toEqual([captureKey(changed)]);
  });

  it("orders by timestamp, not by input order", () => {
    const newest = capture("https://example.com/a", "20260101000000", { digest: "BBB" });
    const oldest = capture("https://example.com/a", "20240101000000", { digest: "AAA" });
    const middle = capture("https://example.com/a", "20250101000000", { digest: "AAA" });
    // Input is shuffled: the changed capture is 2026 (digest BBB vs 2025 AAA).
    const changed = findChangedCaptures([newest, oldest, middle]);
    expect([...changed]).toEqual([captureKey(newest)]);
  });

  it("tracks each URL separately", () => {
    const aOld = capture("https://example.com/a", "20240101000000", { digest: "A1" });
    const aNew = capture("https://example.com/a", "20250101000000", { digest: "A2" });
    const bOld = capture("https://example.com/b", "20240101000000", { digest: "B1" });
    const bNew = capture("https://example.com/b", "20250101000000", { digest: "B1" });
    const changed = findChangedCaptures([aOld, bOld, aNew, bNew]);
    expect([...changed]).toEqual([captureKey(aNew)]);
  });

  it("ignores redirects and other non-200 captures", () => {
    const ok = capture("https://example.com/a", "20240101000000", { digest: "AAA" });
    const redirect = capture("https://example.com/a", "20250101000000", {
      status: "301",
      digest: "ZZZ",
      redirect: "https://example.com/b"
    });
    const okAfter = capture("https://example.com/a", "20260101000000", { digest: "AAA" });
    const changed = findChangedCaptures([ok, redirect, okAfter]);
    expect(changed.has(captureKey(redirect))).toBe(false);
    expect(changed.has(captureKey(okAfter))).toBe(false);
    expect(changed.size).toBe(0);
  });

  it("does not treat a redirect as the first capture of a URL", () => {
    const redirect = capture("https://example.com/a", "20240101000000", { status: "302", digest: "ZZZ" });
    const ok = capture("https://example.com/a", "20250101000000", { digest: "AAA" });
    expect(findChangedCaptures([redirect, ok]).size).toBe(0);
  });

  it("returns an empty set for no captures", () => {
    expect(findChangedCaptures([]).size).toBe(0);
  });
});
