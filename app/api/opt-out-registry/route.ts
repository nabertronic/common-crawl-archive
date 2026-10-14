import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { OPT_OUT_REGISTRY_CSV_URL, parseOptOutRegistryCsv } from "@/lib/opt-out-registry";
import { createRouteRateLimiter } from "@/lib/robots-rate-limit";

export const dynamic = "force-dynamic";

// Keep this public API response out of shared browser and CDN caches.
const ROUTE_CACHE_CONTROL = "private, no-store";
const SNAPSHOT_PATH = path.join(process.cwd(), "data", "common-crawl-opt-out-registry-snapshot.csv");
const rateLimiter = createRouteRateLimiter({ windowMs: 60_000, maxRequests: 30 });
const REGISTRY_CACHE_TTL_MS = 5 * 60_000;
const MAX_REGISTRY_BYTES = 5 * 1024 * 1024;
type Registry = ReturnType<typeof parseOptOutRegistryCsv>;
let cachedRegistry: { value: Registry; expiresAt: number; source: "live" | "snapshot" } | undefined;
let registryRefresh: Promise<{ value: Registry; source: "live" | "snapshot" } | null> | undefined;

export function resetOptOutRegistryRouteForTests() {
  rateLimiter.reset();
  cachedRegistry = undefined;
  registryRefresh = undefined;
}

export async function GET(request: Request) {
  const rateLimit = rateLimiter.check(request);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many opt-out registry requests. Try again shortly." }, {
      status: 429,
      headers: { "Cache-Control": ROUTE_CACHE_CONTROL, "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) }
    });
  }
  if (cachedRegistry && cachedRegistry.expiresAt > Date.now()) {
    return registryResponse(cachedRegistry.value, cachedRegistry.source);
  }
  try {
    const result = await refreshRegistry();
    if (result) {
      cachedRegistry = { value: result.value, source: result.source, expiresAt: Date.now() + REGISTRY_CACHE_TTL_MS };
      return registryResponse(result.value, result.source);
    }
  } catch {
    // Snapshot is the bounded fallback when the live request fails.
  }
  return NextResponse.json(
    { error: "Could not download the Common Crawl opt-out registry, and no bundled snapshot was available." },
    { status: 502, headers: { "Cache-Control": ROUTE_CACHE_CONTROL } }
  );
}

async function refreshRegistry(): Promise<{ value: Registry; source: "live" | "snapshot" } | null> {
  if (registryRefresh) return registryRefresh;
  registryRefresh = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(OPT_OUT_REGISTRY_CSV_URL, {
        headers: { Accept: "text/csv" }, signal: controller.signal,
        next: { revalidate: 24 * 60 * 60 }
      });
      if (!response.ok) throw new Error(`Opt-out registry returned HTTP ${response.status}`);
      const parsed = parseOptOutRegistryCsv(await readBoundedText(response, MAX_REGISTRY_BYTES));
      if (parsed.entries.length === 0) throw new Error("Opt-out registry response was empty or malformed.");
      return { value: parsed, source: "live" as const };
    } catch {
      const snapshot = await readSnapshotRegistry();
      return snapshot ? { value: snapshot, source: "snapshot" as const } : null;
    } finally { clearTimeout(timeout); }
  })();
  try { return await registryRefresh; } finally { registryRefresh = undefined; }
}

async function readBoundedText(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("Opt-out registry response exceeded the size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      void reader.cancel().catch(() => {});
      throw new Error("Opt-out registry response exceeded the size limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function registryResponse(registry: Registry, source: "live" | "snapshot") {
  return NextResponse.json(registry, {
    headers: { "Cache-Control": ROUTE_CACHE_CONTROL, "X-Opt-Out-Registry-Source": source }
  });
}

async function readSnapshotRegistry() {
  try {
    const csv = await readFile(SNAPSHOT_PATH, "utf8");
    return parseOptOutRegistryCsv(csv);
  } catch {
    return null;
  }
}
