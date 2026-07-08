type PerfDetail = Record<string, string | number | boolean | undefined>;

const PREFIX = "crawlback";

function canMeasure() {
  return typeof performance !== "undefined" && typeof performance.mark === "function" && typeof performance.measure === "function";
}

function detailSuffix(detail?: PerfDetail) {
  if (!detail) return "";
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length > 0 ? ` {${parts.join(",")}}` : "";
}

export function markPerformance(name: string) {
  if (!canMeasure()) return;
  try {
    performance.mark(`${PREFIX}:${name}`);
  } catch {
    // Performance marks are diagnostic only.
  }
}

export function measurePerformance(name: string, start: string, detail?: PerfDetail) {
  if (!canMeasure()) return;
  const startMark = `${PREFIX}:${start}`;
  const measureName = `${PREFIX}:${name}${detailSuffix(detail)}`;
  try {
    performance.measure(measureName, startMark);
  } catch {
    // Missing marks should never affect app behavior.
  }
}

export async function measureAsync<T>(name: string, task: () => Promise<T>, detail?: PerfDetail): Promise<T> {
  if (!canMeasure()) return task();
  const start = `${name}:start:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  markPerformance(start);
  try {
    return await task();
  } finally {
    measurePerformance(name, start, detail);
  }
}

export function measureSync<T>(name: string, task: () => T, detail?: PerfDetail): T {
  if (!canMeasure()) return task();
  const start = `${name}:start:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  markPerformance(start);
  try {
    return task();
  } finally {
    measurePerformance(name, start, detail);
  }
}

// ---------------------------------------------------------------------------
// Diagnostics: read back the marks/measures above. Everything here is
// development-only tooling — it never runs in production and never changes app
// behavior. The measures already live in the browser Performance timeline; the
// helpers below just aggregate them so a Dev overlay can show p50/p95 without
// forcing anyone to open the DevTools Performance tab.
// ---------------------------------------------------------------------------

export const PERF_MEASURE_PREFIX = `${PREFIX}:`;

export function isDevPerf() {
  return process.env.NODE_ENV !== "production";
}

export type PerfSummaryEntry = {
  name: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  total: number;
};

/** Strip the `crawlback:` prefix and the ` {k=v,...}` detail suffix. */
function baseMeasureName(fullName: string): string {
  const withoutPrefix = fullName.startsWith(PERF_MEASURE_PREFIX)
    ? fullName.slice(PERF_MEASURE_PREFIX.length)
    : fullName;
  const braceIndex = withoutPrefix.indexOf(" {");
  return braceIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, braceIndex);
}

function percentile(sortedDurations: number[], fraction: number): number {
  if (sortedDurations.length === 0) return 0;
  const rank = Math.min(
    sortedDurations.length - 1,
    Math.max(0, Math.ceil(fraction * sortedDurations.length) - 1)
  );
  return sortedDurations[rank];
}

/**
 * Aggregate all `crawlback:*` measures currently in the Performance timeline,
 * grouped by their base name (detail suffix ignored for grouping).
 */
export function getPerfSummary(): PerfSummaryEntry[] {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return [];
  }
  let measures: PerformanceEntryList;
  try {
    measures = performance.getEntriesByType("measure");
  } catch {
    return [];
  }
  const buckets = new Map<string, number[]>();
  for (const entry of measures) {
    if (!entry.name.startsWith(PERF_MEASURE_PREFIX)) continue;
    const name = baseMeasureName(entry.name);
    const durations = buckets.get(name) ?? [];
    durations.push(entry.duration);
    buckets.set(name, durations);
  }
  const summary: PerfSummaryEntry[] = [];
  for (const [name, durations] of buckets) {
    durations.sort((a, b) => a - b);
    const total = durations.reduce((sum, value) => sum + value, 0);
    summary.push({
      name,
      count: durations.length,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations[durations.length - 1] ?? 0,
      total
    });
  }
  return summary.sort((a, b) => b.total - a.total);
}

/**
 * Subscribe to new `crawlback:*` measures as they are recorded. Returns a
 * disconnect function. No-ops outside the browser or when PerformanceObserver
 * is unavailable.
 */
export function observePerformance(onMeasure: (entry: PerformanceEntry) => void): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};
  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name.startsWith(PERF_MEASURE_PREFIX)) onMeasure(entry);
      }
    });
    observer.observe({ entryTypes: ["measure"] });
  } catch {
    return () => {};
  }
  return () => {
    try {
      observer.disconnect();
    } catch {
      // Observer may already be disconnected.
    }
  };
}
