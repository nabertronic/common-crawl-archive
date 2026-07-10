import type { CommonCrawlCapture } from "@/lib/common-crawl";

export type CaptureUrlGroup = {
  url: string;
  /** All captures of this URL, newest first. */
  versions: CommonCrawlCapture[];
  latestTimestamp: string;
  earliestTimestamp: string;
};

/**
 * Group captures by their exact URL so a domain/host scan can be browsed as a
 * list of URLs, each with its own set of dated versions to click through.
 * Groups are ordered alphabetically by URL (path-tree friendly); versions inside
 * a group are ordered newest first.
 */
export function groupCapturesByUrl(captures: CommonCrawlCapture[]): CaptureUrlGroup[] {
  const byUrl = new Map<string, CommonCrawlCapture[]>();
  for (const capture of captures) {
    const existing = byUrl.get(capture.url);
    if (existing) existing.push(capture);
    else byUrl.set(capture.url, [capture]);
  }

  const groups: CaptureUrlGroup[] = [];
  for (const [url, list] of byUrl) {
    const versions = [...list].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    groups.push({
      url,
      versions,
      latestTimestamp: versions[0]?.timestamp ?? "",
      earliestTimestamp: versions[versions.length - 1]?.timestamp ?? ""
    });
  }

  return groups.sort((left, right) => left.url.localeCompare(right.url));
}
