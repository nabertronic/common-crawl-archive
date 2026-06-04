import { describe, expect, it } from "vitest";
import {
  findOptOutMatchInRegistry,
  normalizeOptOutEntry,
  parseOptOutRegistryCsv,
  type OptOutRegistry
} from "@/lib/opt-out-registry";

function registry(entries: ReturnType<typeof normalizeOptOutEntry>): OptOutRegistry {
  return {
    version: 1,
    fetchedAt: Date.now(),
    sourceUpdatedAt: "2026 Jun 2",
    entries
  };
}

describe("Common Crawl opt-out registry", () => {
  it("parses multiline Google Sheets CSV cells and dedupes normalized entries", () => {
    const parsed = parseOptOutRegistryCsv(
      [
        "Publisher/Requester,Date of notice,List of domains/URLs",
        "LAST UPDATED: 2026 Jun 2,,",
        'Example,2026-06-01,"example.com',
        "https://www.nycourts.gov/Reporter/3dseries/2016/2016_07834.htm",
        'www.example.com"'
      ].join("\n")
    );

    expect(parsed.sourceUpdatedAt).toBe("2026 Jun 2");
    expect(parsed.entries.map((entry) => entry.normalized)).toEqual([
      "example.com",
      "https://www.nycourts.gov/Reporter/3dseries/2016/2016_07834.htm"
    ]);
  });

  it("normalizes host-only values as domain-wide opt-outs", () => {
    expect(normalizeOptOutEntry("www.example.com")).toEqual([
      {
        raw: "www.example.com",
        normalized: "example.com",
        host: "example.com",
        scope: "domain"
      }
    ]);
  });

  it("normalizes wildcard host-only values as domain-wide opt-outs", () => {
    expect(normalizeOptOutEntry("*.collected.reviews")).toEqual([
      {
        raw: "*.collected.reviews",
        normalized: "collected.reviews",
        host: "collected.reviews",
        scope: "domain"
      }
    ]);
  });

  it("matches exact targets under opted-out domains", () => {
    const match = findOptOutMatchInRegistry(
      "https://blog.example.com/post",
      "exact",
      registry(normalizeOptOutEntry("example.com"))
    );

    expect(match?.entry.normalized).toBe("example.com");
  });

  it("blocks host and domain scans that would cover an opted-out exact URL", () => {
    const entries = normalizeOptOutEntry("https://www.nycourts.gov/Reporter/3dseries/2016/2016_07834.htm");

    expect(findOptOutMatchInRegistry("https://www.nycourts.gov/", "host", registry(entries))).toBeTruthy();
    expect(findOptOutMatchInRegistry("https://nycourts.gov/", "domain", registry(entries))).toBeTruthy();
    expect(findOptOutMatchInRegistry("https://www.nycourts.gov/other", "exact", registry(entries))).toBeUndefined();
  });
});
