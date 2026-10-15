import type { CommonCrawlCapture } from "@/lib/common-crawl";
import { captureKey } from "@/lib/scan-results";

/**
 * Returns the `captureKey`s of captures whose content digest differs from the
 * chronologically previous capture of the same URL.
 *
 * - Only status 200 captures participate; redirects and errors are skipped.
 * - Captures without a digest are skipped entirely: never marked, and they do
 *   not break the comparison chain.
 * - The first participating capture of each URL is never marked.
 * - URLs are compared by exact string.
 */
export function findChangedCaptures(captures: CommonCrawlCapture[]): Set<string> {
  const byUrl = new Map<string, CommonCrawlCapture[]>();
  for (const capture of captures) {
    if (capture.status !== "200" || !capture.digest) continue;
    const list = byUrl.get(capture.url);
    if (list) list.push(capture);
    else byUrl.set(capture.url, [capture]);
  }

  const changed = new Set<string>();
  for (const list of byUrl.values()) {
    // Stable sort: captures sharing a timestamp keep their input order.
    list.sort((left, right) => (left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0));
    let previousDigest: string | undefined;
    for (const capture of list) {
      if (previousDigest !== undefined && capture.digest !== previousDigest) {
        changed.add(captureKey(capture));
      }
      previousDigest = capture.digest;
    }
  }
  return changed;
}
