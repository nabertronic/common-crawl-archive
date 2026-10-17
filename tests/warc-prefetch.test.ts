import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadCaptureRecord = vi.fn(async (_arg?: unknown) => ({ record: {}, source: "network" as const }));
const getSettings = vi.fn(async () => ({ htmlCacheEnabled: true }));
const consent = vi.hoisted(() => ({ granted: true }));

vi.mock("@/lib/warc", () => ({ loadCaptureRecord: (arg: unknown) => loadCaptureRecord(arg) }));
vi.mock("@/lib/capture-store", () => ({ getSettings: () => getSettings() }));
vi.mock("@/lib/website-preferences", () => ({ hasStorageConsent: () => consent.granted }));

import { prefetchCaptureRecord, __resetPrefetchStateForTests } from "@/lib/warc-prefetch";
import type { CommonCrawlCapture } from "@/lib/common-crawl";

function capture(overrides: Partial<CommonCrawlCapture> = {}): CommonCrawlCapture {
  return {
    collectionId: "CC-MAIN-2024",
    collectionName: "CC",
    collectionFrom: "",
    collectionTo: "",
    timestamp: "20240101000000",
    url: "https://example.com/",
    status: "200",
    mime: "text/html",
    digest: "d",
    filename: "f.warc.gz",
    offset: "0",
    length: "10",
    ...overrides
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetPrefetchStateForTests();
  loadCaptureRecord.mockClear();
  getSettings.mockClear();
  consent.granted = true;
  getSettings.mockResolvedValue({ htmlCacheEnabled: true });
});

afterEach(() => {
  __resetPrefetchStateForTests();
});

describe("prefetchCaptureRecord", () => {
  it("warms the cache for HTML captures once", async () => {
    const cap = capture();
    prefetchCaptureRecord(cap);
    prefetchCaptureRecord(cap); // deduped
    await flush();
    expect(loadCaptureRecord).toHaveBeenCalledTimes(1);
  });

  it("skips non-HTML captures", async () => {
    prefetchCaptureRecord(capture({ mime: "application/pdf" }));
    await flush();
    expect(loadCaptureRecord).not.toHaveBeenCalled();
  });

  it("warms HTML captures whose MIME carries a charset or is xhtml", async () => {
    prefetchCaptureRecord(capture({ mime: "text/html; charset=utf-8", offset: "10" }));
    prefetchCaptureRecord(capture({ mime: "application/xhtml+xml", offset: "20" }));
    await flush();
    expect(loadCaptureRecord).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when the HTML cache is disabled", async () => {
    getSettings.mockResolvedValue({ htmlCacheEnabled: false });
    prefetchCaptureRecord(capture());
    await flush();
    expect(loadCaptureRecord).not.toHaveBeenCalled();
  });

  it("does not read settings or warm cache without consent", async () => {
    consent.granted = false;
    prefetchCaptureRecord(capture());
    await flush();
    expect(getSettings).not.toHaveBeenCalled();
    expect(loadCaptureRecord).not.toHaveBeenCalled();
  });

  it("checks consent again after reading cache settings", async () => {
    getSettings.mockImplementationOnce(async () => {
      consent.granted = false;
      return { htmlCacheEnabled: true };
    });
    prefetchCaptureRecord(capture());
    await flush();
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(loadCaptureRecord).not.toHaveBeenCalled();
  });
});
