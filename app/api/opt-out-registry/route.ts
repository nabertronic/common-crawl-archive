import { NextResponse } from "next/server";
import { OPT_OUT_REGISTRY_CSV_URL, parseOptOutRegistryCsv } from "@/lib/opt-out-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(OPT_OUT_REGISTRY_CSV_URL, {
      headers: { Accept: "text/csv" },
      next: { revalidate: 24 * 60 * 60 }
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Opt-out registry returned HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const registry = parseOptOutRegistryCsv(await response.text());
    return NextResponse.json(registry, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
      }
    });
  } catch {
    return NextResponse.json(
      { error: "Could not download the Common Crawl opt-out registry." },
      { status: 502 }
    );
  }
}
