import { NextResponse } from "next/server";
import { fetchCollections } from "@/lib/common-crawl";
import { createRouteRateLimiter } from "@/lib/robots-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// This route makes server-side outbound calls to Common Crawl; `?refresh=1`
// skips the cache. Bound how often a client can force those so it can't be used
// to amplify traffic (and get our egress IP throttled by Common Crawl).
const rateLimiter = createRouteRateLimiter({ windowMs: 60_000, maxRequests: 20 });
const UPSTREAM_TIMEOUT_MS = 15_000;
const COLLECTIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cachedCollections: { value: Awaited<ReturnType<typeof fetchCollections>>; expiresAt: number } | undefined;
const collectionsRefreshes = new Map<boolean, Promise<Awaited<ReturnType<typeof fetchCollections>>>>();

export function resetCollectionsRateLimitForTests() {
  rateLimiter.reset();
  cachedCollections = undefined;
  collectionsRefreshes.clear();
}

export async function GET(request: Request) {
  const rateLimit = rateLimiter.check(request);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many source-list requests. Try again shortly." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000))
        }
      }
    );
  }

  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  if (!forceRefresh && cachedCollections && cachedCollections.expiresAt > Date.now()) {
    return NextResponse.json(cachedCollections.value, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    let refresh = collectionsRefreshes.get(forceRefresh);
    if (!refresh) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      refresh = fetchCollections({ forceRefresh, signal: controller.signal }).finally(() => clearTimeout(timeout));
      collectionsRefreshes.set(forceRefresh, refresh);
      void refresh.then(
        (value) => {
          if (collectionsRefreshes.get(forceRefresh) === refresh) collectionsRefreshes.delete(forceRefresh);
          cachedCollections = { value, expiresAt: Date.now() + COLLECTIONS_CACHE_TTL_MS };
        },
        () => { if (collectionsRefreshes.get(forceRefresh) === refresh) collectionsRefreshes.delete(forceRefresh); }
      );
    }
    const collections = await refresh;
    return NextResponse.json(collections, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    // Log the real upstream error server-side only; never echo it to the client.
    console.error("Common Crawl collections fetch failed", error);
    return NextResponse.json(
      { error: "Could not reach Common Crawl from this network" },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
