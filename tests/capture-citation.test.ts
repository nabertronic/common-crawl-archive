import { describe, expect, it } from "vitest";
import { formatCaptureCitation, formatCaptureDateLong } from "@/lib/capture-citation";

const retrievedAt = new Date("2026-10-14T09:30:00Z");

describe("formatCaptureCitation", () => {
  it("formats the full citation in UTC", () => {
    expect(
      formatCaptureCitation({
        url: "https://www.whitehouse.gov/pricing",
        timestamp: "20260420141200",
        collection: "CC-MAIN-2026-18",
        retrievedAt
      })
    ).toBe(
      "“whitehouse.gov/pricing.” Captured 20 Apr 2026, 14:12 UTC by Common Crawl (CC-MAIN-2026-18). Retrieved via Crawlback, 14 Oct 2026."
    );
  });

  it("drops the collection part when it is missing", () => {
    const citation = formatCaptureCitation({
      url: "https://example.org/a/",
      timestamp: "20260420141200",
      collection: "",
      retrievedAt
    });
    expect(citation).toBe(
      "“example.org/a.” Captured 20 Apr 2026, 14:12 UTC by Common Crawl. Retrieved via Crawlback, 14 Oct 2026."
    );
    expect(formatCaptureCitation({ url: "https://example.org/", timestamp: "20260420141200", collection: null, retrievedAt }))
      .not.toContain("()");
  });

  it("falls back to the raw timestamp when it is malformed", () => {
    const citation = formatCaptureCitation({
      url: "https://example.org/",
      timestamp: "2026-04-20",
      collection: "CC-MAIN-2026-18",
      retrievedAt
    });
    expect(citation).toContain("Captured 2026-04-20 by Common Crawl (CC-MAIN-2026-18).");
  });

  it("does not format impossible capture dates as valid", () => {
    const citation = formatCaptureCitation({ url: "https://example.org/", timestamp: "20260231141200", retrievedAt });
    expect(citation).toContain("Captured 20260231141200 by Common Crawl.");
    expect(formatCaptureDateLong("20260231141200")).toBe("");
    expect(formatCaptureDateLong("20240229141200")).toBe("29 February 2024");
  });

  it("uses the raw URL when it cannot be parsed", () => {
    const citation = formatCaptureCitation({ url: "not a url", timestamp: "20260420141200", retrievedAt });
    expect(citation.startsWith("“not a url.”")).toBe(true);
  });

  it("keeps the query string and omits the root slash", () => {
    const citation = formatCaptureCitation({
      url: "https://www.example.org/?q=1",
      timestamp: "20260420141200",
      retrievedAt
    });
    expect(citation.startsWith("“example.org?q=1.”")).toBe(true);
  });

  it("does not depend on the runtime locale or timezone for the retrieval date", () => {
    const lateEvening = new Date("2026-12-31T23:30:00Z");
    expect(formatCaptureCitation({ url: "https://example.org/", timestamp: "20260101000000", retrievedAt: lateEvening }))
      .toContain("Retrieved via Crawlback, 31 Dec 2026.");
  });
});

describe("formatCaptureDateLong", () => {
  it("formats the capture day in full month names", () => {
    expect(formatCaptureDateLong("20260420141200")).toBe("20 April 2026");
    expect(formatCaptureDateLong("20260104000000")).toBe("4 January 2026");
  });

  it("returns an empty string for malformed timestamps", () => {
    expect(formatCaptureDateLong("")).toBe("");
    expect(formatCaptureDateLong("20261320000000")).toBe("");
  });
});
