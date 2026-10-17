import { afterEach, describe, expect, it, vi } from "vitest";
import { LARGE_CAPTURE_LIMIT_BYTES } from "@/lib/common-crawl";
import { decodeWarcRecordBytes, fetchAndParseWarcRecord, fetchRawWarcRecordBytes, parseHeaderBlock, parseWarcRecord, sanitizeHtmlForPreview } from "@/lib/warc";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Builds an uncompressed WARC response record whose HTTP body is raw bytes.
function warcRecordBytes(contentType: string, body: Uint8Array | string): Uint8Array {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `WARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: https://example.com/\r\n\r\nHTTP/1.1 200 OK\r\n${contentType}\r\n\r\n`
  );
  const bodyBytes = typeof body === "string" ? encoder.encode(body) : body;
  const record = new Uint8Array(head.length + bodyBytes.length);
  record.set(head, 0);
  record.set(bodyBytes, head.length);
  return record;
}

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

  it("decodes a latin-1 body using the HTTP Content-Type charset", () => {
    const record = parseWarcRecord(decodeWarcRecordBytes(
      warcRecordBytes("Content-Type: text/html; charset=iso-8859-1", new Uint8Array([0x3c, 0x70, 0x3e, 0xe4, 0xf6, 0xfc, 0x3c, 0x2f, 0x70, 0x3e]))
    ));

    expect(record.html).toBe("<p>äöü</p>");
    expect(record.httpHeaders["Content-Type"]).toBe("text/html; charset=iso-8859-1");
  });

  it("decodes a body using a <meta charset> declaration when the header has none", () => {
    const head = new TextEncoder().encode('<html><head><meta charset="windows-1252"></head><body>caf');
    const bytes = new Uint8Array([...head, 0xe9, ...new TextEncoder().encode("</body></html>")]);

    const record = parseWarcRecord(decodeWarcRecordBytes(warcRecordBytes("Content-Type: text/html", bytes)));

    expect(record.html).toContain("café");
  });

  it("keeps UTF-8 as the default when no charset is declared", () => {
    const record = parseWarcRecord(decodeWarcRecordBytes(
      warcRecordBytes("Content-Type: text/html", "<p>Grüße ✓</p>")
    ));

    expect(record.html).toBe("<p>Grüße ✓</p>");
  });

  it("falls back to UTF-8 for an unknown charset label", () => {
    const record = parseWarcRecord(decodeWarcRecordBytes(
      warcRecordBytes("Content-Type: text/html; charset=not-a-real-charset", "<p>✓</p>")
    ));

    expect(record.html).toBe("<p>✓</p>");
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

  it("removes archived meta refresh and link elements", () => {
    const html = sanitizeHtmlForPreview(
      '<meta http-equiv="refresh" content="0;url=https://evil.test"><meta http-equiv=refresh content=0><link rel="stylesheet" href="https://evil.test/a.css"><p>kept</p>'
    );
    expect(html.toLowerCase()).not.toContain("<meta");
    expect(html.toLowerCase()).not.toContain("<link");
    expect(html).toContain("kept");
  });

  it("removes forms, applets, frames and legacy embeds while keeping form content", () => {
    const html = sanitizeHtmlForPreview(
      '<form action="https://evil.test" method="post"><input name="q"><p>kept form text</p></form>' +
      '<applet code="A.class"><param name="x" value="1"></applet>' +
      '<frameset><frame src="https://evil.test/f.html"></frameset>' +
      '<frame src="https://evil.test/g.html"><p>after</p>'
    );
    expect(html.toLowerCase()).not.toMatch(/<\/?form/);
    expect(html.toLowerCase()).not.toContain("<applet");
    expect(html.toLowerCase()).not.toContain("<frame");
    expect(html).toContain("kept form text");
    expect(html).toContain("after");
  });

  it("strips @import rules from embedded stylesheets but keeps other CSS", () => {
    const html = sanitizeHtmlForPreview(
      "<style>@import url('https://evil.test/a.css'); p { color: red; }</style><p>x</p>"
    );
    expect(html.toLowerCase()).not.toContain("@import");
    expect(html).toContain("p { color: red; }");
  });

  it.each([
    ['<div style="background:url(https://evil.test/x.png)">a</div>'],
    ["<div style='background: URL(https://evil.test/x.png)'>a</div>"],
    ["<div style=background:url(https://evil.test/x.png)>a</div>"],
    ['<div style="width:expression(alert(1))">a</div>']
  ])("strips dangerous style attributes regardless of quoting: %s", (markup) => {
    const html = sanitizeHtmlForPreview(markup);
    expect(html.toLowerCase()).not.toMatch(/url\(|expression\(/);
    expect(html).toContain(">a</div>");
  });

  it("keeps harmless style attributes", () => {
    const html = sanitizeHtmlForPreview('<p style="color: red">x</p>');
    expect(html).toContain('style="color: red"');
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
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Response(rawBytes, { status: 206, headers: { "Content-Range": `bytes 10-${9 + rawBytes.length}/*`, "Content-Length": String(rawBytes.length) } }));
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

  it("rejects servers that ignore Range or return a mismatched Content-Range", async () => {
    for (const response of [
      new Response("whole object", { status: 200 }),
      new Response("partial", { status: 206, headers: { "Content-Range": "bytes 1-3/10" } })
    ]) {
      const fetchMock = vi.fn<typeof globalThis.fetch>(async () => response);
      vi.stubGlobal("fetch", fetchMock);
      await expect(fetchRawWarcRecordBytes({ filename: "crawl-data/example.warc.gz", offset: "10", length: "3" }))
        .rejects.toThrow(/HTTP 200|invalid byte range/);
      vi.unstubAllGlobals();
    }
  });

  it("rejects a truncated response even when Content-Length is absent", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array([1, 2]), {
      status: 206,
      headers: { "Content-Range": "bytes 0-2/10" }
    })));
    await expect(fetchRawWarcRecordBytes({ filename: "crawl-data/example.warc.gz", offset: "0", length: "3" }))
      .rejects.toThrow("shorter than the requested range");
  });

  it("rejects a missing response body", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async () => new Response(null, {
      status: 206,
      headers: { "Content-Range": "bytes 0-0/10", "Content-Length": "1" }
    })));
    await expect(fetchRawWarcRecordBytes({ filename: "crawl-data/example.warc.gz", offset: "0", length: "1" }))
      .rejects.toThrow("body was missing");
  });

  it("cancels an oversized streamed compressed response", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); },
      cancel() { cancelled = true; }
    });
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async () => new Response(body, {
      status: 206,
      headers: { "Content-Range": "bytes 0-4/5", "Content-Length": "5" }
    })));
    await expect(fetchRawWarcRecordBytes({ filename: "crawl-data/example.warc.gz", offset: "0", length: "5" }))
      .rejects.toThrow("exceeded the safety limit");
    expect(cancelled).toBe(true);
  });

  it("caps gzip expansion even when the compressed range is small", async () => {
    const source = new Response(new Uint8Array(65 * 1024 * 1024)).body!.pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(source).arrayBuffer());
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async () => new Response(compressed, {
      status: 206,
      headers: { "Content-Range": `bytes 0-${compressed.length - 1}/${compressed.length}`, "Content-Length": String(compressed.length) }
    })));
    await expect(fetchAndParseWarcRecord({ filename: "crawl-data/example.warc.gz", offset: "0", length: String(compressed.length) }))
      .rejects.toThrow("exceeded the safety limit");
  });

  it("propagates caller abort while response headers are stalled", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof globalThis.fetch>((_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new DOMException("aborted", "AbortError"));
      else signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchRawWarcRecordBytes({ filename: "crawl-data/example.warc.gz", offset: "0", length: "1", retryCount: 0, signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("times out a request that stalls before response headers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof globalThis.fetch>((_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new DOMException("aborted", "AbortError"));
      else signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchRawWarcRecordBytes({ filename: "crawl-data/example.warc.gz", offset: "0", length: "1", retryCount: 0 });
    const rejection = expect(request).rejects.toThrow("headers timed out");
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it("times out a WARC body that stalls mid-stream and cancels the stream", async () => {
    // Only timers are faked: the stream machinery needs real microtask/nextTick
    // scheduling. The shared host pacer also waits on setTimeout, so the clock is
    // advanced in steps until the stalled read's own timeout has fired.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async () => new Response(body, {
      status: 206,
      headers: { "Content-Range": "bytes 0-4/5", "Content-Length": "5" }
    })));
    const request = fetchRawWarcRecordBytes({ filename: "crawl-data/example.warc.gz", offset: "0", length: "5", retryCount: 0 });
    const outcome = request.then(() => "resolved", (error: Error) => error.message);
    let result: string | undefined;
    void outcome.then((value) => { result = value; });
    for (let step = 0; step < 200 && result === undefined; step += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(result).toContain("read timed out");
    expect(cancelled).toBe(true);
  });

  it("aborts a WARC body that stalls mid-stream when the caller aborts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let cancelled = false;
    const controller = new AbortController();
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    // highWaterMark 0 means pull() only runs once a reader is actually waiting,
    // so the abort lands inside the stalled read rather than before it.
    const body = new ReadableStream<Uint8Array>({ pull() { readStarted(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async () => new Response(body, {
      status: 206,
      headers: { "Content-Range": "bytes 0-4/5", "Content-Length": "5" }
    })));
    const request = fetchRawWarcRecordBytes({ filename: "crawl-data/example.warc.gz", offset: "0", length: "5", retryCount: 0, signal: controller.signal });
    const outcome = request.then(() => "resolved", (error: Error) => error);
    let isStarted = false;
    void started.then(() => { isStarted = true; });
    for (let step = 0; step < 2000 && !isStarted; step += 1) {
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(isStarted).toBe(true);
    controller.abort();
    const error = await outcome;
    expect(error).toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
  });
});
