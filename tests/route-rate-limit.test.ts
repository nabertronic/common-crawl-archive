import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRateLimiter } from "@/lib/robots-rate-limit";

function requestFrom(ip: string): Request {
  return new Request("https://app.example/api/x", { headers: { "x-real-ip": ip } });
}

describe("createRouteRateLimiter", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("TRUST_CLOUDFLARE_HEADERS", "");
  });
  afterEach(() => vi.unstubAllEnvs());

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

  it("keys on x-real-ip, then the first x-forwarded-for entry", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 11_000;

    expect(limiter.check(new Request("https://app.example/api/x", {
      headers: { "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" }
    }), now).allowed).toBe(true);
    // Same x-real-ip (different forwarded chain) -> same bucket.
    expect(limiter.check(new Request("https://app.example/api/x", {
      headers: { "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.10" }
    }), now).allowed).toBe(false);
    // No x-real-ip: the first x-forwarded-for entry is the client, with its own bucket.
    const forwarded = () => new Request("https://app.example/api/x", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }
    });
    expect(limiter.check(forwarded(), now).allowed).toBe(true);
    expect(limiter.check(forwarded(), now).allowed).toBe(false);
  });

  it("does not let a rotated cf-connecting-ip bypass the limit by default", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 2 });
    const now = 12_000;
    const spoofed = (cf: string) =>
      new Request("https://app.example/api/x", {
        headers: { "cf-connecting-ip": cf, "x-real-ip": "198.51.100.40" }
      });

    expect(limiter.check(spoofed("192.0.2.1"), now).allowed).toBe(true);
    expect(limiter.check(spoofed("192.0.2.2"), now).allowed).toBe(true);
    expect(limiter.check(spoofed("192.0.2.3"), now).allowed).toBe(false);
  });

  it("uses one shared bucket on direct or unknown deployments regardless of spoofed IP headers", () => {
    vi.stubEnv("VERCEL", "");
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 12_250;
    const spoofed = (ip: string) => new Request("https://app.example/api/x", {
      headers: { "x-real-ip": ip, "x-forwarded-for": ip, "cf-connecting-ip": ip }
    });

    expect(limiter.check(spoofed("192.0.2.20"), now).allowed).toBe(true);
    expect(limiter.check(spoofed("192.0.2.21"), now).allowed).toBe(false);
  });

  it("uses Vercel client headers and ignores independently spoofable Cloudflare headers", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 12_300;
    const fromVercel = (cf: string) => new Request("https://app.example/api/x", {
      headers: { "x-real-ip": "198.51.100.41", "x-forwarded-for": "198.51.100.41", "cf-connecting-ip": cf }
    });

    expect(limiter.check(fromVercel("192.0.2.30"), now).allowed).toBe(true);
    expect(limiter.check(fromVercel("192.0.2.31"), now).allowed).toBe(false);
  });

  it("honors cf-connecting-ip only when TRUST_CLOUDFLARE_HEADERS=1", () => {
    vi.stubEnv("TRUST_CLOUDFLARE_HEADERS", "1");
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 12_500;
    const fromCf = (cf: string) => new Request("https://app.example/api/x", { headers: { "cf-connecting-ip": cf } });

    expect(limiter.check(fromCf("192.0.2.10"), now).allowed).toBe(true);
    expect(limiter.check(fromCf("192.0.2.10"), now).allowed).toBe(false);
    expect(limiter.check(fromCf("192.0.2.11"), now).allowed).toBe(true);
  });

  it("ignores non-IP header values and shares the 'local' bucket", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 13_500;
    const bogus = () => new Request("https://app.example/api/x", { headers: { "x-real-ip": "not-an-ip" } });

    expect(limiter.check(bogus(), now).allowed).toBe(true);
    expect(limiter.check(new Request("https://app.example/api/x"), now).allowed).toBe(false);
  });

  it("bounds the number of retained client buckets", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 14_000;
    // Fill to the 10,000-bucket cap with distinct, still-active clients.
    for (let index = 0; index < 10_000; index += 1) {
      expect(limiter.check(requestFrom(`198.51.${Math.floor(index / 250)}.${(index % 250) + 1}`), now).allowed).toBe(true);
    }
    // New identities share a fail-closed overflow bucket once the cap is reached.
    expect(limiter.check(requestFrom("198.52.0.1"), now).allowed).toBe(true);
    expect(limiter.check(requestFrom("198.52.0.2"), now).allowed).toBe(false);
    // Already-tracked identities keep their own budget.
    expect(limiter.check(requestFrom("198.51.0.1"), now).allowed).toBe(false);
  });

  it("reclaims expired buckets so new clients get their own bucket again", () => {
    const limiter = createRouteRateLimiter({ windowMs: 1000, maxRequests: 1 });
    const now = 15_000;
    for (let index = 0; index < 10_000; index += 1) {
      limiter.check(requestFrom(`198.53.${Math.floor(index / 250)}.${(index % 250) + 1}`), now);
    }
    // After the window, the old buckets are pruned and a new client is tracked individually.
    const later = now + 1000;
    expect(limiter.check(requestFrom("198.54.0.1"), later).allowed).toBe(true);
    expect(limiter.check(requestFrom("198.54.0.2"), later).allowed).toBe(true);
    expect(limiter.check(requestFrom("198.54.0.1"), later).allowed).toBe(false);
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
