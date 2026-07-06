import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendResultsBackContext,
  buildResultsBackHref,
  buildCdxjUrl,
  buildRangeHeader,
  fetchCollections,
  filterCollectionsByRecentMonths,
  filterCollectionsByDateRange,
  isLikelyCommonCrawlAvailabilityIssue,
  isLikelyRateLimitError,
  LARGE_CAPTURE_LIMIT_BYTES,
  parseCdxjResponse,
  parseCollections,
  queryCollection,
  resultCoversWindow,
  searchCollections,
  searchUrlCoversTarget,
  type CommonCrawlCollection
} from "@/lib/common-crawl";

const collection: CommonCrawlCollection = {
  id: "CC-MAIN-2026-21",
  name: "May 2026 Index",
  cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
  from: "2026-05-08T07:40:46",
  to: "2026-05-21T22:06:58"
};

describe("Common Crawl client", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      clear: vi.fn(() => {
        storage.clear();
      })
    });
  });

  it("parses and sorts collections newest first", () => {
    const collections = parseCollections([
      {
        id: "CC-MAIN-2008-2009",
        name: "2008 - 2009 ARC Files Index",
        "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2008-2009-index",
        from: "2008-05-09T05:37:12",
        to: "2009-01-09T20:58:29"
      },
      {
        id: "CC-MAIN-2026-21",
        name: "May 2026 Index",
        "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
        from: "2026-05-08T07:40:46",
        to: "2026-05-21T22:06:58"
      }
    ]);

    expect(collections.map((item) => item.id)).toEqual(["CC-MAIN-2026-21", "CC-MAIN-2008-2009"]);
  });

  it("builds CDXJ URLs with the exact target URL and requests unfiltered captures including redirect fields", () => {
    const url = buildCdxjUrl("https://example.com/a?b=1", collection);
    expect(url).toContain("https://index.commoncrawl.org/CC-MAIN-2026-21-index?");
    expect(url).toContain("url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1");
    expect(url).toContain("output=json");
    expect(url).toContain("redirect");
    // No fixed `limit`: it would truncate each page and defeat pagination.
    expect(url).not.toContain("limit=");
    expect(url).not.toContain("filter=");
    expect(url).not.toContain("matchType");
    expect(url).not.toContain("page=");
  });

  it("adds the page parameter when paginating", () => {
    expect(buildCdxjUrl("https://example.com/", collection, "exact", 0)).toContain("page=0");
    expect(buildCdxjUrl("https://example.com/", collection, "host", 2)).toContain("page=2");
  });

  it("constrains the query server-side with padded from/to bounds for a date window", () => {
    const url = buildCdxjUrl("https://example.com/", collection, "exact", 0, {
      from: "2024-03-10",
      to: "2024-03-20"
    });
    expect(url).toContain("from=20240310000000");
    expect(url).toContain("to=20240320235959");
  });

  it("preserves full-scan scope in capture viewer back context", () => {
    const params = appendResultsBackContext(new URLSearchParams({ url: "https://blog.example.com/post" }), {
      url: "https://example.com/",
      match: "domain",
      scope: "all",
      history: "1",
      year: "2024",
      status: "200",
      filter: "blog",
      sort: "url-asc",
      view: "calendar",
      page: 3
    });

    expect(params.get("back_url")).toBe("https://example.com/");
    expect(params.get("back_match")).toBe("domain");
    expect(params.get("back_scope")).toBe("all");
    expect(params.get("back_history")).toBe("1");
    expect(params.get("back_year")).toBe("2024");
    expect(params.get("back_status")).toBe("200");
    expect(params.get("back_filter")).toBe("blog");
    expect(params.get("back_sort")).toBe("url-asc");
    expect(params.get("back_view")).toBe("calendar");
    expect(params.get("back_page")).toBe("3");
  });

  it("restores full-scan scope and result view state in the search back href", () => {
    expect(
      buildResultsBackHref({
        url: "https://example.com/",
        match: "domain",
        scope: "all",
        history: "1",
        year: "2024",
        status: "200",
        filter: "blog",
        sort: "url-asc",
        view: "calendar",
        page: 3
      })
    ).toBe(
      "/search?match=domain&scope=all&history=1&year=2024&status=200&filter=blog&sort=url-asc&view=calendar&page=3&url=https%3A%2F%2Fexample.com%2F"
    );
  });

  it("restores the original full-scan search for capture viewer close links", () => {
    const viewParams = new URLSearchParams(
      "url=https%3A%2F%2Fhutt.io%2F&timestamp=20160824102212&collection=CC-MAIN-2016-36&filename=crawl-data%2FCC-MAIN-2016-36%2Fsegments%2F1471982292151.8%2Fwarc%2FCC-MAIN-20160823195812-00086-ip-10-153-172-175.ec2.internal.warc.gz&offset=854275963&length=5187&back_url=hutt.io&back_match=exact&back_scope=all&back_history=1&back_sort=timestamp-desc&back_view=calendar"
    );

    expect(
      buildResultsBackHref({
        url: viewParams.get("back_url"),
        match: viewParams.get("back_match"),
        scope: viewParams.get("back_scope"),
        history: viewParams.get("back_history"),
        sort: viewParams.get("back_sort"),
        view: viewParams.get("back_view")
      })
    ).toBe(
      "/search?match=exact&scope=all&history=1&sort=timestamp-desc&view=calendar&url=hutt.io"
    );
  });

  it("omits default scan scope from capture viewer back context and href", () => {
    const params = appendResultsBackContext(new URLSearchParams(), {
      url: "https://example.com/",
      match: "domain",
      scope: "recent"
    });

    expect(params.has("back_scope")).toBe(false);
    expect(buildResultsBackHref({ url: "https://example.com/", match: "domain", scope: "recent" })).toBe(
      "/search?match=domain&url=https%3A%2F%2Fexample.com%2F"
    );
  });

  it("preserves custom date ranges in capture viewer back links", () => {
    expect(
      buildResultsBackHref({
        url: "https://example.com/",
        match: "domain",
        scope: "custom",
        dateFrom: "2020-01-01",
        dateTo: "2020-12-31",
        history: "1"
      })
    ).toBe(
      "/search?match=domain&scope=custom&from=2020-01-01&to=2020-12-31&history=1&url=https%3A%2F%2Fexample.com%2F"
    );
  });

  it("recognizes URL compatibility for reusing broader stored scans", () => {
    expect(searchUrlCoversTarget("https://example.com/", "domain", "https://blog.example.com/post", "host")).toBe(true);
    expect(searchUrlCoversTarget("https://www.example.com/", "domain", "https://blog.example.com/post", "exact")).toBe(true);
    expect(searchUrlCoversTarget("https://example.com/", "domain", "https://badexample.com/post", "host")).toBe(false);
    expect(searchUrlCoversTarget("https://blog.example.com/", "host", "https://www.example.com/post", "host")).toBe(false);
  });

  it("adds matchType when set to host or domain", () => {
    expect(buildCdxjUrl("https://example.com/", collection, "host")).toContain("matchType=host");
    expect(buildCdxjUrl("https://example.com/", collection, "domain")).toContain("matchType=domain");
  });

  it("filters collections that overlap a custom date range", () => {
    const collections = filterCollectionsByDateRange(
      [
        {
          id: "CC-MAIN-2019-10",
          name: "Mar 2019 Index",
          cdxApi: "https://index.commoncrawl.org/CC-MAIN-2019-10-index",
          from: "2019-03-01T00:00:00",
          to: "2019-03-31T23:59:59"
        },
        {
          id: "CC-MAIN-2020-16",
          name: "Apr 2020 Index",
          cdxApi: "https://index.commoncrawl.org/CC-MAIN-2020-16-index",
          from: "2020-04-10T00:00:00",
          to: "2020-04-25T23:59:59"
        },
        {
          id: "CC-MAIN-2021-04",
          name: "Jan 2021 Index",
          cdxApi: "https://index.commoncrawl.org/CC-MAIN-2021-04-index",
          from: "2021-01-01T00:00:00",
          to: "2021-01-15T23:59:59"
        }
      ],
      "2020-04-01",
      "2020-12-31"
    );

    expect(collections.map((entry) => entry.id)).toEqual(["CC-MAIN-2020-16"]);
  });

  it("parses HTML 200 and 3xx redirect captures from NDJSON", () => {
    const captures = parseCdxjResponse(
      [
        JSON.stringify({
          timestamp: "20260508112233",
          url: "https://example.com/",
          status: "200",
          mime: "text/html",
          digest: "abc",
          filename: "crawl-data/test.warc.gz",
          offset: "10",
          length: "90"
        }),
        JSON.stringify({
          timestamp: "20260508112234",
          url: "https://example.com/image.png",
          status: "200",
          mime: "image/png",
          filename: "crawl-data/test.warc.gz",
          offset: "100",
          length: "20"
        }),
        JSON.stringify({
          timestamp: "20260508112235",
          url: "https://example.com/old",
          status: "301",
          mime: "text/html",
          filename: "crawl-data/test.warc.gz",
          offset: "200",
          length: "50",
          redirect: "https://example.com/new"
        }),
        JSON.stringify({
          timestamp: "20260508112236",
          url: "https://example.com/gone",
          status: "404",
          mime: "text/html",
          filename: "crawl-data/test.warc.gz",
          offset: "300",
          length: "30"
        }),
        "{not-json"
      ].join("\n"),
      collection
    );

    expect(captures).toHaveLength(2);
    expect(captures.map((c) => c.status)).toEqual(["301", "200"]);
    const redirectCapture = captures.find((c) => c.status === "301");
    expect(redirectCapture?.redirect).toBe("https://example.com/new");
  });

  it("calculates inclusive range headers", () => {
    expect(buildRangeHeader("100", "50")).toBe("bytes=100-149");
  });

  it("marks server errors as not checked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 }))
    );

    const result = await queryCollection("https://example.com/", collection, undefined, 1000, 0);
    expect(result.status).toBe("not-checked");
    expect(result.httpStatus).toBe(503);
    expect(result.error).toBe("Service unavailable response from Common Crawl");
    expect(result.errorKind).toBe("http_503_unavailable");
    expect(result.attempts).toBe(1);
    expect(result.runs).toBe(1);
  });

  it("keeps status codes and recognizes Common Crawl SlowDown bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"Internal Error: SlowDown: Please reduce your request rate."}', { status: 500 }))
    );

    const result = await queryCollection("https://example.com/", collection, undefined, 1000, 0);
    expect(result.status).toBe("not-checked");
    expect(result.httpStatus).toBe(500);
    expect(result.error).toBe("SlowDown response from Common Crawl");
    expect(result.errorKind).toBe("http_500_slowdown");
  });

  it("retries when Common Crawl asks us to slow down", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"message":"Internal Error: SlowDown: Please reduce your request rate."}', {
          status: 500
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryCollection(
      "https://example.com/",
      collection,
      undefined,
      1000,
      2,
      0
    );

    expect(result.status).toBe("not-checked");
    expect(result.httpStatus).toBe(500);
    expect(result.errorKind).toBe("http_500_slowdown");
    expect(result.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries explicit Common Crawl rate limits", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryCollection(
      "https://example.com/",
      collection,
      undefined,
      1000,
      2,
      0
    );

    expect(result.status).toBe("not-checked");
    expect(result.httpStatus).toBe(429);
    expect(result.errorKind).toBe("http_429_rate_limit");
    expect(result.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses exponential retry delays and Retry-After hints for transient failures", async () => {
    const delays: number[] = [];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response("rate limited", { status: 429 });
        if (call === 2) return new Response("still busy", { status: 503, headers: { "Retry-After": "0.003" } });
        return new Response("", { status: 200 });
      })
    );

    const result = await queryCollection(
      "https://example.com/retry-after",
      collection,
      undefined,
      1000,
      2,
      1,
      100,
      "exact",
      undefined,
      (delayMs) => delays.push(delayMs)
    );

    expect(result.status).toBe("checked");
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([1, 3]);
  });

  it("uses cached CDX results for repeated checked collection queries", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requested = typeof input === "string" ? input : input.toString();
      // First page carries the capture; the next page is empty, ending pagination.
      if (requested.includes("page=0")) {
        return new Response(
          JSON.stringify({
            timestamp: "20260508112233",
            url: "https://example.com/",
            status: "200",
            mime: "text/html",
            filename: "crawl-data/test.warc.gz",
            offset: "10",
            length: "90"
          }),
          { status: 200 }
        );
      }
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await queryCollection("https://example.com/cache", collection, undefined, 1000, 0);
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await queryCollection("https://example.com/cache", collection, undefined, 1000, 0);

    expect(first.fromCache).toBeUndefined();
    expect(first.captures).toHaveLength(1);
    expect(second.fromCache).toBe(true);
    expect(second.attempts).toBe(0);
    // The cached result is reused without any additional network requests.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("records captures that exceed the local viewer size limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const requested = typeof input === "string" ? input : input.toString();
        if (requested.includes("page=0")) {
          return new Response(
            JSON.stringify({
              timestamp: "20260508112233",
              url: "https://example.com/large",
              status: "200",
              mime: "text/html",
              filename: "crawl-data/test.warc.gz",
              offset: "10",
              length: String(LARGE_CAPTURE_LIMIT_BYTES + 1)
            }),
            { status: 200 }
          );
        }
        return new Response("", { status: 200 });
      })
    );

    const result = await queryCollection("https://example.com/large", collection, undefined, 1000, 0);
    expect(result.blockedCaptures).toHaveLength(1);
    expect(result.blockedCaptures?.[0].sizeBytes).toBe(LARGE_CAPTURE_LIMIT_BYTES + 1);
  });

  const cdxLine = (timestamp: string, offset: string) =>
    JSON.stringify({
      timestamp,
      url: "https://example.com/",
      status: "200",
      mime: "text/html",
      filename: "crawl-data/test.warc.gz",
      offset,
      length: "100"
    });

  it("walks multiple CDX pages and merges captures until the index is exhausted", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requested = typeof input === "string" ? input : input.toString();
      if (requested.includes("page=0")) {
        return new Response([cdxLine("20260101000000", "10"), cdxLine("20260102000000", "20")].join("\n"), { status: 200 });
      }
      if (requested.includes("page=1")) {
        return new Response(cdxLine("20260103000000", "30"), { status: 200 });
      }
      // page 2 is past the last page: pywb answers HTTP 400, ending pagination.
      return new Response("blocked out of bounds", { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryCollection("https://example.com/", collection, undefined, 1000, 0);

    expect(result.status).toBe("checked");
    expect(result.captures).toHaveLength(3);
    expect(result.captures.map((capture) => capture.timestamp)).toEqual([
      "20260103000000",
      "20260102000000",
      "20260101000000"
    ]);
    expect(result.truncated).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps walking pages when a page has captures the retain filter drops", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requested = typeof input === "string" ? input : input.toString();
      if (requested.includes("page=0")) {
        // Non-HTML capture: filtered out, but the page is not empty, so we must
        // not treat it as the end of results.
        return new Response(
          JSON.stringify({
            timestamp: "20260101000000",
            url: "https://example.com/image.png",
            status: "200",
            mime: "image/png",
            filename: "crawl-data/test.warc.gz",
            offset: "10",
            length: "100"
          }),
          { status: 200 }
        );
      }
      if (requested.includes("page=1")) {
        return new Response(cdxLine("20260102000000", "20"), { status: 200 });
      }
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryCollection("https://example.com/", collection, undefined, 1000, 0);

    expect(result.status).toBe("checked");
    expect(result.captures).toHaveLength(1);
    expect(result.captures[0].timestamp).toBe("20260102000000");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops paginating at the per-collection capture cap and flags truncation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response([cdxLine("20260101000000", "10"), cdxLine("20260102000000", "20")].join("\n"), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryCollection(
      "https://example.com/",
      collection,
      undefined,
      1000,
      0,
      undefined,
      undefined,
      "exact",
      undefined,
      undefined,
      3
    );

    expect(result.status).toBe("checked");
    expect(result.truncated).toBe(true);
    expect(result.captures).toHaveLength(3);
    // Two pages of two captures reach the cap of three; no third page is fetched.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends the date window to the API, records it on the result, and caches per-window", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requested = typeof input === "string" ? input : input.toString();
      requestedUrls.push(requested);
      if (requested.includes("page=0")) return new Response(cdxLine("20240315000000", "10"), { status: 200 });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const window = { from: "2024-03-10", to: "2024-03-20" };
    const windowed = await queryCollection(
      "https://example.com/win",
      collection,
      undefined,
      1000,
      0,
      undefined,
      undefined,
      "exact",
      undefined,
      undefined,
      undefined,
      undefined,
      window
    );

    expect(windowed.status).toBe("checked");
    expect(windowed.window).toEqual(window);
    expect(
      requestedUrls.some((url) => url.includes("from=20240310000000") && url.includes("to=20240320235959"))
    ).toBe(true);

    // The same window is served from cache without new network requests.
    const callsBeforeRepeat = fetchMock.mock.calls.length;
    const repeat = await queryCollection(
      "https://example.com/win",
      collection,
      undefined,
      1000,
      0,
      undefined,
      undefined,
      "exact",
      undefined,
      undefined,
      undefined,
      undefined,
      window
    );
    expect(repeat.fromCache).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeRepeat);

    // A full (unwindowed) query must not reuse the windowed cache entry.
    const full = await queryCollection("https://example.com/win", collection, undefined, 1000, 0);
    expect(full.fromCache).toBeUndefined();
    expect(full.window).toBeUndefined();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRepeat);
  });

  it("decides result reuse from coverage windows", () => {
    const window = { from: "2024-03-10", to: "2024-03-20" };
    expect(resultCoversWindow(undefined, window)).toBe(true);
    expect(resultCoversWindow(undefined, undefined)).toBe(true);
    expect(resultCoversWindow(window, undefined)).toBe(false);
    expect(resultCoversWindow({ from: "2024-03-01", to: "2024-03-31" }, window)).toBe(true);
    expect(resultCoversWindow({ from: "2024-03-12", to: "2024-03-18" }, window)).toBe(false);
    expect(resultCoversWindow(window, window)).toBe(true);
  });

  it("retries transient Common Crawl errors before marking a collection checked", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response("gateway timeout", { status: 504 });
        return new Response("", { status: 200 });
      })
    );

    const result = await queryCollection(
      "https://example.com/",
      collection,
      undefined,
      1000,
      1,
      0
    );

    expect(result.status).toBe("checked");
    expect(result.httpStatus).toBe(200);
    expect(result.attempts).toBe(2);
    expect(call).toBe(2);
  });

  it("marks browser network failures without inventing an HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const result = await queryCollection("https://example.com/", collection, undefined, 1000, 0);
    expect(result.status).toBe("not-checked");
    expect(result.httpStatus).toBeUndefined();
    expect(result.error).toBe("browser/network request failed before an HTTP response");
    expect(result.errorKind).toBe("network_no_response");
  });

  it("classifies rate-limit style errors", () => {
    expect(isLikelyRateLimitError("Service unavailable response from Common Crawl", 503, "http_503_unavailable")).toBe(true);
    expect(isLikelyRateLimitError("Rate limit response from Common Crawl", 429, "http_429_rate_limit")).toBe(true);
    expect(isLikelyRateLimitError("browser/network request failed before an HTTP response", undefined, "network_no_response")).toBe(false);
    expect(isLikelyCommonCrawlAvailabilityIssue("browser/network request failed before an HTTP response", undefined, "network_no_response")).toBe(true);
    expect(isLikelyRateLimitError("HTTP 400")).toBe(false);
  });

  it("propagates matchType into the CDX request URL", async () => {
    let requested = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requested = typeof input === "string" ? input : input.toString();
        return new Response("", { status: 200 });
      })
    );

    await searchCollections({
      targetUrl: "zeit.de",
      collections: [collection],
      timeoutMs: 1000,
      retryDelayMs: 0,
      requestSpacingMs: 0,
      matchType: "host"
    });

    expect(requested).toContain("matchType=host");
  });

  it("starts multiple collection workers when higher concurrency is requested", async () => {
    const collections = ["a", "b", "c"].map((id) => ({
      ...collection,
      id,
      cdxApi: `https://index.commoncrawl.org/${id}-index`
    }));
    let activeNetworkRequests = 0;
    let maxNetworkRequests = 0;
    let maxActiveCollections = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        activeNetworkRequests += 1;
        maxNetworkRequests = Math.max(maxNetworkRequests, activeNetworkRequests);
        await Promise.resolve();
        activeNetworkRequests -= 1;
        return new Response("", { status: 404 });
      })
    );

    await searchCollections({
      targetUrl: "https://example.com/",
      collections,
      concurrency: 3,
      timeoutMs: 1000,
      requestSpacingMs: 0,
      onProgress: (progress) => {
        maxActiveCollections = Math.max(maxActiveCollections, progress.activeCollections.length);
      }
    });

    expect(maxActiveCollections).toBe(3);
    expect(maxNetworkRequests).toBe(1);
  });

  it("uses fresh cached collinfo without a network request", async () => {
    localStorage.setItem(
      "snapshot-search:common-crawl-collections:v2",
      JSON.stringify({
        version: 1,
        fetchedAt: Date.now(),
        collections: [collection]
      })
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCollections()).resolves.toEqual([collection]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can force-refresh collinfo even when a fresh cache exists", async () => {
    const newerCollection = { ...collection, id: "CC-MAIN-2026-26" };
    localStorage.setItem(
      "snapshot-search:common-crawl-collections:v2",
      JSON.stringify({
        version: 1,
        fetchedAt: Date.now(),
        collections: [collection]
      })
    );
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{
      id: newerCollection.id,
      name: newerCollection.name,
      "cdx-api": newerCollection.cdxApi,
      from: newerCollection.from,
      to: newerCollection.to
    }])));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCollections({ forceRefresh: true })).resolves.toEqual([newerCollection]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses stale cached collinfo when the network fails", async () => {
    localStorage.setItem(
      "snapshot-search:common-crawl-collections:v2",
      JSON.stringify({
        version: 1,
        fetchedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        collections: [collection]
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    await expect(fetchCollections()).resolves.toEqual([collection]);
  });

  it("filters the default scan set to collections from the last 12 months", () => {
    const collections = [
      collection,
      {
        ...collection,
        id: "CC-MAIN-2024-10",
        from: "2024-03-01T00:00:00",
        to: "2024-03-15T00:00:00"
      }
    ];

    expect(filterCollectionsByRecentMonths(collections, 12, new Date("2026-06-01T00:00:00Z")).map((item) => item.id)).toEqual([
      "CC-MAIN-2026-21"
    ]);
  });

  it("stops after consecutive rate-limit signals", async () => {
    const collections = ["a", "b", "c"].map((id) => ({
      ...collection,
      id,
      cdxApi: `https://index.commoncrawl.org/${id}-index`
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("busy", { status: 503 }))
    );
    let stopReason = "";

    const results = await searchCollections({
      targetUrl: "https://example.com/",
      collections,
      timeoutMs: 1000,
      retryCount: 0,
      retryDelayMs: 0,
      requestSpacingMs: 0,
      circuitBreakerThreshold: 2,
      onStop: (reason) => {
        stopReason = reason;
      }
    });

    expect(results).toHaveLength(2);
    expect(stopReason).toBe("circuit-breaker");
  });

  it("continues when successful checks interrupt availability failures", async () => {
    const collections = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({
      ...collection,
      id,
      cdxApi: `https://index.commoncrawl.org/${id}-index`
    }));
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 3 || call === 6) return new Response("", { status: 404 });
        return new Response("busy", { status: 503 });
      })
    );
    let stopReason = "";

    const results = await searchCollections({
      targetUrl: "https://example.com/",
      collections,
      timeoutMs: 1000,
      retryCount: 0,
      retryDelayMs: 0,
      requestSpacingMs: 0,
      circuitBreakerThreshold: 10,
      circuitBreakerWindowSize: 5,
      circuitBreakerWindowThreshold: 4,
      onStop: (reason) => {
        stopReason = reason;
      }
    });

    expect(results).toHaveLength(8);
    expect(stopReason).toBe("completed");
  });
});
