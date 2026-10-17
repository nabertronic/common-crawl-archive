import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(value: string | number | undefined): string {
  const bytes = typeof value === "string" ? Number(value) : value;
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  // 1023.99 KB would print as "1024 KB"; promote it to the next unit instead.
  if (unit < units.length - 1 && Number(size >= 10 ? size.toFixed(0) : size.toFixed(1)) >= 1024) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function formatTimestamp(timestamp: string): string {
  if (!/^\d{14}$/.test(timestamp)) return timestamp;
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)} ${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)} UTC`;
}

export function captureYear(timestamp: string): string {
  return /^\d{4}/.test(timestamp) ? timestamp.slice(0, 4) : "unknown";
}

const HTTP_STATUS_TEXT: Record<string, string> = {
  "200": "OK — request succeeded",
  "201": "Created",
  "204": "No Content",
  "301": "Moved Permanently — permanent redirect",
  "302": "Found — temporary redirect",
  "303": "See Other",
  "304": "Not Modified",
  "307": "Temporary Redirect",
  "308": "Permanent Redirect",
  "400": "Bad Request",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "Not Found",
  "405": "Method Not Allowed",
  "408": "Request Timeout",
  "410": "Gone — resource permanently removed",
  "429": "Too Many Requests — rate limited",
  "451": "Unavailable For Legal Reasons",
  "500": "Internal Server Error",
  "501": "Not Implemented",
  "502": "Bad Gateway",
  "503": "Service Unavailable",
  "504": "Gateway Timeout"
};

export function describeHttpStatus(status: string): string {
  const text = HTTP_STATUS_TEXT[status];
  if (text) return `HTTP ${status} · ${text}`;
  if (/^1\d\d$/.test(status)) return `HTTP ${status} · Informational`;
  if (/^2\d\d$/.test(status)) return `HTTP ${status} · Success`;
  if (/^3\d\d$/.test(status)) return `HTTP ${status} · Redirect`;
  if (/^4\d\d$/.test(status)) return `HTTP ${status} · Client error`;
  if (/^5\d\d$/.test(status)) return `HTTP ${status} · Server error`;
  return `HTTP ${status}`;
}

// Safari and Firefox can cancel a download whose object URL is revoked in the
// same task as the click, so the URL is released after a grace period.
const DOWNLOAD_URL_GRACE_MS = 40_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), DOWNLOAD_URL_GRACE_MS);
}
