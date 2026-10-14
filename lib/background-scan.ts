import { buildCdxjUrl, type CommonCrawlCollection, type MatchType, type ScanDateWindow } from "@/lib/common-crawl";
import { hasStorageConsent } from "@/lib/website-preferences";

// Message protocol shared with public/sw.js. Keep the string literals in sync.
export const SCAN_PREFETCH = "scan:prefetch";
export const SCAN_CANCEL = "scan:cancel";
export const SCAN_PREFETCH_PROGRESS = "scan:prefetch-progress";
export const SCAN_PREFETCH_DONE = "scan:prefetch-done";

const SERVICE_WORKER_URL = "/sw.js";

export type BackgroundScanJob = {
  url: string;
  matchType: MatchType;
  collections: CommonCrawlCollection[];
  coveredCollectionIds?: string[];
  dateWindow?: ScanDateWindow;
};

/**
 * Build the ordered CDX index URLs to warm for a scan's not-yet-covered
 * collections (first page of each). These match the URLs the live scan issues,
 * so warming them lets the service worker serve the scan from cache. Pure.
 */
export function planScanFetches(job: BackgroundScanJob): string[] {
  const covered = new Set(job.coveredCollectionIds ?? []);
  return job.collections
    .filter((collection) => !covered.has(collection.id))
    .map((collection) => buildCdxjUrl(job.url, collection, job.matchType, 0, job.dateWindow));
}

/** True for Common Crawl CDX index requests the service worker should cache. */
export function isCdxIndexRequest(url: string): boolean {
  try {
    return new URL(url).hostname === "index.commoncrawl.org";
  } catch {
    return false;
  }
}

export function backgroundScanSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export async function registerScanServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!hasStorageConsent() || !backgroundScanSupported()) return undefined;
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  } catch {
    return undefined;
  }
}

/**
 * Ask the service worker to keep fetching + caching the given CDX URLs in the
 * background (e.g. while the tab is hidden). Returns false when no controlling
 * worker is available, in which case the caller should just keep scanning in the
 * page. Best-effort; never throws.
 */
export function prefetchScanInBackground(urls: string[], spacingMs = 1100): boolean {
  if (!hasStorageConsent() || !backgroundScanSupported() || urls.length === 0) return false;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return false;
  controller.postMessage({ type: SCAN_PREFETCH, urls, spacingMs });
  return true;
}

export function cancelBackgroundScan(): void {
  if (!backgroundScanSupported()) return;
  navigator.serviceWorker.controller?.postMessage({ type: SCAN_CANCEL });
}
