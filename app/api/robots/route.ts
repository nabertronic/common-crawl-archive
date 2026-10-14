import { NextResponse } from "next/server";
import { fetchRobotsStatus } from "@/lib/robots";
import { checkRobotsRouteRateLimit } from "@/lib/robots-rate-limit";
import { safeFetch } from "@/lib/safe-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const url = await requestTargetUrl(request);

  if (!url) {
    return NextResponse.json(
      {
        status: "unavailable",
        userAgent: "CCBot",
        error: "Missing url in JSON request body.",
        checkedAt: Date.now()
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const result = await fetchRobotsStatus(url, undefined, safeFetch);
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function requestTargetUrl(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return "";

  try {
    const body = await request.text();
    // A target URL is small; reject oversized bodies before parsing to keep a
    // public-facing server route from becoming an allocation sink.
    if (body.length > 16_384) return "";
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && "url" in parsed && typeof parsed.url === "string"
      ? parsed.url.trim()
      : "";
  } catch {
    return "";
  }
}
