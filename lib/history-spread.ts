// Capture-year spread for history rows. Keys look like
// `warc:crawl-data/CC-MAIN-2020-50/segments/.../file.warc.gz:offset:length`;
// mock keys embed the same collection id, so the year regex covers both.
const COLLECTION_YEAR_PATTERN = /CC-MAIN-(\d{4})(?!\d)/;
const MIN_SPREAD_YEAR = 1990;
const MAX_SPREAD_YEAR = 2100;

function captureYearFromKey(key: unknown): number | undefined {
  if (typeof key !== "string") return undefined;
  const match = COLLECTION_YEAR_PATTERN.exec(key);
  if (!match) return undefined;
  const year = Number(match[1]);
  return year >= MIN_SPREAD_YEAR && year <= MAX_SPREAD_YEAR ? year : undefined;
}

/** One entry per distinct capture key that carries a parseable collection year. Malformed keys are skipped. */
export function captureYearsFromKeys(keys: string[]): number[] {
  const years: number[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "string" || seen.has(key)) continue;
    seen.add(key);
    const year = captureYearFromKey(key);
    if (year !== undefined) years.push(year);
  }
  return years;
}

/** Captures per year from fromYear to toYear inclusive, contiguous, zero-filled. */
export function buildSpread(keys: string[], fromYear = 2008, toYear = new Date().getUTCFullYear()): number[] {
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || toYear < fromYear) return [];
  const counts = Array.from({ length: toYear - fromYear + 1 }, () => 0);
  for (const year of captureYearsFromKeys(keys)) {
    if (year >= fromYear && year <= toYear) counts[year - fromYear] += 1;
  }
  return counts;
}
