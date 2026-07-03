import { describe, expect, it } from "vitest";
import { createViewerHref, parseSearchRoute, viewerBackHref } from "@/lib/navigation-state";
import type { CommonCrawlCapture } from "@/lib/common-crawl";

const capture: CommonCrawlCapture = {
  collectionId: "CC-MAIN-2016-36",
  collectionName: "Aug 2016",
  collectionFrom: "2016-08-01",
  collectionTo: "2016-08-31",
  timestamp: "20160824102212",
  url: "https://hutt.io/",
  status: "200",
  mime: "text/html",
  filename: "crawl-data/example.warc.gz",
  offset: "854275963",
  length: "5187"
};

describe("navigation state", () => {
  it("uses scan ids for new viewer and close URLs", () => {
    expect(createViewerHref(capture, { scanId: "scan_hutt" })).toContain("&scan=scan_hutt");
    expect(viewerBackHref({ scanId: "scan_hutt" })).toBe("/search?scan=scan_hutt");
  });

  it("parses scan search routes before legacy URL state", () => {
    expect(parseSearchRoute(new URLSearchParams("scan=scan_hutt&url=hutt.io"))).toEqual({
      kind: "scan",
      scanId: "scan_hutt",
      action: undefined
    });
  });

  it("parses custom legacy date ranges", () => {
    expect(parseSearchRoute(new URLSearchParams("url=hutt.io&match=domain&scope=custom&from=2020-01-01&to=2020-12-31"))).toEqual({
      kind: "legacy",
      url: "hutt.io",
      matchType: "domain",
      mock: false,
      scope: "custom",
      dateFrom: "2020-01-01",
      dateTo: "2020-12-31",
      history: false,
      action: undefined,
      year: undefined,
      collection: undefined,
      mime: undefined,
      status: undefined,
      filter: undefined,
      sort: undefined,
      view: undefined,
      page: undefined
    });
  });
});
