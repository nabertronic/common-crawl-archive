// Plain-text citation for a Common Crawl capture. Pure and locale-free: every
// date is formatted by hand in UTC so the output is the same in every runtime.

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const TIMESTAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export type CaptureCitationInput = {
  url: string;
  timestamp: string;
  collection?: string | null;
  retrievedAt: Date;
};

export function formatCaptureCitation({ url, timestamp, collection, retrievedAt }: CaptureCitationInput): string {
  const title = citationTitle(url);
  const captured = formatCitationCapturedAt(timestamp);
  const source = collection?.trim() ? ` by Common Crawl (${collection.trim()})` : " by Common Crawl";
  const retrieved = formatCitationDay(retrievedAt);
  return `“${title}.” Captured ${captured}${source}. Retrieved via Crawlback, ${retrieved}.`;
}

/** Long-form UTC date for a 14-digit capture timestamp, e.g. "20 April 2026". Returns "" when malformed. */
export function formatCaptureDateLong(timestamp: string): string {
  const match = TIMESTAMP_PATTERN.exec(timestamp);
  if (!match) return "";
  const month = LONG_MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function citationTitle(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "Untitled capture";
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

function formatCitationCapturedAt(timestamp: string): string {
  const match = TIMESTAMP_PATTERN.exec(timestamp);
  const month = match ? SHORT_MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return timestamp.trim() || "at an unknown date";
  return `${Number(match[3])} ${month} ${match[1]}, ${match[4]}:${match[5]} UTC`;
}

function formatCitationDay(date: Date): string {
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
