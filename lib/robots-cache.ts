import { robotsUrlForTarget, type RobotsCheckResult } from "./robots";

export const ROBOTS_CACHE_TTL_MS = 48 * 60 * 60 * 1000;
const ROBOTS_CACHE_PREFIX = "wayback-fallback:robots:v1:";

export function readCachedRobotsStatus(
  url: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
  now = Date.now()
): RobotsCheckResult | null {
  try {
    const key = robotsCacheKey(url);
    if (!key || !storage) return null;
    const raw = storage.getItem(key);
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
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage
) {
  try {
    const key = robotsCacheKey(url);
    if (!key || !storage) return;
    storage.setItem(key, JSON.stringify(result));
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
