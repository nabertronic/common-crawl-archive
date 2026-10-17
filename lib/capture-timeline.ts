/**
 * Pure helpers for the capture viewer's timeline scrubber: captures are placed
 * on a real time axis, summarised as a density band, and the pointer position
 * resolves to the nearest capture.
 */

const DAY_MS = 86_400_000;

/** Parses a Common Crawl `YYYYMMDDhhmmss` timestamp as UTC milliseconds. */
export function parseCaptureTime(timestamp: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(?:(\d{2})(\d{2})?)?)?$/.exec(timestamp);
  if (!match) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  // setUTCFullYear avoids Date.UTC's special handling of years 0 through 99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
  return date.getTime();
}

export type TimelineDomain = { start: number; end: number };

/**
 * Time range shown by the scrubber, padded a little on both sides so markers at
 * the first and last capture are not clipped. A single capture (or captures that
 * all share one instant) gets a one-week window centred on it.
 */
export function timelineDomain(times: readonly number[]): TimelineDomain | null {
  if (times.length === 0) return null;
  let min = times[0];
  let max = times[0];
  for (const time of times) {
    if (time < min) min = time;
    if (time > max) max = time;
  }
  if (max === min) return { start: min - 3.5 * DAY_MS, end: max + 3.5 * DAY_MS };
  const pad = (max - min) * 0.015;
  return { start: min - pad, end: max + pad };
}

/** Position of `time` within the domain, clamped to 0..1. */
export function timeToFraction(time: number, domain: TimelineDomain): number {
  const span = domain.end - domain.start;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (time - domain.start) / span));
}

/** Number of captures falling into each of `binCount` equal time slices. */
export function densityBins(times: readonly number[], domain: TimelineDomain, binCount: number): number[] {
  const bins = new Array<number>(Math.max(0, binCount)).fill(0);
  if (binCount <= 0) return bins;
  for (const time of times) {
    const index = Math.min(binCount - 1, Math.floor(timeToFraction(time, domain) * binCount));
    bins[index] += 1;
  }
  return bins;
}

/** Index of the capture closest to `time`; `times` must be sorted ascending. */
export function nearestCaptureIndex(times: readonly number[], time: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && time - times[lo - 1] <= times[lo] - time) return lo - 1;
  return lo;
}

export type YearTick = { year: number; fraction: number };

/**
 * Year boundaries (1 January, UTC) inside the domain, thinned to every 2nd,
 * 5th, … year so at most `maxTicks` labels are returned.
 */
export function yearTicks(domain: TimelineDomain, maxTicks: number): YearTick[] {
  const first = new Date(domain.start).getUTCFullYear() + 1;
  const last = new Date(domain.end).getUTCFullYear();
  const years: number[] = [];
  for (let year = first; year <= last; year += 1) years.push(year);
  if (years.length === 0) return [];
  const step = [1, 2, 5, 10, 20].find((candidate) => Math.ceil(years.length / candidate) <= Math.max(1, maxTicks)) ?? 50;
  return years
    .filter((year) => year % step === 0 || step === 1)
    .map((year) => ({ year, fraction: timeToFraction(Date.UTC(year, 0, 1), domain) }));
}

/**
 * Smooths bin counts with a small binomial kernel and scales them to 0..1
 * (square root, so a few captures stay visible next to dense crawls).
 */
export function smoothDensity(bins: readonly number[]): number[] {
  const kernel = [1, 4, 6, 4, 1];
  const half = kernel.length >> 1;
  const smoothed = bins.map((_, index) => {
    let sum = 0;
    let weight = 0;
    kernel.forEach((k, offset) => {
      const value = bins[index + offset - half];
      if (value === undefined) return;
      sum += value * k;
      weight += k;
    });
    return weight ? sum / weight : 0;
  });
  const max = smoothed.reduce((m, value) => Math.max(m, value), 0);
  return max > 0 ? smoothed.map((value) => Math.sqrt(value / max)) : smoothed;
}
