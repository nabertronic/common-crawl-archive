import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { OPT_OUT_REGISTRY_CSV_URL, parseOptOutRegistryCsv } from "@/lib/opt-out-registry";

export const dynamic = "force-dynamic";

// This endpoint is authenticated. Never allow a shared browser/CDN cache to
// replay its response outside the user's Clerk session.
const ROUTE_CACHE_CONTROL = "private, no-store";
const SNAPSHOT_PATH = path.join(process.cwd(), "data", "common-crawl-opt-out-registry-snapshot.csv");

export async function GET() {
  await auth.protect();
  try {
    const response = await fetch(OPT_OUT_REGISTRY_CSV_URL, {
      headers: { Accept: "text/csv" },
      next: { revalidate: 24 * 60 * 60 }
    });

    if (!response.ok) throw new Error(`Opt-out registry returned HTTP ${response.status}`);

    const registry = parseOptOutRegistryCsv(await response.text());
    return NextResponse.json(registry, {
      headers: {
        "Cache-Control": ROUTE_CACHE_CONTROL,
        "X-Opt-Out-Registry-Source": "live"
      }
    });
  } catch {
    const snapshot = await readSnapshotRegistry();
    if (snapshot) {
      return NextResponse.json(snapshot, {
        headers: {
          "Cache-Control": ROUTE_CACHE_CONTROL,
          "X-Opt-Out-Registry-Source": "snapshot"
        }
      });
    }

    return NextResponse.json(
      { error: "Could not download the Common Crawl opt-out registry, and no bundled snapshot was available." },
      { status: 502 }
    );
  }
}

async function readSnapshotRegistry() {
  try {
    const csv = await readFile(SNAPSHOT_PATH, "utf8");
    return parseOptOutRegistryCsv(csv);
  } catch {
    return null;
  }
}
