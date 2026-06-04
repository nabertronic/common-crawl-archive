import { describe, expect, it } from "vitest";
import { parseHeaderBlock, parseWarcRecord, sanitizeHtmlForPreview } from "@/lib/warc";

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
});
