import { describe, expect, it } from "vitest";
import { describeScanSettings } from "@/lib/scan-description";

describe("describeScanSettings", () => {
  it("describes each match type with the recent scope", () => {
    expect(describeScanSettings({ matchType: "exact", scope: "recent" })).toBe("Exact URL · Last 12 months");
    expect(describeScanSettings({ matchType: "host", scope: "recent" })).toBe("Host, all paths · Last 12 months");
    expect(describeScanSettings({ matchType: "domain", scope: "recent" })).toBe("Domain + subdomains · Last 12 months");
  });

  it("shows the full archive with its earliest year when known", () => {
    expect(describeScanSettings({ matchType: "host", scope: "all", earliestYear: 2008 })).toBe(
      "Host, all paths · Full archive since 2008"
    );
  });

  it("omits the year for a full archive when the earliest year is unknown", () => {
    expect(describeScanSettings({ matchType: "exact", scope: "all" })).toBe("Exact URL · Full archive");
    expect(describeScanSettings({ matchType: "exact", scope: "all", earliestYear: null })).toBe(
      "Exact URL · Full archive"
    );
  });

  it("formats closed custom ranges as a date span", () => {
    expect(
      describeScanSettings({ matchType: "domain", scope: "custom", from: "2019-01-01", to: "2021-06-30" })
    ).toBe("Domain + subdomains · 2019-01-01 – 2021-06-30");
  });

  it("formats open-ended custom ranges", () => {
    expect(describeScanSettings({ matchType: "exact", scope: "custom", from: "2019-01-01", to: "" })).toBe(
      "Exact URL · Since 2019-01-01"
    );
    expect(describeScanSettings({ matchType: "exact", scope: "custom", from: null, to: "2021-06-30" })).toBe(
      "Exact URL · Until 2021-06-30"
    );
  });

  it("omits the scope part for a custom range without dates", () => {
    expect(describeScanSettings({ matchType: "host", scope: "custom", from: "", to: "" })).toBe("Host, all paths");
  });

  it("omits unknown parts instead of guessing", () => {
    expect(describeScanSettings({ scope: "recent" })).toBe("Last 12 months");
    expect(describeScanSettings({ matchType: "exact" })).toBe("Exact URL");
    expect(describeScanSettings({})).toBe("");
  });
});
