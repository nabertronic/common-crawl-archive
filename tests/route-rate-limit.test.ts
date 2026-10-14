import { describe, expect, it } from "vitest";
import { createRouteRateLimiter } from "@/lib/robots-rate-limit";

function requestFrom(ip: string): Request {
  return new Request("https://app.example/api/x", { headers: { "x-forwarded-for": ip } });
}

describe("createRouteRateLimiter", () => {
  it("allows up to maxRequests then blocks within the window", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 3 });
    const now = 1_000_000;

    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check(requestFrom("203.0.113.1"), now).allowed).toBe(true);
    }
    const blocked = limiter.check(requestFrom("203.0.113.1"), now);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets the count after the window elapses", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 2 });
    const start = 5_000;

    expect(limiter.check(requestFrom("203.0.113.2"), start).allowed).toBe(true);
    expect(limiter.check(requestFrom("203.0.113.2"), start).allowed).toBe(true);
    expect(limiter.check(requestFrom("203.0.113.2"), start).allowed).toBe(false);

    // A request past resetAt starts a fresh window.
    expect(limiter.check(requestFrom("203.0.113.2"), start + 1000).allowed).toBe(true);
  });

  it("tracks each client independently", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 9_000;

    expect(limiter.check(requestFrom("203.0.113.3"), now).allowed).toBe(true);
    expect(limiter.check(requestFrom("203.0.113.3"), now).allowed).toBe(false);
    // A different client still has its full budget.
    expect(limiter.check(requestFrom("203.0.113.4"), now).allowed).toBe(true);
  });

  it("prefers the cf-connecting-ip header over x-forwarded-for", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 11_000;
    const build = () =>
      new Request("https://app.example/api/x", {
        headers: { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" }
      });

    expect(limiter.check(build(), now).allowed).toBe(true);
    // Same cf-connecting-ip → same bucket, even though x-forwarded-for differs.
    expect(limiter.check(build(), now).allowed).toBe(false);
  });

  it("reset() clears all buckets", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 13_000;

    expect(limiter.check(requestFrom("203.0.113.5"), now).allowed).toBe(true);
    expect(limiter.check(requestFrom("203.0.113.5"), now).allowed).toBe(false);
    limiter.reset();
    expect(limiter.check(requestFrom("203.0.113.5"), now).allowed).toBe(true);
  });

});
