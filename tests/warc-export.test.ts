import { describe, expect, it } from "vitest";
import {
  buildWarcResponseRecord,
  concatByteChunks,
  warcDateFromTimestamp,
  warcExportFilename
} from "@/lib/warc-export";
import type { CommonCrawlCapture } from "@/lib/common-crawl";
import type { ParsedWarcRecord } from "@/lib/warc";

function capture(overrides: Partial<CommonCrawlCapture> = {}): CommonCrawlCapture {
  return {
    collectionId: "CC-MAIN-2026-26",
    collectionName: "June 2026",
    collectionFrom: "2026-06-01",
    collectionTo: "2026-06-30",
    timestamp: "20260615120000",
    url: "https://example.com/page",
    status: "200",
    mime: "text/html",
    filename: "file.warc.gz",
    offset: "0",
    length: "10",
    ...overrides
  };
}

const record: ParsedWarcRecord = {
  warcHeaders: {},
  httpHeaders: { "Content-Type": "text/html", Server: "nginx" },
  statusLine: "HTTP/1.1 200 OK",
  html: "<html><body>hi</body></html>"
};

describe("concatByteChunks", () => {
  it("concatenates chunks in order", () => {
    const out = concatByteChunks([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns an empty buffer for no chunks", () => {
    expect(concatByteChunks([]).length).toBe(0);
  });
});

describe("warcDateFromTimestamp", () => {
  it("converts a 14-digit CDX timestamp to ISO", () => {
    expect(warcDateFromTimestamp("20260615120000")).toBe("2026-06-15T12:00:00.000Z");
  });

  it("falls back to a valid ISO date for malformed input", () => {
    expect(() => new Date(warcDateFromTimestamp("nope")).toISOString()).not.toThrow();
  });
});

describe("buildWarcResponseRecord", () => {
  it("emits a WARC/1.0 response record with a byte-accurate Content-Length", () => {
    const text = buildWarcResponseRecord(capture(), record);
    expect(text.startsWith("WARC/1.0\r\n")).toBe(true);
    expect(text).toContain("WARC-Type: response");
    expect(text).toContain("WARC-Target-URI: https://example.com/page");
    expect(text).toContain("WARC-Date: 2026-06-15T12:00:00.000Z");
    expect(text).toContain("Content-Type: application/http; msgtype=response");

    const httpBlock = `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nServer: nginx\r\n\r\n${record.html}`;
    expect(text).toContain(`Content-Length: ${new TextEncoder().encode(httpBlock).length}`);
    expect(text).toContain(httpBlock);
    expect(text.endsWith("\r\n\r\n")).toBe(true);
  });
});

describe("warcExportFilename", () => {
  it("uses an un-suffixed name for a single part", () => {
    expect(warcExportFilename(1, 1, new Date("2026-07-08T00:00:00Z"))).toBe("common-crawl-2026-07-08.warc.gz");
  });

  it("suffixes multi-part exports with a zero-padded index", () => {
    expect(warcExportFilename(2, 2, new Date("2026-07-08T00:00:00Z"))).toBe("common-crawl-2026-07-08-part-02.warc.gz");
  });
});
