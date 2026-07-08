import { afterEach, describe, expect, it } from "vitest";
import { getPerfSummary, measureSync, PERF_MEASURE_PREFIX } from "@/lib/performance";

afterEach(() => {
  try {
    performance.clearMeasures();
    performance.clearMarks();
  } catch {
    // jsdom exposes performance; clearing is best-effort.
  }
});

describe("getPerfSummary", () => {
  it("groups crawlback measures by base name, ignoring the detail suffix", () => {
    measureSync("demo-op", () => 1, { total: 5 });
    measureSync("demo-op", () => 2, { total: 500 });
    measureSync("other-op", () => 3);

    const summary = getPerfSummary();
    const demo = summary.find((entry) => entry.name === "demo-op");
    const other = summary.find((entry) => entry.name === "other-op");

    expect(demo?.count).toBe(2);
    expect(other?.count).toBe(1);
    // p95/max/p50 should be non-negative durations.
    expect(demo?.p95).toBeGreaterThanOrEqual(0);
    expect(demo?.max).toBeGreaterThanOrEqual(demo?.p50 ?? 0);
  });

  it("returns entries sorted by total time descending", () => {
    measureSync("cheap", () => 0);
    measureSync("expensive", () => {
      // Busy-wait a little so the measure has a larger duration.
      const end = performance.now() + 2;
      while (performance.now() < end) {
        /* spin */
      }
    });
    const summary = getPerfSummary();
    for (let i = 1; i < summary.length; i += 1) {
      expect(summary[i - 1].total).toBeGreaterThanOrEqual(summary[i].total);
    }
  });

  it("exposes the crawlback measure prefix", () => {
    expect(PERF_MEASURE_PREFIX).toBe("crawlback:");
  });
});
