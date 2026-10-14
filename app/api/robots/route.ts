import { NextResponse } from "next/server";
import { fetchRobotsStatus } from "@/lib/robots";
import { checkRobotsRouteRateLimit } from "@/lib/robots-rate-limit";
import { safeFetch } from "@/lib/safe-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TARGET_URL_LENGTH = 2048;

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

  if (url.length > MAX_TARGET_URL_LENGTH) {
    return NextResponse.json(
      {
        status: "unavailable",
        userAgent: "CCBot",
        error: "The target URL is too long.",
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
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) return "";
    if (!request.body) return "";
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 16_384) {
        await reader.cancel();
        return "";
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && "url" in parsed && typeof parsed.url === "string"
      ? parsed.url.trim()
      : "";
  } catch {
    return "";
  }
}
