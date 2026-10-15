import type { MatchType } from "@/lib/common-crawl";

export type ScanDescriptionScope = "recent" | "all" | "custom";

export type ScanDescriptionInput = {
  matchType?: MatchType | null;
  scope?: ScanDescriptionScope | null;
  from?: string | null;
  to?: string | null;
  earliestYear?: number | null;
};

const MATCH_LABELS: Record<MatchType, string> = {
  exact: "Exact URL",
  host: "Host, all paths",
  domain: "Domain + subdomains"
};

function scopeLabel({ scope, from, to, earliestYear }: ScanDescriptionInput): string | null {
  if (scope === "recent") return "Last 12 months";
  if (scope === "all") {
    return earliestYear ? `Full archive since ${earliestYear}` : "Full archive";
  }
  if (scope === "custom") {
    const start = from?.trim() || "";
    const end = to?.trim() || "";
    if (start && end) return `${start} – ${end}`;
    if (start) return `Since ${start}`;
    if (end) return `Until ${end}`;
  }
  return null;
}

/**
 * Human-readable one-line summary of a scan's match type and scope, e.g.
 * "Exact URL · Last 12 months". Parts that are unknown are omitted.
 */
export function describeScanSettings(input: ScanDescriptionInput): string {
  const parts: string[] = [];
  if (input.matchType && MATCH_LABELS[input.matchType]) parts.push(MATCH_LABELS[input.matchType]);
  const scope = scopeLabel(input);
  if (scope) parts.push(scope);
  return parts.join(" · ");
}
