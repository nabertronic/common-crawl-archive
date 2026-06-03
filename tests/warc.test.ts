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
});
