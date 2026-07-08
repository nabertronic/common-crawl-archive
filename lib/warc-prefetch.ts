import { isHtmlCaptureMime, type CommonCrawlCapture } from "@/lib/common-crawl";
import { captureKey } from "@/lib/scan-results";
import { getSettings } from "@/lib/capture-store";
import { loadCaptureRecord } from "@/lib/warc";

// Best-effort warming of the capture cache when the user hovers/focuses a result
// row, so opening the viewer feels instant. Each capture is attempted at most
// once per session, only for HTML, and only when the HTML cache is enabled (a
// prefetch that can't be cached would just waste bandwidth). All errors are
// swallowed — this must never affect the UI.

const attempted = new Set<string>();

let cachedCacheEnabled: boolean | undefined;
let cacheEnabledCheckedAt = 0;
const CACHE_SETTING_TTL_MS = 5_000;

async function htmlCacheEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedCacheEnabled !== undefined && now - cacheEnabledCheckedAt < CACHE_SETTING_TTL_MS) {
    return cachedCacheEnabled;
  }
  try {
    cachedCacheEnabled = (await getSettings()).htmlCacheEnabled;
  } catch {
    cachedCacheEnabled = false;
  }
  cacheEnabledCheckedAt = now;
  return cachedCacheEnabled;
}

export function prefetchCaptureRecord(capture: CommonCrawlCapture): void {
  if (!isHtmlCaptureMime(capture.mime)) return;
  const key = captureKey(capture);
  if (attempted.has(key)) return;
  attempted.add(key);
  void (async () => {
    try {
      if (!(await htmlCacheEnabled())) return;
      await loadCaptureRecord({ capture, cacheMode: "read-write" });
    } catch {
      // Prefetch is best-effort; a failure just means no warm cache. Allow a
      // later retry (e.g. the user actually opening it) by forgetting the key.
      attempted.delete(key);
    }
  })();
}

/** Test-only reset of the dedupe/settings memo. */
export function __resetPrefetchStateForTests() {
  attempted.clear();
  cachedCacheEnabled = undefined;
  cacheEnabledCheckedAt = 0;
}
