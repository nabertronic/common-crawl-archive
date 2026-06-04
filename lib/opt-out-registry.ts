import { searchUrlCoversTarget, type MatchType } from "./common-crawl";

export const OPT_OUT_REGISTRY_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1uavIZ-Y2ew-Vj7d0_pY67SGD2jcUCsZZ5rPy1qEyPzg/export?format=csv&gid=0";

export const OPT_OUT_REGISTRY_CACHE_KEY = "snapshot-search:common-crawl-opt-out-registry:v1";
export const OPT_OUT_REGISTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_VERSION = 1;

export type OptOutEntry = {
  raw: string;
  normalized: string;
  host: string;
  url?: string;
  scope: "domain" | "url";
};

export type OptOutRegistry = {
  version: number;
  fetchedAt: number;
  sourceUpdatedAt?: string;
  entries: OptOutEntry[];
};

export type OptOutMatch = {
  entry: OptOutEntry;
  sourceUpdatedAt?: string;
  fetchedAt: number;
};

type RawOptOutRegistryResponse = {
  sourceUpdatedAt?: unknown;
  entries?: unknown;
};

export function parseOptOutRegistryCsv(csv: string): { sourceUpdatedAt?: string; entries: OptOutEntry[] } {
  const rows = parseCsv(csv);
  const sourceUpdatedAt = rows
    .flat()
    .map((cell) => cell.trim())
    .find((cell) => /^LAST UPDATED:/i.test(cell))
    ?.replace(/^LAST UPDATED:\s*/i, "")
    .trim();
  const urlColumnIndex = urlListColumnIndex(rows[0] ?? []);
  const candidates = rows.flatMap((row) => splitCandidateCell(row[urlColumnIndex] ?? ""));
  return {
    sourceUpdatedAt,
    entries: dedupeEntries(candidates.flatMap((candidate) => normalizeOptOutEntry(candidate)))
  };
}

export function normalizeOptOutEntry(value: string): OptOutEntry[] {
  const raw = stripWrappingPunctuation(value.trim());
  if (!raw || /^LAST UPDATED:/i.test(raw)) return [];
  if (/^[\w\s.-]+$/i.test(raw) && !raw.includes(".")) return [];

  const parsed = parseCandidateUrl(raw);
  if (!parsed) return [];

  const host = normalizeHost(parsed.hostname);
  if (!host || !host.includes(".")) return [];

  const hasPathOrQuery = parsed.pathname !== "/" || parsed.search !== "";
  if (!hasPathOrQuery) {
    const domainHost = normalizeDomainHost(host);
    return [
      {
        raw,
        normalized: domainHost,
        host: domainHost,
        scope: "domain"
      }
    ];
  }

  const normalizedUrl = canonicalUrl(parsed);
  return [
    {
      raw,
      normalized: normalizedUrl,
      host,
      url: normalizedUrl,
      scope: "url"
    }
  ];
}

export async function syncCommonCrawlOptOutRegistry(signal?: AbortSignal): Promise<OptOutRegistry> {
  const cached = readOptOutRegistry({ allowStale: false });
  if (cached) return cached;

  try {
    const response = await fetch(`/api/opt-out-registry`, {
      headers: { Accept: "application/json" },
      signal
    });
    if (!response.ok) throw new Error(`Opt-out registry returned HTTP ${response.status}`);
    const payload = normalizeRegistryResponse((await response.json()) as RawOptOutRegistryResponse);
    const existing = readOptOutRegistry({ allowStale: true });
    const registry: OptOutRegistry = {
      version: CACHE_VERSION,
      fetchedAt: Date.now(),
      sourceUpdatedAt: payload.sourceUpdatedAt,
      entries: mergeOptOutEntries(existing?.entries ?? [], payload.entries)
    };
    writeOptOutRegistry(registry);
    return registry;
  } catch (error) {
    if (signal?.aborted) throw error;
    const stale = readOptOutRegistry({ allowStale: true });
    if (stale) return stale;
    return {
      version: CACHE_VERSION,
      fetchedAt: 0,
      entries: []
    };
  }
}

export async function findOptOutMatch(
  targetUrl: string,
  matchType: MatchType,
  signal?: AbortSignal
): Promise<OptOutMatch | undefined> {
  const registry = await syncCommonCrawlOptOutRegistry(signal);
  return findOptOutMatchInRegistry(targetUrl, matchType, registry);
}

export function findOptOutMatchInRegistry(
  targetUrl: string,
  matchType: MatchType,
  registry: OptOutRegistry
): OptOutMatch | undefined {
  const target = parseCandidateUrl(targetUrl);
  if (!target) return undefined;

  const normalizedTargetUrl = canonicalUrl(target);
  const normalizedTargetHost = normalizeHost(target.hostname);
  const domainTargetHost = normalizeDomainHost(normalizedTargetHost);

  const entry = registry.entries.find((candidate) => {
    if (candidate.scope === "domain") {
      return hostnameWithinDomain(normalizedTargetHost, candidate.host) || hostnameWithinDomain(domainTargetHost, candidate.host);
    }
    if (!candidate.url) return false;
    if (candidate.url === normalizedTargetUrl) return true;
    return matchType !== "exact" && searchUrlCoversTarget(normalizedTargetUrl, matchType, candidate.url, "exact");
  });

  return entry
    ? {
        entry,
        fetchedAt: registry.fetchedAt,
        sourceUpdatedAt: registry.sourceUpdatedAt
      }
    : undefined;
}

function normalizeRegistryResponse(payload: RawOptOutRegistryResponse): { sourceUpdatedAt?: string; entries: OptOutEntry[] } {
  const entries = Array.isArray(payload.entries)
    ? payload.entries.filter(isOptOutEntry)
    : [];
  return {
    sourceUpdatedAt: typeof payload.sourceUpdatedAt === "string" ? payload.sourceUpdatedAt : undefined,
    entries: dedupeEntries(entries)
  };
}

function isOptOutEntry(value: unknown): value is OptOutEntry {
  const entry = value as Partial<OptOutEntry>;
  return (
    typeof entry?.raw === "string" &&
    typeof entry.normalized === "string" &&
    typeof entry.host === "string" &&
    (entry.scope === "domain" || entry.scope === "url") &&
    (entry.url === undefined || typeof entry.url === "string")
  );
}

function readOptOutRegistry({ allowStale }: { allowStale: boolean }): OptOutRegistry | undefined {
  try {
    if (typeof globalThis.localStorage === "undefined") return undefined;
    const value = globalThis.localStorage.getItem(OPT_OUT_REGISTRY_CACHE_KEY);
    if (!value) return undefined;
    const registry = JSON.parse(value) as Partial<OptOutRegistry>;
    if (
      registry.version !== CACHE_VERSION ||
      typeof registry.fetchedAt !== "number" ||
      !Array.isArray(registry.entries)
    ) {
      return undefined;
    }
    if (!allowStale && Date.now() - registry.fetchedAt > OPT_OUT_REGISTRY_CACHE_TTL_MS) return undefined;
    return {
      version: CACHE_VERSION,
      fetchedAt: registry.fetchedAt,
      sourceUpdatedAt: typeof registry.sourceUpdatedAt === "string" ? registry.sourceUpdatedAt : undefined,
      entries: registry.entries.filter(isOptOutEntry)
    };
  } catch {
    return undefined;
  }
}

function writeOptOutRegistry(registry: OptOutRegistry): void {
  try {
    if (typeof globalThis.localStorage === "undefined") return;
    globalThis.localStorage.setItem(OPT_OUT_REGISTRY_CACHE_KEY, JSON.stringify(registry));
  } catch {
    // Registry persistence is best-effort.
  }
}

function mergeOptOutEntries(existing: OptOutEntry[], incoming: OptOutEntry[]): OptOutEntry[] {
  return dedupeEntries([...existing, ...incoming]);
}

function dedupeEntries(entries: OptOutEntry[]) {
  const byKey = new Map<string, OptOutEntry>();
  for (const entry of entries) byKey.set(`${entry.scope}:${entry.normalized}`, entry);
  return Array.from(byKey.values()).sort((a, b) => a.normalized.localeCompare(b.normalized));
}

function urlListColumnIndex(header: string[]) {
  const index = header.findIndex((cell) => /domain|url/i.test(cell));
  return index >= 0 ? index : Math.max(0, header.length - 1);
}

function splitCandidateCell(value: string) {
  return value
    .split(/[\r\n\t ]+|[,;]+\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function parseCandidateUrl(value: string): URL | undefined {
  const candidate = stripWrappingPunctuation(value);
  try {
    return new URL(candidate);
  } catch {
    try {
      return new URL(`https://${candidate}`);
    } catch {
      return undefined;
    }
  }
}

function stripWrappingPunctuation(value: string) {
  return value.replace(/^[<(["'`]+/, "").replace(/[>)\]"'`,.;]+$/, "");
}

function normalizeHost(value: string) {
  return value.toLowerCase().replace(/\.$/, "");
}

function stripLeadingWww(value: string) {
  return value.replace(/^www\./i, "");
}

function normalizeDomainHost(value: string) {
  return stripLeadingWww(value.replace(/^\*\./, ""));
}

function canonicalUrl(value: URL) {
  const url = new URL(value.toString());
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = normalizeHost(url.hostname);
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function hostnameWithinDomain(hostname: string, domain: string) {
  const normalizedDomain = normalizeDomainHost(domain);
  return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
}
