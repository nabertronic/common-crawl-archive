import { NextResponse } from "next/server";
import { fetchCollections } from "@/lib/common-crawl";
import { createRouteRateLimiter } from "@/lib/robots-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// This route makes server-side outbound calls to Common Crawl; `?refresh=1`
// skips the cache. Bound how often a client can force those so it can't be used
// to amplify traffic (and get our egress IP throttled by Common Crawl).
const rateLimiter = createRouteRateLimiter({ windowMs: 60_000, maxRequests: 20 });

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

  try {
    const collections = await fetchCollections({ forceRefresh });
    return NextResponse.json(collections, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach Common Crawl from this network";
    return NextResponse.json(
      { error: message },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
