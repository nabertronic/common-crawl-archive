import { NextResponse } from "next/server";
import { fetchRobotsStatus } from "@/lib/robots";
import { safeFetch } from "@/lib/safe-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
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
