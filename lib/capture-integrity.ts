// Checks that a loaded WARC record matches the link that requested it.
// The /view URL carries url/timestamp as plain query params, so a crafted link
// can label a genuine record of one site with another site's URL and date.

export type CaptureIntegrity =
  | { status: "match" }
  | {
      status: "mismatch";
      /** WARC-Target-URI as stored in the record (empty when absent). */
      recordUrl: string;
      /** WARC-Date as stored in the record (empty when absent). */
      recordDate: string;
      urlMismatch: boolean;
      timestampMismatch: boolean;
      /** True when the URLs differ only by scheme (http/https) or a leading "www.". */
      urlDiffersOnlyByVariant: boolean;
    };

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.trim().toLowerCase() === wanted) return value;
  }
  return undefined;
}

/** Parse and normalize a URL with `new URL()`; the fragment is ignored. */
export function normalizeCaptureUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function variantKey(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    // Scheme is deliberately ignored; host (including any non-default port) is kept.
    return `${url.host.replace(/^www\./, "")}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

/**
 * Converts a WARC-Date (ISO 8601) into the 14-digit CDX timestamp form. A value
 * that is already 14 digits is returned as-is (mock records use this form).
 */
export function warcDateToCaptureTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{14}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().replace(/\D/g, "").slice(0, 14);
}

/** Formats a 14-digit CDX timestamp as "YYYY-MM-DD HH:MM:SS UTC" for display. */
export function formatCaptureTimestamp(timestamp: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(timestamp);
  if (!match) return timestamp || "unknown date";
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d} ${h}:${mi}:${s} UTC`;
}

export function checkCaptureIntegrity({
  linkUrl,
  linkTimestamp,
  warcHeaders
}: {
  linkUrl: string;
  linkTimestamp: string;
  warcHeaders: Record<string, string>;
}): CaptureIntegrity {
  const recordUrl = headerValue(warcHeaders, "WARC-Target-URI") ?? "";
  const recordDate = headerValue(warcHeaders, "WARC-Date") ?? "";

  const linkNormalized = normalizeCaptureUrl(linkUrl);
  const recordNormalized = recordUrl ? normalizeCaptureUrl(recordUrl) : undefined;
  const urlMatches =
    linkUrl === recordUrl || (linkNormalized !== undefined && linkNormalized === recordNormalized);

  const recordTimestamp = warcDateToCaptureTimestamp(recordDate);
  const timestampMatches = recordTimestamp !== undefined && recordTimestamp === linkTimestamp;

  if (urlMatches && timestampMatches) return { status: "match" };

  const linkVariant = variantKey(linkUrl);
  const recordVariant = recordUrl ? variantKey(recordUrl) : undefined;
  return {
    status: "mismatch",
    recordUrl,
    recordDate,
    urlMismatch: !urlMatches,
    timestampMismatch: !timestampMatches,
    urlDiffersOnlyByVariant: !urlMatches && linkVariant !== undefined && linkVariant === recordVariant
  };
}

// Policy embedded in downloaded HTML so that opening the file locally cannot run
// scripts or load remote resources. Copied HTML is left unchanged.
export const DOWNLOADED_HTML_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/**
 * Prepends the download CSP meta tag. When the document starts with a doctype,
 * the tag goes directly after it: a doctype that is not the first token would
 * switch the page into quirks mode.
 */
export function buildDownloadedHtml(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${DOWNLOADED_HTML_CSP}">`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return `${doctype[0]}${meta}${html.slice(doctype[0].length)}`;
  return `${meta}${html}`;
}
