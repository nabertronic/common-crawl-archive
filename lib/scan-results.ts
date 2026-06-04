import type { CollectionCheckResult, CommonCrawlCapture } from "./common-crawl";

export function captureKey(capture: CommonCrawlCapture): string {
  return `${capture.collectionId}:${capture.timestamp}:${capture.filename}:${capture.offset}`;
}

export function dedupeCaptures<T extends CommonCrawlCapture>(captures: T[]): T[] {
  const seen = new Set<string>();
  return captures.filter((capture) => {
    const key = captureKey(capture);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeCollectionResult(
  existing: CollectionCheckResult | undefined,
  next: CollectionCheckResult
): CollectionCheckResult {
  if (!existing) return next;

  const attempts = existing.attempts + next.attempts;
  const runs = existing.runs + next.runs;

  if (existing.status === "checked" && next.status === "checked") {
    return {
      ...existing,
      captures: dedupeCaptures([...existing.captures, ...next.captures]),
      blockedCaptures: mergeBlockedCaptures(existing.blockedCaptures, next.blockedCaptures),
      attempts,
      runs,
      checkedAt: next.checkedAt ?? existing.checkedAt,
      fromCache: existing.fromCache && next.fromCache
    };
  }

  if (existing.status === "checked" && next.status === "not-checked") {
    return {
      ...existing,
      attempts,
      runs,
      checkedAt: existing.checkedAt ?? next.checkedAt
    };
  }

  if (existing.status === "not-checked" && next.status === "checked") {
    return {
      ...next,
      attempts,
      runs,
      checkedAt: next.checkedAt ?? existing.checkedAt
    };
  }

  return {
    ...next,
    attempts,
    runs,
    checkedAt: next.checkedAt ?? existing.checkedAt
  };
}

export function upsertCollectionResult(
  results: CollectionCheckResult[],
  next: CollectionCheckResult
): CollectionCheckResult[] {
  const index = results.findIndex((result) => result.collection.id === next.collection.id);
  if (index === -1) return [...results, next];
  return results.map((result, currentIndex) =>
    currentIndex === index ? mergeCollectionResult(result, next) : result
  );
}

export function mergeCollectionResults(...groups: CollectionCheckResult[][]): CollectionCheckResult[] {
  const byCollection = new Map<string, CollectionCheckResult>();
  for (const group of groups) {
    for (const result of group) {
      byCollection.set(result.collection.id, mergeCollectionResult(byCollection.get(result.collection.id), result));
    }
  }
  return Array.from(byCollection.values());
}

function mergeBlockedCaptures(
  left: CollectionCheckResult["blockedCaptures"],
  right: CollectionCheckResult["blockedCaptures"]
): CollectionCheckResult["blockedCaptures"] {
  if (!left?.length) return right;
  if (!right?.length) return left;
  const seen = new Set<string>();
  return [...left, ...right].filter((blocked) => {
    const key = captureKey(blocked.capture);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
