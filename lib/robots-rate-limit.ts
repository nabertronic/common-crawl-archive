const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Build a fixed-window, per-client rate limiter for an API route. Each limiter
 * owns its own bucket map so distinct routes cannot exhaust one another's
 * budget. Authenticated app routes use the Clerk user ID as their bucket;
 * the IP remains a safe fallback for unauthenticated or infrastructure calls.
 */
export function createRouteRateLimiter({
  windowMs = RATE_LIMIT_WINDOW_MS,
  maxRequests = RATE_LIMIT_MAX_REQUESTS
}: { windowMs?: number; maxRequests?: number } = {}) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function check(request: Request, userId?: string | null, now = Date.now()): RateLimitResult {
    const key = userId ? `user:${userId}` : `ip:${clientKey(request)}`;
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      prune(now);
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

function clientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwardedFor ||
    "local"
  );
}

const robotsRouteRateLimiter = createRouteRateLimiter();

export function checkRobotsRouteRateLimit(
  request: Request,
  userId?: string | null,
  now = Date.now()
): RateLimitResult {
  return robotsRouteRateLimiter.check(request, userId, now);
}

export function resetRobotsRateLimitForTests() {
  robotsRouteRateLimiter.reset();
}
