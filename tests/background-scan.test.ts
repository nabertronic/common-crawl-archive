import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundScanSupported,
  cancelBackgroundScan,
  isCdxIndexRequest,
  planScanFetches,
  prefetchScanInBackground,
  SCAN_CANCEL,
  SCAN_PREFETCH
} from "@/lib/background-scan";
import type { CommonCrawlCollection } from "@/lib/common-crawl";
import { grantStorageConsent, resetStorageConsentSession, revokeStorageConsent } from "@/lib/website-preferences";

function collection(id: string): CommonCrawlCollection {
  return {
    id,
    name: id,
    cdxApi: `https://index.commoncrawl.org/${id}-index`,
    from: "2026-01-01",
    to: "2026-02-01"
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key), clear: () => values.clear()
  } });
  resetStorageConsentSession();
  grantStorageConsent();
});

describe("planScanFetches", () => {
  it("builds one CDX URL per not-yet-covered collection", () => {
    const urls = planScanFetches({
      url: "https://example.com/",
      matchType: "exact",
      collections: [collection("CC-A"), collection("CC-B")],
      coveredCollectionIds: ["CC-A"]
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("https://index.commoncrawl.org/CC-B-index");
    expect(urls[0]).toContain("url=https%3A%2F%2Fexample.com%2F");
    expect(urls[0]).toContain("page=0");
  });

  it("passes the date window through to the CDX query", () => {
    const [url] = planScanFetches({
      url: "https://example.com/",
      matchType: "domain",
      collections: [collection("CC-A")],
      dateWindow: { from: "2026-01-05", to: "2026-01-20" }
    });
    expect(url).toContain("matchType=domain");
    expect(url).toContain("from=20260105000000");
    expect(url).toContain("to=20260120235959");
  });

  it("returns nothing when every collection is already covered", () => {
    expect(
      planScanFetches({
        url: "https://example.com/",
        matchType: "exact",
        collections: [collection("CC-A")],
        coveredCollectionIds: ["CC-A"]
      })
    ).toEqual([]);
  });
});

describe("isCdxIndexRequest", () => {
  it("matches the Common Crawl index host only", () => {
    expect(isCdxIndexRequest("https://index.commoncrawl.org/CC-MAIN-index?url=x")).toBe(true);
    expect(isCdxIndexRequest("https://data.commoncrawl.org/crawl/x.warc.gz")).toBe(false);
    expect(isCdxIndexRequest("https://evil.example/index.commoncrawl.org")).toBe(false);
    expect(isCdxIndexRequest("not a url")).toBe(false);
  });
});

describe("prefetchScanInBackground", () => {
  it("returns false when service workers are unsupported", () => {
    vi.stubGlobal("navigator", {});
    expect(backgroundScanSupported()).toBe(false);
    expect(prefetchScanInBackground(["https://index.commoncrawl.org/x"])).toBe(false);
  });

  it("returns false when there is no controlling worker", () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    expect(prefetchScanInBackground(["https://index.commoncrawl.org/x"])).toBe(false);
  });

  it("posts a prefetch message to the controlling worker", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage } } });

    expect(prefetchScanInBackground(["https://index.commoncrawl.org/x"], 500)).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: SCAN_PREFETCH,
      urls: ["https://index.commoncrawl.org/x"],
      spacingMs: 500
    });
  });

  it("does not post when there are no URLs", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage } } });
    expect(prefetchScanInBackground([])).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not prefetch after consent is revoked", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage } } });
    revokeStorageConsent();
    expect(prefetchScanInBackground(["https://index.commoncrawl.org/x"])).toBe(false);
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: SCAN_PREFETCH }));
  });

  it("cancelBackgroundScan posts a cancel message", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage } } });
    cancelBackgroundScan();
    expect(postMessage).toHaveBeenCalledWith({ type: SCAN_CANCEL });
  });
});
