import { afterEach, describe, expect, it, vi } from "vitest";
import { LARGE_CAPTURE_LIMIT_BYTES } from "@/lib/common-crawl";
import { fetchAndParseWarcRecord, fetchRawWarcRecordBytes, parseHeaderBlock, parseWarcRecord, sanitizeHtmlForPreview } from "@/lib/warc";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WARC parser", () => {
  it("parses header blocks", () => {
    expect(parseHeaderBlock("A: one\nB: two: still two")).toEqual({
      A: "one",
      B: "two: still two"
    });
  });

  it("parses WARC, HTTP headers, and HTML body", () => {
    const record = parseWarcRecord(
      [
        "WARC/1.0",
        "WARC-Type: response",
        "WARC-Target-URI: https://example.com/",
        "",
        "HTTP/1.1 200 OK",
        "Content-Type: text/html",
        "",
        "<html><body>Saved</body></html>"
      ].join("\r\n")
    );

    expect(record.warcHeaders["WARC-Type"]).toBe("response");
    expect(record.statusLine).toBe("HTTP/1.1 200 OK");
    expect(record.httpHeaders["Content-Type"]).toBe("text/html");
    expect(record.html).toContain("Saved");
  });

  it("removes script and external load attributes for sandbox preview", () => {
    const html = sanitizeHtmlForPreview(
      '<html><head><base href="https://example.com/"><script>alert(1)</script></head><body><img src="https://example.com/a.png"><a href="/x">x</a></body></html>'
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<base");
    expect(html).not.toContain("src=");
    expect(html).not.toContain("href=");
  });

  it("strips event handlers and unquoted attributes regardless of separator", () => {
    const html = sanitizeHtmlForPreview(
      '<img/onerror=alert(1) src=x><svg onload=alert(2)></svg><div ONCLICK="steal()">hi</div>'
    );

    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("onload");
    expect(html.toLowerCase()).not.toContain("onclick");
    expect(html).not.toMatch(/\ssrc\s*=/i);
  });

  it("neutralises javascript: URIs while leaving prose intact", () => {
    const html = sanitizeHtmlForPreview(
      '<a href="javascript:alert(1)">x</a><p>The javascript: scheme is discussed here.</p>'
    );

    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("The javascript: scheme is discussed here.");
  });

  it("drops iframe, object and embed elements", () => {
    const html = sanitizeHtmlForPreview(
      '<iframe src="https://evil.test"></iframe><object data="x.swf"></object><embed src="x.swf">'
    );

    expect(html.toLowerCase()).not.toContain("<iframe");
    expect(html.toLowerCase()).not.toContain("<object");
    expect(html.toLowerCase()).not.toContain("<embed");
  });

  it("blocks oversized WARC records by default before making a network request", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAndParseWarcRecord({
        filename: "crawl-data/example.warc.gz",
        offset: "0",
        length: String(LARGE_CAPTURE_LIMIT_BYTES + 1)
      })
    ).rejects.toThrow("viewer safety limit");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a caller-provided WARC safety limit", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAndParseWarcRecord({
        filename: "crawl-data/example.warc.gz",
        offset: "0",
        length: "2048",
        largeCaptureLimitBytes: 1024
      })
    ).rejects.toThrow("viewer safety limit");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests records that fit a caller-provided WARC safety limit", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAndParseWarcRecord({
        filename: "crawl-data/example.warc.gz",
        offset: "10",
        length: "2048",
        largeCaptureLimitBytes: 4096
      })
    ).rejects.toThrow("WARC range request returned HTTP 404");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the raw (still-gzipped) WARC bytes without decompressing", async () => {
    const rawBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]);
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Response(rawBytes, { status: 206 }));
    vi.stubGlobal("fetch", fetchMock);

    const bytes = await fetchRawWarcRecordBytes({
      filename: "crawl-data/example.warc.gz",
      offset: "10",
      length: String(rawBytes.length)
    });

    expect(Array.from(bytes)).toEqual(Array.from(rawBytes));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks oversized raw WARC fetches unless allowLarge is set", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRawWarcRecordBytes({
        filename: "crawl-data/example.warc.gz",
        offset: "0",
        length: String(LARGE_CAPTURE_LIMIT_BYTES + 1)
      })
    ).rejects.toThrow("viewer safety limit");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests oversized WARC records when the caller explicitly allows them", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAndParseWarcRecord({
        filename: "crawl-data/example.warc.gz",
        offset: "10",
        length: String(LARGE_CAPTURE_LIMIT_BYTES + 1),
        allowLarge: true
      })
    ).rejects.toThrow("WARC range request returned HTTP 404");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(init).toBeDefined();
    if (!init) throw new Error("Expected WARC request init");
    expect(new Headers(init.headers).get("Range")).toBe(`bytes=10-${10 + LARGE_CAPTURE_LIMIT_BYTES}`);
  });
});
