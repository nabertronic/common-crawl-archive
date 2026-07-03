import { NextResponse } from "next/server";
import { fetchRobotsStatus } from "@/lib/robots";
import { checkRobotsRouteRateLimit } from "@/lib/robots-rate-limit";
import { safeFetch } from "@/lib/safe-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimit = checkRobotsRouteRateLimit(request);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        status: "unavailable",
        userAgent: "CCBot",
        error: "Too many robots checks. Try again shortly.",
        checkedAt: Date.now()
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000))
        }
      }
    );
  }

  const url = new URL(request.url).searchParams.get("url")?.trim() ?? "";

  if (!url) {
    return NextResponse.json(
      {
        status: "unavailable",
        userAgent: "CCBot",
        error: "Missing url query parameter.",
        checkedAt: Date.now()
      },
      { status: 400 }
    );
  }

  const result = await fetchRobotsStatus(url, undefined, safeFetch);
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
