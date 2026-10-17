import { describe, expect, it } from "vitest";
import {
  densityBins,
  nearestCaptureIndex,
  parseCaptureTime,
  timelineDomain,
  timeToFraction,
  yearTicks
} from "@/lib/capture-timeline";

const t = (timestamp: string) => parseCaptureTime(timestamp) as number;

describe("capture timeline helpers", () => {
  it("parses Common Crawl timestamps as UTC and rejects junk", () => {
    expect(parseCaptureTime("20260815015000")).toBe(Date.UTC(2026, 7, 15, 1, 50, 0));
    expect(parseCaptureTime("20260815")).toBe(Date.UTC(2026, 7, 15));
    expect(parseCaptureTime("not-a-date")).toBeNull();
  });

  it("accepts complete timestamp precisions and rejects invalid dates, times, and suffixes", () => {
    expect(parseCaptureTime("20240229")).toBe(Date.UTC(2024, 1, 29));
    expect(parseCaptureTime("2024022912")).toBe(Date.UTC(2024, 1, 29, 12));
    expect(parseCaptureTime("202402291230")).toBe(Date.UTC(2024, 1, 29, 12, 30));
    for (const value of [
      "20230229", "20240231", "20241301", "20240101x", "202401011", "2024010112300",
      "2024010124", "202401011260", "20240101123060", "20240101123000junk"
    ]) expect(parseCaptureTime(value), value).toBeNull();
  });

  it("pads the domain and centres a single capture in a one-week window", () => {
    const single = timelineDomain([t("20200101000000")]);
    expect(single).not.toBeNull();
    expect(timeToFraction(t("20200101000000"), single!)).toBeCloseTo(0.5);

    const range = timelineDomain([t("20100101000000"), t("20200101000000")])!;
    expect(range.start).toBeLessThan(t("20100101000000"));
    expect(range.end).toBeGreaterThan(t("20200101000000"));
    expect(timelineDomain([])).toBeNull();
  });

  it("counts captures per time slice", () => {
    const times = [t("20100101000000"), t("20100102000000"), t("20200101000000")];
    const bins = densityBins(times, timelineDomain(times)!, 10);
    expect(bins).toHaveLength(10);
    expect(bins.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(bins[0]).toBe(2);
    expect(bins[9]).toBe(1);
  });

  it("finds the nearest capture on either side of a time", () => {
    const times = [10, 20, 40];
    expect(nearestCaptureIndex(times, 0)).toBe(0);
    expect(nearestCaptureIndex(times, 14)).toBe(0);
    expect(nearestCaptureIndex(times, 16)).toBe(1);
    expect(nearestCaptureIndex(times, 31)).toBe(2);
    expect(nearestCaptureIndex(times, 99)).toBe(2);
    expect(nearestCaptureIndex([], 5)).toBe(-1);
  });

  it("thins year labels to stay under the limit", () => {
    const domain = timelineDomain([t("20080101000000"), t("20261001000000")])!;
    const ticks = yearTicks(domain, 9);
    expect(ticks.length).toBeLessThanOrEqual(9);
    expect(ticks.every(({ year }) => year % 5 === 0)).toBe(true);
    expect(ticks.map(({ year }) => year)).toContain(2020);

    const short = yearTicks(timelineDomain([t("20240601000000"), t("20260601000000")])!, 9);
    expect(short.map(({ year }) => year)).toEqual([2025, 2026]);
  });
});
