import {
  buildResultsBackHref,
  captureToViewerParams,
  type CommonCrawlCapture,
  type MatchType,
  type ResultsBackContext
} from "./common-crawl";
import type { ScanScope, ScanSession } from "./capture-store";

export type SearchRouteState =
  | { kind: "scan"; scanId: string; action?: string }
  | {
      kind: "legacy";
      url: string;
      matchType: MatchType;
      mock: boolean;
      scope: ScanScope;
      dateFrom?: string;
      dateTo?: string;
      history: boolean;
      action?: string;
      year?: string;
      collection?: string;
      mime?: string;
      status?: string;
      filter?: string;
      sort?: string;
      view?: string;
      page?: number;
    }
  | { kind: "empty" };

export type ViewerRouteState = {
  scanId?: string;
  legacyBackContext?: ResultsBackContext;
};

export function createSearchHref(input: { scanId?: string; action?: string } | { session: ScanSession; action?: string }): string {
  const scanId = "session" in input ? input.session.scanId : input.scanId;
  if (!scanId) return "/";
  const params = new URLSearchParams();
  params.set("scan", scanId);
  if (input.action) params.set("action", input.action);
  return `/search?${params.toString()}`;
}

export function createLegacySearchHref(input: {
  url: string;
  matchType: MatchType;
  mock?: boolean;
  scope: ScanScope;
  dateFrom?: string;
  dateTo?: string;
  action?: string | false;
  history?: boolean;
}) {
  const params = new URLSearchParams();
  if (input.mock) params.set("mock", "1");
  params.set("match", input.matchType);
  // Full scan is the default, so only non-default scopes are written to the URL.
  if (input.scope !== "all") params.set("scope", input.scope);
  if (input.dateFrom) params.set("from", input.dateFrom);
  if (input.dateTo) params.set("to", input.dateTo);
  if (input.action) params.set("action", input.action);
  else if (input.history) params.set("history", "1");
  params.set("url", input.url);
  return `/search?${params.toString()}`;
}

export function createViewerHref(capture: CommonCrawlCapture, input: { scanId?: string; legacyBackContext?: ResultsBackContext }) {
  const params = captureToViewerParams(capture);
  if (input.scanId) {
    params.set("scan", input.scanId);
  } else if (input.legacyBackContext) {
    appendLegacyBackContext(params, input.legacyBackContext);
  }
  return `/view?${params.toString()}`;
}

export function parseSearchRoute(params: URLSearchParams | { get(name: string): string | null }): SearchRouteState {
  const scanId = params.get("scan");
  const action = params.get("action") ?? undefined;
  if (scanId) return { kind: "scan", scanId, action };
  const url = params.get("url")?.trim() ?? "";
  if (!url) return { kind: "empty" };
  return {
    kind: "legacy",
    url,
    matchType: normalizeMatchType(params.get("match")),
    mock: params.get("mock") === "1",
    scope: normalizeScope(params.get("scope"), params.get("from"), params.get("to")),
    dateFrom: params.get("from") ?? undefined,
    dateTo: params.get("to") ?? undefined,
    history: params.get("history") === "1",
    action,
    year: params.get("year") ?? undefined,
    collection: params.get("collection") ?? undefined,
    mime: params.get("mime") ?? undefined,
    status: params.get("status") ?? undefined,
    filter: params.get("filter") ?? undefined,
    sort: params.get("sort") ?? undefined,
    view: params.get("view") ?? undefined,
    page: normalizePage(params.get("page"))
  };
}

export function parseViewerRoute(params: URLSearchParams | { get(name: string): string | null }): ViewerRouteState {
  const scanId = params.get("scan") ?? undefined;
  if (scanId) return { scanId };
  const legacyBackContext = {
    url: params.get("back_url"),
    match: params.get("back_match"),
    mock: params.get("back_mock"),
    scope: params.get("back_scope"),
    dateFrom: params.get("back_from"),
    dateTo: params.get("back_to"),
    history: params.get("back_history"),
    year: params.get("back_year"),
    collection: params.get("back_collection"),
    mime: params.get("back_mime"),
    status: params.get("back_status"),
    filter: params.get("back_filter"),
    sort: params.get("back_sort"),
    view: params.get("back_view"),
    page: params.get("back_page")
  };
  return { legacyBackContext: legacyBackContext.url ? legacyBackContext : undefined };
}

export function viewerBackHref(input: { scanId?: string; legacyBackContext?: ResultsBackContext }) {
  if (input.scanId) return createSearchHref({ scanId: input.scanId });
  if (input.legacyBackContext) return buildResultsBackHref(input.legacyBackContext);
  return null;
}

function appendLegacyBackContext(params: URLSearchParams, context: ResultsBackContext) {
  if (context.url) params.set("back_url", context.url);
  if (context.match) params.set("back_match", context.match);
  if (context.mock) params.set("back_mock", context.mock);
  if (context.scope === "all" || context.scope === "recent" || context.scope === "custom") params.set("back_scope", context.scope);
  if (context.dateFrom) params.set("back_from", context.dateFrom);
  if (context.dateTo) params.set("back_to", context.dateTo);
  if (context.history === "1") params.set("back_history", context.history);
  if (context.year && context.year !== "all") params.set("back_year", context.year);
  if (context.collection && context.collection !== "all") params.set("back_collection", context.collection);
  if (context.mime && context.mime !== "all") params.set("back_mime", context.mime);
  if (context.status && context.status !== "all") params.set("back_status", context.status);
  if (context.filter) params.set("back_filter", context.filter);
  if (context.sort) params.set("back_sort", context.sort);
  if (context.view && context.view !== "list") params.set("back_view", context.view);
  if (context.page && Number(context.page) > 1) params.set("back_page", String(context.page));
}

function normalizeMatchType(value: string | null): MatchType {
  if (value === "host" || value === "domain" || value === "exact") return value;
  return "exact";
}

// A missing scope param means full scan ("all"); "recent" must be written explicitly.
function normalizeScope(scope: string | null, dateFrom: string | null, dateTo: string | null): ScanScope {
  if (scope === "all") return "all";
  if (scope === "recent" && !dateFrom && !dateTo) return "recent";
  if (scope === "custom" || scope === "recent" || dateFrom || dateTo) return "custom";
  return "all";
}

function normalizePage(value: string | null): number | undefined {
  const page = Number(value);
  return Number.isInteger(page) && page > 1 ? page : undefined;
}
