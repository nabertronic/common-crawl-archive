import { isIP } from "node:net";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
// Bounds memory: at most this many distinct client buckets are retained.
const MAX_BUCKETS = 10_000;

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Build a fixed-window, per-client rate limiter for an API route. Each limiter
 * owns its own bucket map so distinct routes cannot exhaust one another's
 * budget. Requests are grouped by client IP.
 */
export function createRouteRateLimiter({
  windowMs = RATE_LIMIT_WINDOW_MS,
  maxRequests = RATE_LIMIT_MAX_REQUESTS
}: { windowMs?: number; maxRequests?: number } = {}) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let checksSincePrune = 0;

  function check(request: Request, now = Date.now()): RateLimitResult {
    let key = `ip:${clientKey(request)}`;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (!bucket && buckets.size >= MAX_BUCKETS) {
        prune(now);
        if (buckets.size >= MAX_BUCKETS) {
          key = "ip:overflow";
          bucket = buckets.get(key);
          if (bucket && now < bucket.resetAt) {
            if (bucket.count >= maxRequests) return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
            bucket.count += 1;
            return { allowed: true };
          }
        }
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      if (++checksSincePrune >= 128 || buckets.size > MAX_BUCKETS) {
        prune(now);
        checksSincePrune = 0;
      }
      return { allowed: true };
    }
    if (bucket.count >= maxRequests) {
      return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    }
    bucket.count += 1;
    return { allowed: true };
  }

  function prune(now: number) {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }

  return { check, reset: () => buckets.clear() };
}

/**
 * Resolve the identity used to group requests.
 *
 * Header trust choice: on Vercel, `x-real-ip` and `x-forwarded-for` are set by the
 * platform edge, so they are preferred. `cf-connecting-ip` is NOT set or overwritten
 * by Vercel, so anyone can rotate it per request to escape the limit. It is only
 * honored when the deployment explicitly sits behind Cloudflare and opts in with
 * TRUST_CLOUDFLARE_HEADERS=1. Requests without a usable IP share a "local" bucket.
 */
function clientKey(request: Request) {
  if (process.env.TRUST_CLOUDFLARE_HEADERS === "1") {
    const cfIp = request.headers.get("cf-connecting-ip")?.trim();
    if (cfIp && isIP(cfIp)) return cfIp;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp)) return realIp;
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor && isIP(forwardedFor)) return forwardedFor;
  return "local";
}

const robotsRouteRateLimiter = createRouteRateLimiter();

export function checkRobotsRouteRateLimit(
  request: Request,
  now = Date.now()
): RateLimitResult {
  return robotsRouteRateLimiter.check(request, now);
}

export function resetRobotsRateLimitForTests() {
  robotsRouteRateLimiter.reset();
}
