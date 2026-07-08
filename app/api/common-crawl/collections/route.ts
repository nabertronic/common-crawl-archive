import { NextResponse } from "next/server";
import { fetchCollections } from "@/lib/common-crawl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
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
