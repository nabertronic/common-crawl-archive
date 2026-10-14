import { describe, expect, it } from "vitest";
import {
  buildDownloadedHtml,
  checkCaptureIntegrity,
  DOWNLOADED_HTML_CSP,
  formatCaptureTimestamp,
  warcDateToCaptureTimestamp
} from "@/lib/capture-integrity";

const headers = (target: string, date: string) => ({
  "WARC-Type": "response",
  "WARC-Target-URI": target,
  "WARC-Date": date
});

describe("checkCaptureIntegrity", () => {
  it("matches when the link URL and timestamp equal the record headers", () => {
    expect(
      checkCaptureIntegrity({
        linkUrl: "https://bank.example/",
        linkTimestamp: "20190305123456",
        warcHeaders: headers("https://bank.example/", "2019-03-05T12:34:56Z")
      })
    ).toEqual({ status: "match" });
  });

  it("tolerates trailing slash, default port, and fragment differences", () => {
    expect(
      checkCaptureIntegrity({
        linkUrl: "https://bank.example",
        linkTimestamp: "20190305123456",
        warcHeaders: headers("https://bank.example:443/#top", "2019-03-05T12:34:56Z")
      }).status
    ).toBe("match");
  });

  it("flags a different site even when the date matches", () => {
    const result = checkCaptureIntegrity({
      linkUrl: "https://bank.example/",
      linkTimestamp: "20190305123456",
      warcHeaders: headers("https://other.example/", "2019-03-05T12:34:56Z")
    });
    expect(result).toMatchObject({
      status: "mismatch",
      recordUrl: "https://other.example/",
      recordDate: "2019-03-05T12:34:56Z",
      urlMismatch: true,
      timestampMismatch: false,
      urlDiffersOnlyByVariant: false
    });
  });

  it("flags a different date even when the URL matches", () => {
    expect(
      checkCaptureIntegrity({
        linkUrl: "https://bank.example/",
        linkTimestamp: "20190305123456",
        warcHeaders: headers("https://bank.example/", "2024-01-01T00:00:00Z")
      })
    ).toMatchObject({ status: "mismatch", urlMismatch: false, timestampMismatch: true });
  });

  it("marks http/https and www. differences as a variant mismatch", () => {
    for (const recordUrl of ["http://bank.example/", "https://www.bank.example/"]) {
      expect(
        checkCaptureIntegrity({
          linkUrl: "https://bank.example/",
          linkTimestamp: "20190305123456",
          warcHeaders: headers(recordUrl, "2019-03-05T12:34:56Z")
        })
      ).toMatchObject({ status: "mismatch", urlMismatch: true, urlDiffersOnlyByVariant: true });
    }
  });

  it("treats missing or unparseable record headers as a mismatch", () => {
    expect(
      checkCaptureIntegrity({
        linkUrl: "https://bank.example/",
        linkTimestamp: "20190305123456",
        warcHeaders: {}
      })
    ).toMatchObject({ status: "mismatch", recordUrl: "", recordDate: "", urlMismatch: true, timestampMismatch: true });
  });

  it("finds WARC headers regardless of key casing", () => {
    expect(
      checkCaptureIntegrity({
        linkUrl: "https://bank.example/",
        linkTimestamp: "20190305123456",
        warcHeaders: { "warc-target-uri": "https://bank.example/", "warc-date": "2019-03-05T12:34:56Z" }
      }).status
    ).toBe("match");
  });

  it("accepts a 14-digit WARC-Date (mock records)", () => {
    expect(
      checkCaptureIntegrity({
        linkUrl: "https://bank.example/",
        linkTimestamp: "20190305123456",
        warcHeaders: headers("https://bank.example/", "20190305123456")
      }).status
    ).toBe("match");
  });
});

describe("warcDateToCaptureTimestamp", () => {
  it("converts ISO WARC dates to 14-digit timestamps", () => {
    expect(warcDateToCaptureTimestamp("2019-03-05T12:34:56Z")).toBe("20190305123456");
    expect(warcDateToCaptureTimestamp("2019-03-05T12:34:56.789Z")).toBe("20190305123456");
  });

  it("returns undefined for missing or invalid dates", () => {
    expect(warcDateToCaptureTimestamp(undefined)).toBeUndefined();
    expect(warcDateToCaptureTimestamp("not a date")).toBeUndefined();
  });
});

describe("formatCaptureTimestamp", () => {
  it("formats a 14-digit timestamp for display", () => {
    expect(formatCaptureTimestamp("20190305123456")).toBe("2019-03-05 12:34:56 UTC");
  });
});

describe("buildDownloadedHtml", () => {
  it("places the CSP meta tag first when there is no doctype", () => {
    const out = buildDownloadedHtml("<html><body>x</body></html>");
    expect(out.startsWith(`<meta http-equiv="Content-Security-Policy" content="${DOWNLOADED_HTML_CSP}">`)).toBe(true);
    expect(out.endsWith("<html><body>x</body></html>")).toBe(true);
  });

  it("keeps the doctype first so the page stays in standards mode", () => {
    const out = buildDownloadedHtml("<!doctype html><html><body>x</body></html>");
    expect(out.startsWith("<!doctype html><meta http-equiv=\"Content-Security-Policy\"")).toBe(true);
    expect(out).toContain("<html><body>x</body></html>");
  });

  it("restricts scripts and remote loads in the embedded policy", () => {
    expect(DOWNLOADED_HTML_CSP).toContain("default-src 'none'");
    expect(DOWNLOADED_HTML_CSP).toContain("img-src data:");
    expect(DOWNLOADED_HTML_CSP).not.toContain("script-src");
    expect(DOWNLOADED_HTML_CSP).not.toContain("unsafe-eval");
  });
});
