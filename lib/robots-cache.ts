import { robotsUrlForTarget, type RobotsCheckResult } from "./robots";
import { hasStorageConsent } from "./website-preferences";

export const ROBOTS_CACHE_TTL_MS = 48 * 60 * 60 * 1000;
const ROBOTS_CACHE_PREFIX = "wayback-fallback:robots:v1:";

export function readCachedRobotsStatus(
  url: string,
  storage?: Pick<Storage, "getItem">,
  now = Date.now()
): RobotsCheckResult | null {
  try {
    if (!hasStorageConsent()) return null;
    const targetStorage = storage === undefined ? globalThis.localStorage : storage;
    const key = robotsCacheKey(url);
    if (!key || !targetStorage) return null;
    const raw = targetStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RobotsCheckResult;
    if (!isRobotsCheckResult(parsed)) return null;
    if (now - parsed.checkedAt >= ROBOTS_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedRobotsStatus(
  url: string,
  result: RobotsCheckResult,
  storage?: Pick<Storage, "setItem">
) {
  try {
    if (!hasStorageConsent()) return;
    const targetStorage = storage === undefined ? globalThis.localStorage : storage;
    const key = robotsCacheKey(url);
    if (!key || !targetStorage) return;
    targetStorage.setItem(key, JSON.stringify(result));
  } catch {
    // Robots cache writes are best-effort.
  }
}

export function robotsCacheKey(url: string) {
  const target = robotsUrlForTarget(url);
  if (!target) return "";
  return `${ROBOTS_CACHE_PREFIX}${encodeURIComponent(`${target.robotsUrl}\n${target.targetPath}`)}`;
}

function isRobotsCheckResult(value: unknown): value is RobotsCheckResult {
  const record = value as Partial<RobotsCheckResult> | undefined;
  return Boolean(
    record &&
    (record.status === "allowed" ||
      record.status === "blocked" ||
      record.status === "no-robots" ||
      record.status === "unavailable") &&
    typeof record.userAgent === "string" &&
    typeof record.checkedAt === "number"
  );
}
