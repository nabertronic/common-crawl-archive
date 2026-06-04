"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  CalendarDays,
  ChevronDown,
  Download,
  Clock,
  FileArchive,
  FileText,
  History as HistoryIcon,
  Info,
  List,
  Menu,
  Play,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Square,
  Terminal,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_MATCH_TYPE,
  fetchCollections,
  filterCollectionsByRecentMonths,
  isLikelyCommonCrawlAvailabilityIssue,
  isLikelyRateLimitError,
  queryCollection,
  searchUrlCoversTarget,
  type CollectionCheckResult,
  type CommonCrawlCapture,
  type CommonCrawlCollection,
  type MatchType,
  type ResultsBackContext,
  type SearchProgress,
  type SearchStopReason,
  warcRecordUrl
} from "@/lib/common-crawl";
import { captureYear, formatBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { BrandLockup } from "@/components/brand";
import { CaptureRow, CaptureRowHeader, type SortOption } from "@/components/capture-row";
import { CalendarView } from "@/components/calendar-view";
import { createMockSearchDataset, createMockWarcRecord, isMockCaptureFilename } from "@/lib/mock-data";
import { APP_NAME, buildTabTitle, stripUrlForTitle } from "@/lib/app-meta";
import {
  coverageCaptures,
  coverageResults,
  addCoverageDuration,
  deleteSearches,
  ensureScanSession,
  ensureTarget,
  findOrCreateLegacySession,
  getCoverage,
  getScanSession,
  getSearch,
  legacyScanSearchKey,
  legacyScanSearchKeys,
  listSearches,
  putSearch,
  scanSearchKey,
  searchKey,
  subscribeToSearchChanges,
  upsertCoverageResult,
  type ScanSession,
  type StoredSearch
} from "@/lib/capture-store";
import { dedupeCaptures, mergeCollectionResults, upsertCollectionResult } from "@/lib/scan-results";
import { loadCaptureRecord } from "@/lib/warc";
import { createZipBlob } from "@/lib/zip";
import { robotsUrlForTarget, type RobotsCheckResult } from "@/lib/robots";
import { readCachedRobotsStatus, writeCachedRobotsStatus } from "@/lib/robots-cache";
import { findOptOutMatch, type OptOutMatch } from "@/lib/opt-out-registry";
import { createLegacySearchHref, createSearchHref } from "@/lib/navigation-state";

type ViewMode = "list" | "calendar";
type ScanScope = "recent" | "all";
type RunSearchMode = "fresh" | "resume" | "retry-failed" | "auto-retry" | "missing";

type HtmlZipDownloadState = {
  active: boolean;
  completed: number;
  total: number;
  error?: string;
};

type SearchState =
  | "idle"
  | "loading-collections"
  | "running"
  | "paused"
  | "cancelled"
  | "done"
  | "error";

type RobotsUiState =
  | { status: "checking"; robotsUrl?: string; checkedAt?: number }
  | RobotsCheckResult;

export type ArchiveSearchInitialParams = {
  url?: string;
  match?: string;
  scope?: string;
  history?: string;
  action?: string;
  mock?: string;
  year?: string;
  collection?: string;
  mime?: string;
  status?: string;
  filter?: string;
  sort?: string;
  view?: string;
  page?: string;
  scan?: string;
};

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "timestamp-desc", label: "Date (newest first)" },
  { value: "timestamp-asc", label: "Date (oldest first)" },
  { value: "size-desc", label: "Size (largest first)" },
  { value: "size-asc", label: "Size (smallest first)" },
  { value: "url-asc", label: "URL (A→Z)" },
  { value: "url-desc", label: "URL (Z→A)" },
  { value: "status-asc", label: "Status (asc)" },
  { value: "status-desc", label: "Status (desc)" },
  { value: "collection-desc", label: "Collection (newest first)" },
  { value: "collection-asc", label: "Collection (oldest first)" }
];

const AUTO_RETRY_INTERVAL_MS = 15 * 60 * 1000;

function captureSize(capture: CommonCrawlCapture) {
  const size = Number(capture.length);
  return Number.isFinite(size) ? size : 0;
}

function compareCaptures(a: CommonCrawlCapture, b: CommonCrawlCapture, sort: SortOption) {
  switch (sort) {
    case "timestamp-desc":
      return b.timestamp.localeCompare(a.timestamp);
    case "timestamp-asc":
      return a.timestamp.localeCompare(b.timestamp);
    case "size-desc":
      return captureSize(b) - captureSize(a) || b.timestamp.localeCompare(a.timestamp);
    case "size-asc":
      return captureSize(a) - captureSize(b) || b.timestamp.localeCompare(a.timestamp);
    case "url-asc":
      return a.url.localeCompare(b.url);
    case "url-desc":
      return b.url.localeCompare(a.url);
    case "status-asc":
      return a.status.localeCompare(b.status) || b.timestamp.localeCompare(a.timestamp);
    case "status-desc":
      return b.status.localeCompare(a.status) || b.timestamp.localeCompare(a.timestamp);
    case "collection-asc":
      return a.collectionId.localeCompare(b.collectionId) || b.timestamp.localeCompare(a.timestamp);
    case "collection-desc":
      return b.collectionId.localeCompare(a.collectionId) || b.timestamp.localeCompare(a.timestamp);
    default:
      return 0;
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => b.localeCompare(a));
}

function normalizeInitialUrl(value: string | null) {
  return value?.trim() ?? "";
}

type SearchParamReader = {
  get(name: string): string | null;
};

function searchParamsToInitialParams(params?: SearchParamReader | null): ArchiveSearchInitialParams {
  return {
    url: params?.get("url") ?? undefined,
    match: params?.get("match") ?? undefined,
    scope: params?.get("scope") ?? undefined,
    history: params?.get("history") ?? undefined,
    action: params?.get("action") ?? undefined,
    mock: params?.get("mock") ?? undefined,
    year: params?.get("year") ?? undefined,
    collection: params?.get("collection") ?? undefined,
    mime: params?.get("mime") ?? undefined,
    status: params?.get("status") ?? undefined,
    filter: params?.get("filter") ?? undefined,
    sort: params?.get("sort") ?? undefined,
    view: params?.get("view") ?? undefined,
    page: params?.get("page") ?? undefined,
    scan: params?.get("scan") ?? undefined
  };
}

function resolveInitialParams(initialParams: ArchiveSearchInitialParams, searchParams?: SearchParamReader | null) {
  return Object.keys(initialParams).length > 0 ? initialParams : searchParamsToInitialParams(searchParams);
}

function isBackForwardNavigation() {
  if (typeof performance === "undefined") return false;
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return navigation?.type === "back_forward";
}

function normalizeInitialMatchType(value: string | null): MatchType | undefined {
  if (value === "exact" || value === "host" || value === "domain") return value;
  return undefined;
}

function normalizeInitialScanScope(value: string | null): ScanScope {
  return value === "all" ? "all" : "recent";
}

function normalizeInitialViewMode(value: string | null): ViewMode {
  return value === "calendar" ? "calendar" : "list";
}

function normalizeInitialSort(value: string | null): SortOption {
  if (
    value === "timestamp-asc" ||
    value === "timestamp-desc" ||
    value === "url-asc" ||
    value === "url-desc" ||
    value === "status-asc" ||
    value === "status-desc" ||
    value === "collection-asc" ||
    value === "collection-desc" ||
    value === "size-asc" ||
    value === "size-desc"
  ) {
    return value;
  }
  return "timestamp-desc";
}

function normalizeInitialPage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 1 ? page : 1;
}

function buildMockSearchHref(url: string, matchType: MatchType) {
  return createLegacySearchHref({ url, matchType, mock: true, scope: "recent" });
}

function removeResult(results: CollectionCheckResult[], collectionId: string) {
  return results.filter((result) => result.collection.id !== collectionId);
}

function collectionsForScope(collections: CommonCrawlCollection[], scope: ScanScope) {
  return scope === "all" ? collections : filterCollectionsByRecentMonths(collections);
}

function capturesFromResults(results: CollectionCheckResult[]) {
  return dedupeCaptures(results.flatMap((result) => result.captures));
}

// Rebuild per-collection scan-log entries from cached captures for records that
// stored captures but no `results` (legacy/captures-only). Collections that
// already have a real stored result are skipped so we never overwrite richer data.
function synthesizeResultsFromCaptures(
  captures: CommonCrawlCapture[],
  existingResults: CollectionCheckResult[],
  activeCollections: CommonCrawlCollection[],
  checkedAt: number | undefined
): CollectionCheckResult[] {
  const existingIds = new Set(existingResults.map((result) => result.collection.id));
  const collectionById = new Map(activeCollections.map((collection) => [collection.id, collection]));
  const byCollection = new Map<string, CommonCrawlCapture[]>();
  for (const capture of captures) {
    if (existingIds.has(capture.collectionId)) continue;
    const list = byCollection.get(capture.collectionId);
    if (list) list.push(capture);
    else byCollection.set(capture.collectionId, [capture]);
  }
  const synthesized: CollectionCheckResult[] = [];
  for (const [collectionId, collectionCaptures] of byCollection) {
    const collection =
      collectionById.get(collectionId) ?? {
        id: collectionId,
        name: collectionCaptures[0]?.collectionName ?? collectionId,
        cdxApi: "",
        from: collectionCaptures[0]?.collectionFrom ?? "",
        to: collectionCaptures[0]?.collectionTo ?? ""
      };
    synthesized.push({
      collection,
      status: "checked",
      captures: collectionCaptures,
      checkedAt,
      httpStatus: 200,
      attempts: 1,
      runs: 1,
      fromCache: true
    });
  }
  return synthesized;
}

function capturesFromStoredRecords(records: StoredSearch[], activeCollections: CommonCrawlCollection[]) {
  const activeIds = new Set(activeCollections.map((collection) => collection.id));
  return dedupeCaptures(
    records
      .flatMap((record) => record.captures ?? [])
      .filter((capture) => activeIds.has(capture.collectionId))
  );
}

function capturesFromAnyStoredRecords(records: StoredSearch[]) {
  return dedupeCaptures(records.flatMap((record) => record.captures ?? []));
}

function validStoredResults(results: CollectionCheckResult[] | undefined, collections: CommonCrawlCollection[]) {
  if (!Array.isArray(results)) return [];
  const validIds = new Set(collections.map((collection) => collection.id));
  return results.filter((result) => typeof result?.collection?.id === "string" && validIds.has(result.collection.id));
}

function resultCollectionIds(results: CollectionCheckResult[], status?: CollectionCheckResult["status"]) {
  return new Set(
    results
      .filter((result) => (status ? result.status === status : true))
      .map((result) => result.collection.id)
  );
}

function escapeCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

type ExportScope = "filtered" | "all";
type CaptureColumnKey =
  | "url"
  | "timestamp"
  | "collection"
  | "status"
  | "mime"
  | "digest"
  | "warcUrl"
  | "warcPosition";

const CAPTURE_COLUMNS: {
  key: CaptureColumnKey;
  label: string;
  value: (capture: CommonCrawlCapture) => string;
}[] = [
  { key: "url", label: "URL", value: (capture) => capture.url },
  { key: "timestamp", label: "Timestamp", value: (capture) => capture.timestamp },
  { key: "collection", label: "Collection", value: (capture) => capture.collectionId },
  { key: "status", label: "Status", value: (capture) => capture.status },
  { key: "mime", label: "MIME", value: (capture) => capture.mime },
  { key: "digest", label: "Digest", value: (capture) => capture.digest ?? "" },
  { key: "warcUrl", label: "WARC URL", value: (capture) => warcRecordUrl(capture.filename) },
  {
    key: "warcPosition",
    label: "WARC Position",
    value: (capture) => `offset=${capture.offset};length=${capture.length}`
  }
];

const DEFAULT_EXPORT_COLUMNS: CaptureColumnKey[] = [
  "url",
  "collection",
  "warcUrl",
  "warcPosition"
];

function selectedExportColumns(columnKeys: CaptureColumnKey[]) {
  // Preserve the canonical column order regardless of selection order.
  return CAPTURE_COLUMNS.filter((column) => columnKeys.includes(column.key));
}

function buildCaptureExport(
  captures: CommonCrawlCapture[],
  columnKeys: CaptureColumnKey[]
): { blob: Blob; filename: string } {
  const columns = selectedExportColumns(columnKeys);
  const date = new Date().toISOString().slice(0, 10);

  const rows = [
    columns.map((column) => column.label),
    ...captures.map((capture) => columns.map((column) => column.value(capture)))
  ];
  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  return {
    blob: new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    filename: `common-crawl-results-${date}.csv`
  };
}

function downloadCaptureExport(captures: CommonCrawlCapture[], columnKeys: CaptureColumnKey[]) {
  const { blob, filename } = buildCaptureExport(captures, columnKeys);
  downloadBlob(blob, filename);
}

function sanitizeArchiveFilename(value: string) {
  const cleaned = value
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return cleaned || "capture";
}

function htmlArchiveFilename(capture: CommonCrawlCapture, index: number) {
  return [
    String(index + 1).padStart(4, "0"),
    capture.collectionId,
    capture.timestamp,
    sanitizeArchiveFilename(capture.url)
  ].join("_") + ".html";
}

// Sorts before the "0001_…" capture files so it is the first entry users see.
const HTML_ZIP_WARNING_FILENAME = "0000_WARNING_READ-ME-FIRST.txt";

function htmlZipWarningContent(): string {
  return `================================================================
  WARNING – READ ME FIRST
  Security & privacy when opening these HTML files
================================================================

This ZIP contains archived HTML pages from the Common Crawl
dataset. Only the HTML document itself was stored — NOT the images,
scripts, stylesheets, fonts or other assets it references.

Those assets are still present in the HTML as references to the
LIVE WEB (e.g. <img src="https://...">, <script src="...">,
<link href="...">). As soon as you open one of these files in a
browser WITH an internet connection, the browser fetches that
content in real time from third-party servers.

This is NOT a true snapshot of the images/assets — it is a live
fetch performed at the moment you open the file.


----------------------------------------------------------------
PRIVACY RISKS
----------------------------------------------------------------

* Revealing connections: Every fetched asset sends a request to a
  third-party server, exposing your IP address, a timestamp, your
  browser/device identifier (User-Agent) and possibly the referrer.

* Tracking pixels & beacons: Archived pages often contain invisible
  counting/tracking pixels, analytics and ad scripts. Opening the
  file tells the operators (and ad/tracking networks) THAT and WHEN
  you are viewing this specific content.

* Re-identification: Your IP address gets linked to the viewing of
  one specific archived item — even if the original site has long
  been offline.

* Cookies & local storage: Embedded third-party content can set
  cookies or send existing ones if you are signed in to services in
  the same browser.


----------------------------------------------------------------
SECURITY RISKS
----------------------------------------------------------------

* Active code: The raw HTML can contain <script> tags and event
  handlers. Opening it directly in a browser may EXECUTE that code
  (unlike the app's hardened preview, which runs in a sandbox and
  blocks assets).

* Malicious code from the live web: The fetched server content is
  NOT the content from back then. If an original domain has since
  been taken over, hijacked or replaced with malicious code, opening
  the file may deliver current malware (drive-by downloads, exploits).

* Misleading rendering: Because images/scripts load live, the page
  may NO LONGER reflect the archived state. For evidence
  preservation, research or documentation, the rendering is
  therefore not trustworthy.

* Phishing / mixed content: Embedded forms or redirects may point to
  current, possibly malicious destinations.


----------------------------------------------------------------
HOW TO REDUCE THE RISKS
----------------------------------------------------------------

1. OPEN WITHOUT AN INTERNET CONNECTION (most important step)
   Disconnect from the internet before opening a file (airplane
   mode, Wi-Fi/LAN off, or a firewall block). The browser then
   CANNOT fetch any assets and CANNOT contact any third-party
   server. You will see only the archived HTML text — images and
   external content stay blank. This is intended and the safest
   state.

2. Disable JavaScript
   Turn off JavaScript in your browser before opening the file so
   that embedded active code cannot run.

3. Use an isolated environment
   Open the files in a virtual machine, a separate browser profile
   with no logins/extensions, or a throwaway container. This
   protects your cookies, logins and main system.

4. Use a content/tracking blocker
   An ad/tracking blocker reduces third-party content if you do open
   the file online.

5. Only open captures you trust
   Be especially careful with pages from unknown or dubious sources.

Rule of thumb: open OFFLINE for plain reading/archiving. Only go
online if you deliberately and knowingly want to contact the
original source again.

================================================================
Generated by the Common Crawl Archive Viewer.
================================================================
`;
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

function scanScopesForStoredMerge(scope: ScanScope): ScanScope[] {
  return scope === "all" ? ["recent", "all"] : ["all", "recent"];
}

async function getStoredScanVariants(url: string, matchType: MatchType, mock: boolean, scope: ScanScope) {
  const keys = new Set([
    ...scanScopesForStoredMerge(scope).map((candidateScope) => scanSearchKey(url, matchType, mock, candidateScope)),
    ...legacyScanSearchKeys(url, matchType, mock)
  ]);
  const [keyedRecords, broaderRecords] = await Promise.all([
    Promise.all(Array.from(keys).map((key) => getSearch(key))),
    getBroaderStoredScanRecords(url, matchType, mock, scope)
  ]);
  return uniqueStoredSearches([
    ...keyedRecords.filter((record): record is StoredSearch => Boolean(record)),
    ...broaderRecords
  ]).map((record) => filterStoredSearchForRequest(record, url, matchType));
}

function compatibleCaptureMatchTypes(matchType: MatchType): MatchType[] {
  if (matchType === "domain") return ["exact", "host", "domain"];
  if (matchType === "host") return ["exact", "host"];
  return ["exact"];
}

async function getCompatibleStoredCaptureRecords(url: string, matchType: MatchType, mock: boolean) {
  const keys = new Set<string>();
  for (const compatibleMatchType of compatibleCaptureMatchTypes(matchType)) {
    keys.add(searchKey(url, compatibleMatchType, mock));
    keys.add(scanSearchKey(url, compatibleMatchType, mock, "recent"));
    keys.add(scanSearchKey(url, compatibleMatchType, mock, "all"));
    for (const legacyKey of legacyScanSearchKeys(url, compatibleMatchType, mock)) {
      keys.add(legacyKey);
    }
  }
  const [keyedRecords, broaderRecords] = await Promise.all([
    Promise.all(Array.from(keys).map((key) => getSearch(key))),
    getBroaderStoredScanRecords(url, matchType, mock, "recent")
  ]);
  return uniqueStoredSearches([
    ...keyedRecords.filter((record): record is StoredSearch => Boolean(record)),
    ...broaderRecords
  ]).map((record) => filterStoredSearchForRequest(record, url, matchType));
}

async function getBroaderStoredScanRecords(url: string, matchType: MatchType, mock: boolean, scope: ScanScope) {
  const records = await listSearches();
  const targetScopeRank = scopeCoverageRank(scope);
  return records.filter((record) => {
    if (record.mock !== mock) return false;
    if (record.scanScope !== "recent" && record.scanScope !== "all") return false;
    if (scopeCoverageRank(record.scanScope) < targetScopeRank) return false;
    return searchUrlCoversTarget(record.url, record.matchType, url, matchType);
  });
}

function uniqueStoredSearches(records: StoredSearch[]) {
  const byKey = new Map<string, StoredSearch>();
  for (const record of records) byKey.set(record.key, record);
  return Array.from(byKey.values());
}

function filterStoredSearchForRequest(record: StoredSearch, url: string, matchType: MatchType): StoredSearch {
  const filterCapture = (capture: CommonCrawlCapture) => captureMatchesRequest(capture.url, url, matchType);
  return {
    ...record,
    captures: record.captures.filter(filterCapture),
    results: record.results?.map((result) => ({
      ...result,
      captures: result.captures.filter(filterCapture),
      blockedCaptures: result.blockedCaptures?.filter((blocked) => filterCapture(blocked.capture))
    }))
  };
}

function captureMatchesRequest(captureUrl: string, targetUrl: string, matchType: MatchType) {
  return searchUrlCoversTarget(targetUrl, matchType, captureUrl, "exact");
}

function scopeCoverageRank(scope: ScanScope) {
  return scope === "all" ? 1 : 0;
}

type AutoRetryState = {
  enabled: boolean;
  nextRetryAt?: number;
};

function autoRetryStateKey(url: string, matchType: MatchType, mock: boolean, scope: ScanScope) {
  return `${scanSearchKey(url, matchType, mock, scope)}:auto-retry`;
}

function readAutoRetryState(url: string, matchType: MatchType, mock: boolean, scope: ScanScope): AutoRetryState | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const value = window.localStorage.getItem(autoRetryStateKey(url, matchType, mock, scope));
    if (!value) return undefined;
    const record = JSON.parse(value) as Partial<AutoRetryState>;
    return {
      enabled: record.enabled !== false,
      nextRetryAt: typeof record.nextRetryAt === "number" ? record.nextRetryAt : undefined
    };
  } catch {
    return undefined;
  }
}

function writeAutoRetryState(
  url: string,
  matchType: MatchType,
  mock: boolean,
  scope: ScanScope,
  state: AutoRetryState
) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(autoRetryStateKey(url, matchType, mock, scope), JSON.stringify(state));
  } catch {
    // Auto-retry persistence is best-effort.
  }
}

function clearAutoRetryState(url: string, matchType: MatchType, mock: boolean, scope: ScanScope) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(autoRetryStateKey(url, matchType, mock, scope));
  } catch {
    // Auto-retry persistence is best-effort.
  }
}

function mergeStoredScanRecords(records: StoredSearch[], activeCollections: CommonCrawlCollection[]) {
  const scopedRecords = records.filter((record) => record.scanScope === "recent" || record.scanScope === "all");
  const recentRecords = scopedRecords.filter((record) => record.scanScope === "recent");
  const fullRecords = scopedRecords.filter((record) => record.scanScope === "all");
  return mergeCollectionResults(
    ...recentRecords.map((record) => validStoredResults(record.results, activeCollections)),
    ...fullRecords.map((record) => validStoredResults(record.results, activeCollections))
  );
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatLogTimestamp(value: number | undefined, withDate = false) {
  if (!value) return "--:--:--";
  const date = new Date(value);
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  if (!withDate) return time;
  return `${date.toLocaleDateString()} ${time}`;
}

// Show the date alongside the time when any scan-log entry is from a day other
// than today — i.e. a scan reopened from history, or one that ran across days.
function scanLogNeedsDate(timestamps: (number | undefined)[]) {
  const todayKey = new Date().toDateString();
  return timestamps.some(
    (value) => typeof value === "number" && new Date(value).toDateString() !== todayKey
  );
}

// Widen the timestamp column when a date is shown so it stays on one line
// instead of wrapping and making every row twice as tall.
function scanLogRowClass(withDate: boolean) {
  return `grid gap-2 px-3 py-2 text-xs text-zinc-400 ${
    withDate ? "sm:grid-cols-[150px_130px_1fr]" : "sm:grid-cols-[74px_130px_1fr]"
  }`;
}

function TopRightMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const itemClass =
    "flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 focus:outline-none focus-visible:bg-zinc-800";

  return (
    <div ref={containerRef} className="fixed right-4 top-4 z-30 md:right-8 md:top-6">
      <button
        type="button"
        aria-label="Open menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700 bg-zinc-950/70 text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
      >
        <Menu size={20} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-44 overflow-hidden rounded-md border border-zinc-700 bg-zinc-950/95 shadow-lg shadow-black/40 backdrop-blur"
        >
          <Link href="/history" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
            <HistoryIcon size={16} />
            History
          </Link>
          <Link href="/settings" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
            <Settings size={16} />
            Settings
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function ArchiveSearchApp({
  autoStart = false,
  initialParams = {}
}: {
  autoStart?: boolean;
  initialParams?: ArchiveSearchInitialParams;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeParams = useMemo(
    () => resolveInitialParams(initialParams, searchParams),
    [initialParams, searchParams]
  );
  const initialUrl = normalizeInitialUrl(routeParams.url ?? null);
  const initialMatchType = normalizeInitialMatchType(routeParams.match ?? null);
  const initialScanScope = normalizeInitialScanScope(routeParams.scope ?? null);
  const initialHistoryMode = routeParams.history === "1";
  const initialAction = routeParams.action;
  const initialMockMode = routeParams.mock === "1";
  const initialViewMode = normalizeInitialViewMode(routeParams.view ?? null);
  const initialSortBy = normalizeInitialSort(routeParams.sort ?? null);
  const initialPage = normalizeInitialPage(routeParams.page ?? null);
  const initialScanId = routeParams.scan;
  const startsFromSearchRoute = autoStart;
  const [targetUrl, setTargetUrl] = useState(initialUrl);
  const [matchType, setMatchType] = useState<MatchType>(initialMatchType ?? DEFAULT_MATCH_TYPE);
  const [collections, setCollections] = useState<CommonCrawlCollection[]>([]);
  const [captures, setCaptures] = useState<CommonCrawlCapture[]>([]);
  const [failedResults, setFailedResults] = useState<CollectionCheckResult[]>([]);
  const [progress, setProgress] = useState<SearchProgress>({
    checked: 0,
    total: 0,
    hits: 0,
    failed: 0,
    activeCollections: []
  });
  const [state, setState] = useState<SearchState>(startsFromSearchRoute ? "loading-collections" : "idle");
  const [error, setError] = useState("");
  const [yearFilter, setYearFilter] = useState(routeParams.year ?? "all");
  const [collectionFilter, setCollectionFilter] = useState(routeParams.collection ?? "all");
  const [mimeFilter, setMimeFilter] = useState(routeParams.mime ?? "all");
  const [statusFilter, setStatusFilter] = useState(routeParams.status ?? "all");
  const [urlFilter, setUrlFilter] = useState(routeParams.filter ?? "");
  const [sortBy, setSortBy] = useState<SortOption>(initialSortBy);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [scanScope, setScanScope] = useState<ScanScope>(initialScanScope);
  const [page, setPage] = useState(initialPage);
  const [checkedCollectionIds, setCheckedCollectionIds] = useState<Set<string>>(new Set());
  const [scanLog, setScanLog] = useState<CollectionCheckResult[]>([]);
  const [scanLogOpen, setScanLogOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scanStartedAt, setScanStartedAt] = useState<number | undefined>();
  const [activeScanId, setActiveScanId] = useState(initialScanId ?? "");
  const [persistedScanScope, setPersistedScanScope] = useState<ScanScope>(initialScanScope);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(true);
  const [nextAutoRetryAt, setNextAutoRetryAt] = useState<number | undefined>();
  // True when the displayed results were loaded from storage (history) rather
  // than scanned live this session. A stored view is static: no auto-retry
  // countdown, no "paused/slow" notice, and no automatic API requests.
  const [isStoredView, setIsStoredView] = useState(false);
  const [robotsStatus, setRobotsStatus] = useState<RobotsUiState | null>(null);
  const [optOutMatch, setOptOutMatch] = useState<OptOutMatch | null>(null);
  // When an opt-out URL is opened from history, this holds the original scan's
  // timestamp so the log/banner reflect the past scan rather than "now".
  const [optOutCachedScanAt, setOptOutCachedScanAt] = useState<number | undefined>();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [htmlZipDownload, setHtmlZipDownload] = useState<HtmlZipDownloadState>({
    active: false,
    completed: 0,
    total: 0
  });
  const [exportScope, setExportScope] = useState<ExportScope>("filtered");
  const [exportColumns, setExportColumns] = useState<CaptureColumnKey[]>(DEFAULT_EXPORT_COLUMNS);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const robotsAbortRef = useRef<AbortController | null>(null);
  const htmlZipAbortRef = useRef<AbortController | null>(null);
  const autoStartedSignatureRef = useRef<string | null>(null);
  const filterResetMountedRef = useRef(false);
  const targetUrlInputRef = useRef<HTMLInputElement | null>(null);
  const autoStartSignature = [
    initialMockMode ? "mock" : "live",
    initialUrl,
    initialMatchType ?? DEFAULT_MATCH_TYPE,
    initialScanScope,
    initialHistoryMode ? "history" : "run",
    initialAction ?? "fresh",
    routeParams.year ?? "all",
    routeParams.collection ?? "all",
    routeParams.mime ?? "all",
    routeParams.status ?? "all",
    routeParams.filter ?? "",
    routeParams.sort ?? "timestamp-desc",
    routeParams.view ?? "list",
    routeParams.page ?? "1",
    routeParams.scan ?? ""
  ].join("\u001f");

  const syncRestoredTargetUrl = useCallback(() => {
    const restoredUrl = targetUrlInputRef.current?.value.trim() ?? "";
    if (!restoredUrl) return;
    setTargetUrl((currentUrl) => (currentUrl.trim() ? currentUrl : restoredUrl));
  }, []);

  const applyRouteResultParams = useCallback(() => {
    setYearFilter(routeParams.year ?? "all");
    setCollectionFilter(routeParams.collection ?? "all");
    setMimeFilter(routeParams.mime ?? "all");
    setStatusFilter(routeParams.status ?? "all");
    setUrlFilter(routeParams.filter ?? "");
    setSortBy(normalizeInitialSort(routeParams.sort ?? null));
    setViewMode(normalizeInitialViewMode(routeParams.view ?? null));
    setPage(normalizeInitialPage(routeParams.page ?? null));
  }, [
    routeParams.collection,
    routeParams.filter,
    routeParams.mime,
    routeParams.page,
    routeParams.sort,
    routeParams.status,
    routeParams.view,
    routeParams.year
  ]);

  const clearFreshHomeSearchState = useCallback(() => {
    if (autoStart || initialUrl) return;
    const input = targetUrlInputRef.current;
    if (input && document.activeElement === input && input.value.trim()) return;
    abortRef.current?.abort();
    setTargetUrl("");
    setMatchType(DEFAULT_MATCH_TYPE);
    setCaptures([]);
    setFailedResults([]);
    setProgress({
      checked: 0,
      total: 0,
      hits: 0,
      failed: 0,
      activeCollections: []
    });
    setState("idle");
    setError("");
    setYearFilter("all");
    setCollectionFilter("all");
    setMimeFilter("all");
    setStatusFilter("all");
    setUrlFilter("");
    setSortBy("timestamp-desc");
    setViewMode("list");
    setScanScope("recent");
    setPage(1);
    setCheckedCollectionIds(new Set());
    setScanLog([]);
    setScanLogOpen(false);
    setAdvancedOpen(false);
    setScanStartedAt(undefined);
    setActiveScanId("");
    setPersistedScanScope("recent");
    setElapsedMs(0);
    setAutoRetryEnabled(true);
    setNextAutoRetryAt(undefined);
    setIsStoredView(false);
    setRobotsStatus(null);
    setOptOutMatch(null);
    setOptOutCachedScanAt(undefined);
    if (targetUrlInputRef.current) targetUrlInputRef.current.value = "";
  }, [autoStart, initialUrl]);

  const filteredCaptures = useMemo(() => {
    const query = urlFilter.trim().toLowerCase();
    const filtered = captures.filter((capture) => {
      if (yearFilter !== "all" && captureYear(capture.timestamp) !== yearFilter) return false;
      if (collectionFilter !== "all" && capture.collectionId !== collectionFilter) return false;
      if (mimeFilter !== "all" && capture.mime !== mimeFilter) return false;
      if (statusFilter !== "all" && capture.status !== statusFilter) return false;
      if (query && !capture.url.toLowerCase().includes(query)) return false;
      return true;
    });
    return filtered.sort((a, b) => compareCaptures(a, b, sortBy));
  }, [captures, collectionFilter, mimeFilter, sortBy, statusFilter, urlFilter, yearFilter]);

  const exportCaptures = exportScope === "all" ? captures : filteredCaptures;
  const canExport = exportCaptures.length > 0;

  const toggleExportColumn = useCallback((key: CaptureColumnKey) => {
    setExportColumns((current) =>
      current.includes(key) ? current.filter((column) => column !== key) : [...current, key]
    );
  }, []);

  const pageSize = 100;
  const totalPages = Math.max(1, Math.ceil(filteredCaptures.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedCaptures = useMemo(
    () => filteredCaptures.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredCaptures, currentPage]
  );

  useEffect(() => {
    if (!filterResetMountedRef.current) {
      filterResetMountedRef.current = true;
      return;
    }
    setPage(1);
  }, [collectionFilter, mimeFilter, sortBy, statusFilter, urlFilter, yearFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const syncOrClear = (restoreFromHistory: boolean) => {
      if (restoreFromHistory) {
        syncRestoredTargetUrl();
        return;
      }
      clearFreshHomeSearchState();
    };
    syncOrClear(isBackForwardNavigation());
    const animationFrameId = window.requestAnimationFrame(() => syncOrClear(isBackForwardNavigation()));
    const timeoutId = window.setTimeout(() => syncOrClear(isBackForwardNavigation()), 100);
    const handlePageShow = (event: PageTransitionEvent) => syncOrClear(event.persisted || isBackForwardNavigation());

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [clearFreshHomeSearchState, syncRestoredTargetUrl]);

  const filterOptions = useMemo(
    () => ({
      years: unique(captures.map((capture) => captureYear(capture.timestamp))),
      collections: unique(captures.map((capture) => capture.collectionId)),
      mimes: unique(captures.map((capture) => capture.mime)),
      statuses: unique(captures.map((capture) => capture.status))
    }),
    [captures]
  );

  const scopedCollections = useMemo(
    () => collectionsForScope(collections, scanScope),
    [collections, scanScope]
  );

  const earliestArchiveYear = useMemo(() => {
    let earliest: number | undefined;
    for (const collection of collections) {
      const match = collection.from?.match(/^(\d{4})/);
      if (!match) continue;
      const year = Number(match[1]);
      if (!Number.isFinite(year)) continue;
      if (earliest === undefined || year < earliest) earliest = year;
    }
    return earliest ?? 2008;
  }, [collections]);

  async function loadCollectionsIfNeeded(controller: AbortController) {
    if (collections.length > 0) return collections;
    const loaded = await fetchCollections(controller.signal);
    setCollections(loaded);
    return loaded;
  }

  function applySessionFilters(session: ScanSession) {
    setYearFilter(session.year ?? "all");
    setCollectionFilter(session.collection ?? "all");
    setMimeFilter(session.mime ?? "all");
    setStatusFilter(session.status ?? "all");
    setUrlFilter(session.filter ?? "");
    setSortBy(normalizeInitialSort(session.sort ?? null));
    setViewMode(normalizeInitialViewMode(session.view ?? null));
    setPage(session.page && session.page > 1 ? session.page : 1);
  }

  function applySessionIdentity(session: ScanSession) {
    setActiveScanId(session.scanId);
    setTargetUrl(session.url);
    setMatchType(session.matchType);
    setScanScope(session.scope);
    setPersistedScanScope(session.scope);
    applySessionFilters(session);
  }

  async function applyCoverageToState(session: ScanSession, loadedCollections = collections) {
    const activeCollections = collectionsForScope(loadedCollections, session.scope);
    const activeIds = new Set(activeCollections.map((collection) => collection.id));
    const coverage = await getCoverage(session.targetId);
    const results = coverageResults(coverage).filter((result) => activeIds.has(result.collection.id));
    const checkedIds = resultCollectionIds(results);
    const failed = results.filter((result) => result.status === "not-checked");
    const storedCaptures = dedupeCaptures(
      coverageCaptures(coverage).filter((capture) => activeIds.has(capture.collectionId))
    );

    setCollections(loadedCollections);
    setCaptures(storedCaptures);
    setFailedResults(failed);
    setCheckedCollectionIds(checkedIds);
    setScanLog(results);
    // The scan log always starts collapsed when restoring a stored scan; its
    // open/closed state is intentionally not remembered across visits.
    setScanLogOpen(false);
    setError("");
    setState(results.length > 0 ? "done" : startsFromSearchRoute ? "done" : "idle");
    setIsStoredView(results.length > 0);
    setScanStartedAt(coverage?.updatedAt);
    setElapsedMs(coverage?.durationMs ?? 0);
    setProgress({
      checked: checkedIds.size,
      total: activeCollections.length,
      hits: storedCaptures.length,
      failed: failed.length,
      activeCollections: []
    });
  }

  async function loadSessionById(scanId: string) {
    const session = await getScanSession(scanId);
    if (!session) return false;
    void checkRobotsForUrl(session.url);
    const loadedCollections = collections.length > 0 ? collections : await fetchCollections();
    applySessionIdentity(session);
    await applyCoverageToState(session, loadedCollections);
    return true;
  }

  async function loadStoredScan(url: string, activeMatchType: MatchType, activeScope: ScanScope) {
    void checkRobotsForUrl(url);
    const loadedCollections = collections.length > 0 ? collections : await fetchCollections();
    const legacySession = await findOrCreateLegacySession(url, activeMatchType, false, activeScope);
    applySessionIdentity(legacySession);
    await applyCoverageToState(legacySession, loadedCollections);
    return true;
  }

  function loadMockResults(options: { url?: string; matchType?: MatchType; syncRoute?: boolean } = {}) {
    abortRef.current?.abort();
    robotsAbortRef.current?.abort();
    const url = (options.url ?? targetUrl).trim() || "https://example.org/";
    const activeMatchType = options.matchType ?? matchType;
    const mock = createMockSearchDataset(url, activeMatchType);
    const checkedIds = new Set(mock.collections.map((collection) => collection.id));
    const failedCount = mock.failedResults.length;
    const persistedAutoRetry = readAutoRetryState(url, activeMatchType, true, "recent");

    setTargetUrl(url);
    setMatchType(activeMatchType);
    setScanScope("recent");
    setPersistedScanScope("recent");
    setCollections(mock.collections);
    setCaptures(mock.captures);
    setFailedResults(mock.failedResults);
    setCheckedCollectionIds(checkedIds);
    setScanLog(mock.scanLog);
    // The scan log only opens when the user expands it.
    setScanLogOpen(false);
    setError("");
    setState("done");
    setIsStoredView(true);
    setScanStartedAt(Date.now() - 129000);
    setElapsedMs(129000);
    setAutoRetryEnabled(persistedAutoRetry?.enabled ?? true);
    setNextAutoRetryAt(persistedAutoRetry?.nextRetryAt);
    setRobotsStatus(null);
    setOptOutMatch(null);
    setOptOutCachedScanAt(undefined);
    setProgress({
      checked: mock.collections.length,
      total: mock.collections.length,
      hits: mock.captures.length,
      failed: failedCount,
      activeCollections: []
    });

    if (options.syncRoute) {
      const nextHref = buildMockSearchHref(url, activeMatchType);
      const currentHref = `${window.location.pathname}${window.location.search}`;
      if (nextHref !== currentHref) router.replace(nextHref);
    }
  }

  async function runSearch(
    mode: RunSearchMode = "fresh",
    options: { url?: string; matchType?: MatchType; scope?: ScanScope } = {}
  ) {
    const fallbackUrl = targetUrl || targetUrlInputRef.current?.value || "";
    const url = (options.url ?? fallbackUrl).trim();
    const activeMatchType = options.matchType ?? matchType;
    const activeScope = options.scope ?? scanScope;
    if (!url) return;

    const session = await ensureScanSession({
      scanId: mode === "fresh" ? undefined : activeScanId || undefined,
      url,
      matchType: activeMatchType,
      mock: initialMockMode,
      scope: activeScope,
      year: yearFilter,
      collection: collectionFilter,
      mime: mimeFilter,
      status: statusFilter,
      filter: urlFilter,
      sort: sortBy,
      view: viewMode,
      page: page > 1 ? page : undefined
    });
    applySessionIdentity(session);

    if (mode === "fresh") {
      const nextHref = createSearchHref({
        session,
        action: window.location.pathname === "/search" ? undefined : "fresh"
      });
      const currentHref = `${window.location.pathname}${window.location.search}`;
      if (nextHref !== currentHref) {
        router.replace(nextHref);
        if (window.location.pathname !== "/search") return;
      }
    }

    setError("");
    await executeRunSearch(mode, { session });
  }

  async function executeRunSearch(
    mode: RunSearchMode,
    options: { session: ScanSession }
  ) {
    const session = options.session;
    const url = session.url;
    const activeMatchType = session.matchType;
    const activeScope = session.scope;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void checkRobotsForUrl(url, controller.signal);
    setError("");
    setOptOutMatch(null);
    setIsStoredView(false);
    setScanScope(activeScope);
    setPersistedScanScope(activeScope);
    const startedAt = mode === "fresh" || !scanStartedAt ? Date.now() : scanStartedAt;
    setScanStartedAt(startedAt);
    setElapsedMs(mode === "fresh" ? 0 : Date.now() - startedAt);
    setNextAutoRetryAt(undefined);
    setState(collections.length > 0 ? "running" : "loading-collections");

    const loadStoredForMode =
      mode === "fresh" ||
      mode === "missing" ||
      ((mode === "retry-failed" || mode === "auto-retry") &&
        checkedCollectionIds.size === 0 &&
        failedResults.length === 0);

    if (mode === "fresh" || mode === "missing" || loadStoredForMode) {
      setCaptures([]);
      setFailedResults([]);
      setCheckedCollectionIds(new Set());
      setScanLog([]);
      setProgress({ checked: 0, total: 0, hits: 0, failed: 0, activeCollections: [] });
    }

    try {
      const activeOptOutMatch = await findOptOutMatch(url, activeMatchType, controller.signal);
      if (activeOptOutMatch) {
        const activeCollections = collectionsForScope(collections, activeScope);
        const storedRecords = loadStoredForMode ? await getStoredScanVariants(url, activeMatchType, false, activeScope) : [];
        const compatibleCaptureRecords = loadStoredForMode
          ? await getCompatibleStoredCaptureRecords(url, activeMatchType, false)
          : [];
        const storedResults = activeCollections.length > 0
          ? mergeStoredScanRecords(storedRecords, activeCollections)
          : [];
        const storedCaptures = loadStoredForMode
          ? dedupeCaptures([
              ...capturesFromAnyStoredRecords(compatibleCaptureRecords),
              ...capturesFromResults(storedResults.filter((result) => result.status === "checked"))
            ])
          : captures;

        // The opt-out check only blocks a *live re-scan*. The historical scan
        // still happened, so rebuild its full per-collection log: stored
        // `results` where present, plus entries synthesized from cached captures
        // for collections that only stored captures (legacy/captures-only records).
        const recordTimestamps = [...storedRecords, ...compatibleCaptureRecords]
          .map((record) => record.updatedAt)
          .filter((value): value is number => typeof value === "number");
        const scannedAt = recordTimestamps.length > 0 ? Math.max(...recordTimestamps) : startedAt;
        const reconstructedResults = [
          ...storedResults,
          ...synthesizeResultsFromCaptures(storedCaptures, storedResults, activeCollections, scannedAt)
        ];
        const storedCheckedIds = resultCollectionIds(reconstructedResults);
        const storedFailedResults = reconstructedResults.filter((result) => result.status === "not-checked");
        const optOutCoverage = await getCoverage(session.targetId);

        setOptOutMatch(activeOptOutMatch);
        setIsStoredView(true);
        setOptOutCachedScanAt(storedCaptures.length > 0 ? scannedAt : undefined);
        setElapsedMs(optOutCoverage?.durationMs ?? 0);
        setCaptures(storedCaptures);
        setFailedResults(storedFailedResults);
        setCheckedCollectionIds(storedCheckedIds);
        setScanLog(reconstructedResults);
        // Restored historical scan (live re-scan blocked) stays collapsed.
        setScanLogOpen(false);
        setProgress({
          checked: storedCheckedIds.size,
          total: activeCollections.length,
          hits: storedCaptures.length,
          failed: storedFailedResults.length,
          activeCollections: []
        });
        setState("done");
        return;
      }

      const loadedCollections = await loadCollectionsIfNeeded(controller);
      const activeCollections = collectionsForScope(loadedCollections, activeScope);
      const target = await ensureTarget(url, activeMatchType, initialMockMode);
      let coverage = await getCoverage(session.targetId);
      let currentResults = coverageResults(coverage).filter((result) =>
        activeCollections.some((collection) => collection.id === result.collection.id)
      );
      let currentCaptures = coverageCaptures(coverage).filter((capture) =>
        activeCollections.some((collection) => collection.id === capture.collectionId)
      );
      let currentCheckedIds = resultCollectionIds(currentResults);
      let currentFailedResults = currentResults.filter((result) => result.status === "not-checked");
      const failedIds = new Set(currentFailedResults.map((result) => result.collection.id));
      const attemptedIds = resultCollectionIds(currentResults);
      let searchSet = activeCollections.filter((collection) => !currentCheckedIds.has(collection.id));

      if (mode === "missing") {
        searchSet = activeCollections.filter((collection) => !attemptedIds.has(collection.id));
      } else if (mode === "retry-failed") {
        searchSet = activeCollections.filter((collection) => failedIds.has(collection.id));
      } else if (mode === "auto-retry") {
        searchSet = activeCollections.filter((collection) => failedIds.has(collection.id) || !attemptedIds.has(collection.id));
      }

      setCollections(loadedCollections);
      setCaptures(currentCaptures);
      setFailedResults(currentFailedResults);
      setCheckedCollectionIds(currentCheckedIds);
      setScanLog(currentResults);
      // Stored coverage loaded before a (re)scan stays collapsed; the live scan
      // loop below will expand it once new results start streaming in.
      setScanLogOpen(false);
      setProgress({
        checked: currentCheckedIds.size,
        total: activeCollections.length,
        hits: currentCaptures.length,
        failed: currentFailedResults.length,
        activeCollections: []
      });

      if (searchSet.length === 0) {
        setState("done");
        return;
      }

      setState("running");
      const runStartedAt = Date.now();
      let consecutiveAvailabilitySignals = 0;
      let stopReason: SearchStopReason = "completed";

      for (const collection of searchSet) {
        if (controller.signal.aborted) break;

        coverage = await getCoverage(session.targetId);
        const existing = coverage?.collectionResults[collection.id];
        if (existing?.status === "checked") {
          currentResults = coverageResults(coverage).filter((result) =>
            activeCollections.some((activeCollection) => activeCollection.id === result.collection.id)
          );
          currentCaptures = coverageCaptures(coverage).filter((capture) =>
            activeCollections.some((activeCollection) => activeCollection.id === capture.collectionId)
          );
          currentCheckedIds = resultCollectionIds(currentResults);
          setCaptures(currentCaptures);
          setCheckedCollectionIds(currentCheckedIds);
          setScanLog(currentResults);
          continue;
        }

        setProgress((current) => ({ ...current, activeCollections: [collection.id] }));
        const result = await queryCollection(url, collection, controller.signal, undefined, undefined, undefined, undefined, activeMatchType);
        coverage = await upsertCoverageResult(target, result);
        currentResults = coverageResults(coverage).filter((storedResult) =>
          activeCollections.some((activeCollection) => activeCollection.id === storedResult.collection.id)
        );
        currentCaptures = coverageCaptures(coverage).filter((capture) =>
          activeCollections.some((activeCollection) => activeCollection.id === capture.collectionId)
        );
        currentCheckedIds = resultCollectionIds(currentResults);
        currentFailedResults = currentResults.filter((storedResult) => storedResult.status === "not-checked");

        setCaptures(currentCaptures);
        setFailedResults(currentFailedResults);
        setCheckedCollectionIds(currentCheckedIds);
        setScanLog(currentResults);
        setProgress({
          checked: currentCheckedIds.size,
          total: activeCollections.length,
          hits: currentCaptures.length,
          failed: currentFailedResults.length,
          activeCollections: []
        });

        const availabilitySignal =
          result.status === "not-checked" &&
          isLikelyCommonCrawlAvailabilityIssue(result.error, result.httpStatus, result.errorKind);
        consecutiveAvailabilitySignals = availabilitySignal ? consecutiveAvailabilitySignals + 1 : 0;
        if (consecutiveAvailabilitySignals >= DEFAULT_CIRCUIT_BREAKER_THRESHOLD) {
          stopReason = "circuit-breaker";
          break;
        }
      }

      void addCoverageDuration(target.targetId, Date.now() - runStartedAt);

      if (controller.signal.aborted) {
        setState("cancelled");
      } else if (stopReason === "circuit-breaker") {
        setState("paused");
      } else {
        setState("done");
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setState("cancelled");
        return;
      }
      setError(formatSearchError(err));
      setState("error");
    }
  }

  async function checkRobotsForUrl(url: string, parentSignal?: AbortSignal) {
    const target = robotsUrlForTarget(url);
    const cached = readCachedRobotsStatus(url);
    if (cached) {
      setRobotsStatus(cached);
      return;
    }

    robotsAbortRef.current?.abort();
    const controller = new AbortController();
    robotsAbortRef.current = controller;
    setRobotsStatus({ status: "checking", robotsUrl: target?.robotsUrl, checkedAt: Date.now() });

    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener("abort", abortFromParent, { once: true });
      }
    }

    try {
      const result = await fetchRobotsStatusViaApi(url, controller.signal);
      if (!controller.signal.aborted) {
        writeCachedRobotsStatus(url, result);
        setRobotsStatus(result);
      }
    } catch {
      if (!controller.signal.aborted) {
        const result: RobotsCheckResult = {
          status: "unavailable",
          robotsUrl: target?.robotsUrl,
          userAgent: "CCBot",
          error: "robots.txt could not be checked.",
          checkedAt: Date.now()
        };
        writeCachedRobotsStatus(url, result);
        setRobotsStatus(result);
      }
    } finally {
      parentSignal?.removeEventListener("abort", abortFromParent);
      if (robotsAbortRef.current === controller) robotsAbortRef.current = null;
    }
  }

  async function fetchRobotsStatusViaApi(url: string, signal: AbortSignal): Promise<RobotsCheckResult> {
    const response = await fetch(`/api/robots?${new URLSearchParams({ url }).toString()}`, {
      headers: { Accept: "application/json" },
      signal
    });
    const result = (await response.json()) as RobotsCheckResult;
    if (response.ok) return result;
    return {
      status: "unavailable",
      robotsUrl: "robotsUrl" in result ? result.robotsUrl : robotsUrlForTarget(url)?.robotsUrl,
      userAgent: "CCBot",
      error: "error" in result ? result.error : `Robots check endpoint returned HTTP ${response.status}.`,
      checkedAt: Date.now()
    };
  }

  async function downloadHtmlZip(capturesToDownload: CommonCrawlCapture[]) {
    if (capturesToDownload.length === 0 || htmlZipDownload.active) return;
    const controller = new AbortController();
    htmlZipAbortRef.current = controller;
    setHtmlZipDownload({
      active: true,
      completed: 0,
      total: capturesToDownload.length
    });

    try {
      const entries: { filename: string; content: string }[] = [
        { filename: HTML_ZIP_WARNING_FILENAME, content: htmlZipWarningContent() }
      ];
      for (let index = 0; index < capturesToDownload.length; index += 1) {
        if (controller.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
        const capture = capturesToDownload[index];
        const record = isMockCaptureFilename(capture.filename)
          ? createMockWarcRecord({
              filename: capture.filename,
              timestamp: capture.timestamp,
              url: capture.url,
              collection: capture.collectionId
            })
          : await loadCaptureRecord({
              capture,
              signal: controller.signal
            }).then((loaded) => loaded.record);

        entries.push({
          filename: htmlArchiveFilename(capture, index),
          content: record.html
        });
        setHtmlZipDownload({
          active: true,
          completed: index + 1,
          total: capturesToDownload.length
        });
      }

      downloadBlob(
        createZipBlob(entries),
        `common-crawl-html-${new Date().toISOString().slice(0, 10)}.zip`
      );
      setHtmlZipDownload({
        active: false,
        completed: capturesToDownload.length,
        total: capturesToDownload.length
      });
    } catch (error) {
      if (controller.signal.aborted) {
        setHtmlZipDownload({
          active: false,
          completed: 0,
          total: 0
        });
        return;
      }
      setHtmlZipDownload({
        active: false,
        completed: 0,
        total: capturesToDownload.length,
        error: error instanceof Error ? error.message : "Could not download all HTML captures."
      });
    } finally {
      if (htmlZipAbortRef.current === controller) htmlZipAbortRef.current = null;
    }
  }

  function cancelHtmlZipDownload() {
    htmlZipAbortRef.current?.abort();
  }

  useEffect(() => {
    if (initialScanId && autoStartedSignatureRef.current !== autoStartSignature) {
      autoStartedSignatureRef.current = autoStartSignature;
      void (async () => {
        const loaded = await loadSessionById(initialScanId);
        if (!loaded) {
          setError("This scan session could not be found.");
          setState("error");
          return;
        }
        const session = await getScanSession(initialScanId);
        if (!session || !initialAction) return;
        if (initialAction === "fresh") {
          await executeRunSearch("fresh", { session });
        } else if (initialAction === "retry-failed") {
          await runSearch("retry-failed", { url: session.url, matchType: session.matchType, scope: session.scope });
        } else if (initialAction === "missing") {
          await runSearch("missing", { url: session.url, matchType: session.matchType, scope: session.scope });
        }
      })();
      return;
    }
    if (initialMockMode && autoStartedSignatureRef.current !== autoStartSignature) {
      autoStartedSignatureRef.current = autoStartSignature;
      applyRouteResultParams();
      loadMockResults({
        url: initialUrl || "https://example.org/",
        matchType: initialMatchType ?? DEFAULT_MATCH_TYPE
      });
      return;
    }
    if (!autoStart || !initialUrl || autoStartedSignatureRef.current === autoStartSignature) return;
    autoStartedSignatureRef.current = autoStartSignature;
    applyRouteResultParams();
    setTargetUrl(initialUrl);
    const nextMatchType = initialMatchType ?? DEFAULT_MATCH_TYPE;
    setMatchType(nextMatchType);
    setScanScope(initialScanScope);
    setPersistedScanScope(initialScanScope);
    void (async () => {
      await loadStoredScan(initialUrl, nextMatchType, initialScanScope);
      if (initialHistoryMode) return;

      if (initialAction === "retry-failed") {
        await runSearch("retry-failed", { url: initialUrl, matchType: nextMatchType, scope: initialScanScope });
        return;
      }
      if (initialAction === "missing") {
        await runSearch("missing", { url: initialUrl, matchType: nextMatchType, scope: initialScanScope });
        return;
      }
      await runSearch("fresh", { url: initialUrl, matchType: nextMatchType, scope: initialScanScope });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, autoStartSignature, initialScanId, initialUrl, initialMatchType, initialScanScope, initialHistoryMode, initialAction, initialMockMode, applyRouteResultParams]);

  const isRunning = state === "loading-collections" || state === "running";
  const currentFailedResults = scanLog.filter((result) => result.status === "not-checked");
  const retryableFailedResults = failedResults.length > 0 ? failedResults : currentFailedResults;
  const availabilityIssue = retryableFailedResults.some((result) =>
    isLikelyCommonCrawlAvailabilityIssue(result.error, result.httpStatus, result.errorKind)
  );
  const hasExplicitRateLimit = retryableFailedResults.some((result) =>
    isLikelyRateLimitError(result.error, result.httpStatus, result.errorKind)
  );
  const hasGatewayTimeout = retryableFailedResults.some((result) => result.errorKind === "http_504_gateway_timeout");
  const hasSlowDown = retryableFailedResults.some((result) => result.errorKind === "http_500_slowdown");
  const failedCount = currentFailedResults.length;
  // Only successfully checked sources count as "done" — a failed source still
  // needs a (re)check, so it must not push completion to 100%.
  const successfulCount = Math.max(0, checkedCollectionIds.size - failedCount);
  const uncheckedCount = Math.max(0, (scopedCollections.length || progress.total) - checkedCollectionIds.size);
  const canResume = !isRunning && !optOutMatch && targetUrl.trim() && uncheckedCount > 0 && checkedCollectionIds.size > 0;
  const canStartFresh = !isRunning && targetUrl.trim() && !canResume;
  const hasStartedSearch =
    state !== "idle" ||
    progress.total > 0 ||
    checkedCollectionIds.size > 0 ||
    captures.length > 0 ||
    retryableFailedResults.length > 0;
  const hasCaptures = captures.length > 0;
  const completion = progress.total > 0 ? Math.round((successfulCount / progress.total) * 100) : 0;
  const canRetryFailed = !isRunning && !optOutMatch && retryableFailedResults.length > 0;
  const hasAutoRetryWork = availabilityIssue && (retryableFailedResults.length > 0 || uncheckedCount > 0);
  const canScheduleAutoRetry = !isRunning && !isStoredView && Boolean(targetUrl.trim()) && hasAutoRetryWork;
  const canAutoRetryFailed = autoRetryEnabled && canScheduleAutoRetry;
  const autoRetryCountdown = nextAutoRetryAt ? formatDuration(nextAutoRetryAt - nowMs) : "";
  const showAutoRetryAction = !isRunning && !isStoredView && hasAutoRetryWork;
  const isWaitingForAutoRetry = canAutoRetryFailed && Boolean(nextAutoRetryAt);
  const scanNotice = isRunning || isWaitingForAutoRetry
    ? buildScanNotice({
        failedCount,
        hasExplicitRateLimit,
        hasGatewayTimeout,
        hasSlowDown,
        availabilityIssue,
        isWaitingForAutoRetry
      })
    : "";
  const showOptOutNotice = Boolean(optOutMatch);
  const scanLogCount = scanLog.length + (robotsStatus ? 1 : 0) + (optOutMatch ? 1 : 0);
  const resultsBackContext = useMemo<ResultsBackContext>(
    () => ({
      url: targetUrl.trim(),
      match: matchType,
      mock: initialMockMode ? "1" : null,
      scope: scanScope,
      history: "1",
      year: yearFilter,
      collection: collectionFilter,
      mime: mimeFilter,
      status: statusFilter,
      filter: urlFilter,
      sort: sortBy,
      view: viewMode,
      page: currentPage
    }),
    [
      collectionFilter,
      currentPage,
      initialMockMode,
      matchType,
      mimeFilter,
      scanScope,
      sortBy,
      statusFilter,
      targetUrl,
      urlFilter,
      viewMode,
      yearFilter
    ]
  );
  const statusActions = hasStartedSearch ? (
    <div className="flex shrink-0 flex-wrap justify-end gap-2">
      {canRetryFailed ? (
        <Button
          className="shrink-0 whitespace-nowrap"
          size="sm"
          variant="secondary"
          onClick={() => void runSearch("retry-failed")}
        >
          <RotateCcw size={14} />
          Retry failed
        </Button>
      ) : null}
      {state === "error" && targetUrl.trim() ? (
        <Button
          className="shrink-0 whitespace-nowrap"
          size="sm"
          onClick={() => void runSearch("fresh")}
        >
          <RotateCcw size={14} />
          Try again
        </Button>
      ) : null}
      {canResume ? (
        <Button size="sm" variant="secondary" onClick={() => void runSearch("resume")}>
          <RotateCcw size={14} />
          Continue
        </Button>
      ) : null}
      {showAutoRetryAction ? (
        <Button
          className="shrink-0 whitespace-nowrap"
          size="sm"
          title="Toggle automatic retry for failed and unchecked sources"
          onClick={() => setAutoRetryEnabled((value) => !value)}
        >
          <Clock size={14} />
          {autoRetryEnabled ? `Auto retry ${autoRetryCountdown ? `in ${autoRetryCountdown}` : "on"}` : "Auto retry off"}
        </Button>
      ) : null}
      {isRunning ? (
        <Button variant="danger" size="sm" onClick={() => abortRef.current?.abort()}>
          <Square size={14} />
          Cancel
        </Button>
      ) : null}
    </div>
  ) : null;

  useEffect(() => {
    const urlForTitle = autoStart ? (initialUrl || targetUrl) : "";
    document.title = buildTabTitle(stripUrlForTitle(urlForTitle));
  }, [autoStart, initialUrl, targetUrl]);

  useEffect(() => {
    if (!canScheduleAutoRetry) {
      setNextAutoRetryAt(undefined);
      return;
    }
    if (!canAutoRetryFailed) return;

    const retryAt = nextAutoRetryAt ?? Date.now() + AUTO_RETRY_INTERVAL_MS;
    if (!nextAutoRetryAt) setNextAutoRetryAt(retryAt);
    const timeoutId = window.setTimeout(() => {
      void runSearch("auto-retry");
    }, Math.max(0, retryAt - Date.now()));

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutoRetryFailed, canScheduleAutoRetry, failedResults.length, uncheckedCount, targetUrl, matchType, scanScope, nextAutoRetryAt]);

  useEffect(() => {
    const trimmedUrl = targetUrl.trim();
    if (!trimmedUrl || !hasStartedSearch) return;
    if (!canScheduleAutoRetry && !nextAutoRetryAt) {
      clearAutoRetryState(trimmedUrl, matchType, initialMockMode, persistedScanScope);
      return;
    }
    writeAutoRetryState(trimmedUrl, matchType, initialMockMode, persistedScanScope, {
      enabled: autoRetryEnabled,
      nextRetryAt: nextAutoRetryAt
    });
  }, [
    autoRetryEnabled,
    canScheduleAutoRetry,
    hasStartedSearch,
    initialMockMode,
    matchType,
    nextAutoRetryAt,
    persistedScanScope,
    targetUrl
  ]);

  useEffect(() => {
    if (!nextAutoRetryAt) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    setNowMs(Date.now());
    return () => window.clearInterval(intervalId);
  }, [nextAutoRetryAt]);

  useEffect(() => {
    if (!isRunning || !scanStartedAt) return;
    const updateElapsed = () => setElapsedMs(Date.now() - scanStartedAt);
    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [isRunning, scanStartedAt]);

  useEffect(() => {
    const trimmedUrl = targetUrl.trim();
    if (!trimmedUrl || captures.length === 0) return;
    const key = searchKey(trimmedUrl, matchType, initialMockMode);
    const timer = window.setTimeout(() => {
      void putSearch({
        key,
        url: trimmedUrl,
        matchType,
        mock: initialMockMode,
        captures,
        updatedAt: Date.now()
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [captures, targetUrl, matchType, initialMockMode]);

  useEffect(() => {
    const trimmedUrl = targetUrl.trim();
    if (!trimmedUrl || scanLog.length === 0) return;
    const key = scanSearchKey(trimmedUrl, matchType, initialMockMode, persistedScanScope);
    const legacyKeys = [legacyScanSearchKey(trimmedUrl, matchType, initialMockMode, persistedScanScope)];
    const persistedCollections = collectionsForScope(collections, persistedScanScope);
    const timer = window.setTimeout(() => {
      void putSearch({
        key,
        url: trimmedUrl,
        matchType,
        mock: initialMockMode,
        scanScope: persistedScanScope,
        collections: persistedCollections,
        captures,
        results: scanLog,
        updatedAt: Date.now()
      }).then(() => deleteSearches(legacyKeys));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [captures, collections, initialMockMode, matchType, persistedScanScope, scanLog, targetUrl]);

  useEffect(() => {
    const trimmedUrl = targetUrl.trim();
    if (!activeScanId || !trimmedUrl) return;
    const timer = window.setTimeout(() => {
      void ensureScanSession({
        scanId: activeScanId,
        url: trimmedUrl,
        matchType,
        mock: initialMockMode,
        scope: scanScope,
        year: yearFilter,
        collection: collectionFilter,
        mime: mimeFilter,
        status: statusFilter,
        filter: urlFilter,
        sort: sortBy,
        view: viewMode,
        page: page > 1 ? page : undefined
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    activeScanId,
    collectionFilter,
    initialMockMode,
    matchType,
    mimeFilter,
    page,
    scanScope,
    sortBy,
    statusFilter,
    targetUrl,
    urlFilter,
    viewMode,
    yearFilter
  ]);

  return (
    <main
      className={
        hasStartedSearch
          ? "min-h-screen px-4 py-5 text-zinc-100 md:px-8"
          : "grid min-h-screen place-items-center px-4 py-8 text-zinc-100 md:px-8"
      }
    >
      {hasStartedSearch ? null : <TopRightMenu />}
      <div className={hasStartedSearch ? "mx-auto flex max-w-7xl flex-col gap-4" : "mx-auto w-full max-w-3xl"}>
        <header className={hasStartedSearch ? "archive-panel rounded-md p-4" : "p-0"}>
          <div className={hasStartedSearch ? "flex flex-col gap-4 lg:flex-row lg:items-end" : "flex flex-col gap-4"}>
            <div className="flex-1">
              <div className={hasStartedSearch ? "mb-3 flex items-center gap-3" : "relative mb-8 flex flex-col items-center gap-4 text-center"}>
                {hasStartedSearch ? (
                  <div className="flex items-center gap-2">
                    <Link
                      href="/"
                      aria-label="Start a new search"
                      title="Start a new search"
                      className="rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    >
                      <BrandLockup wordClassName="text-xl leading-none" />
                    </Link>
                    <Link
                      href="/history"
                      aria-label="Open scan history"
                      title="Open scan history"
                      className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700 bg-zinc-950/70 text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    >
                      <HistoryIcon size={20} />
                    </Link>
                    <Link
                      href="/settings"
                      aria-label="Open settings"
                      title="Open settings"
                      className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700 bg-zinc-950/70 text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    >
                      <Settings size={20} />
                    </Link>
                  </div>
                ) : null}
                {hasStartedSearch ? null : (
                  <>
                    <p className="absolute bottom-full left-1/2 mb-16 w-full max-w-xl -translate-x-1/2 text-balance text-2xl font-black leading-tight tracking-tight text-zinc-100 sm:mb-24 sm:text-3xl">
                      Search <span className="text-amber-300">hundreds of billions</span> of
                      archived web pages.
                    </p>
                    <h1>
                      <BrandLockup
                        size="hero"
                        className="justify-center gap-5"
                        wordClassName="leading-none"
                      />
                    </h1>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row" suppressHydrationWarning>
                {hasStartedSearch ? (
                  <div
                    aria-label="Scanned URL"
                    title={targetUrl}
                    className="flex h-11 w-full items-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
                  >
                    <span className="truncate font-mono">{targetUrl}</span>
                  </div>
                ) : (
                  <Input
                    ref={targetUrlInputRef}
                    aria-label="URL to search"
                    disabled={isRunning}
                    value={targetUrl}
                    placeholder="https://example.com/page"
                    autoComplete="off"
                    onChange={(event) => setTargetUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runSearch("fresh", { url: event.currentTarget.value, scope: scanScope });
                    }}
                  />
                )}
                {!hasStartedSearch ? (
                  <Button
                    className="h-11 shrink-0 whitespace-nowrap"
                    disabled={!canStartFresh}
                    onClick={() => void runSearch("fresh", { url: targetUrlInputRef.current?.value, scope: scanScope })}
                  >
                    <Play size={16} />
                    Start scan
                  </Button>
                ) : null}
              </div>
              {!hasStartedSearch ? (
                <AdvancedSettings
                  open={advancedOpen}
                  onToggle={() => setAdvancedOpen((value) => !value)}
                  matchType={matchType}
                  onMatchTypeChange={setMatchType}
                  fullScan={scanScope === "all"}
                  onFullScanChange={(checked) => setScanScope(checked ? "all" : "recent")}
                  disabled={isRunning}
                  earliestArchiveYear={earliestArchiveYear}
                />
              ) : null}
            </div>
            {hasStartedSearch ? (
              <div className="flex h-11 divide-x divide-zinc-800 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/60 lg:w-[360px]">
                <Stat
                  label="Sources"
                  value={`${successfulCount}/${progress.total || collections.length || "?"}`}
                />
                <Stat label="Snapshots" value={String(captures.length)} tone={captures.length === 0 ? "neutral" : "green"} />
                <Stat label="Failed" value={String(failedCount)} tone={failedCount > 0 ? "red" : "neutral"} />
              </div>
            ) : null}
          </div>
          {hasStartedSearch ? (
            <div className="mt-4 h-2 overflow-hidden rounded-sm bg-zinc-900">
              <div
                className="h-full bg-amber-300 transition-all"
                style={{
                  width: `${completion}%`
                }}
              />
            </div>
          ) : null}
          {hasStartedSearch ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-zinc-400">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-left font-semibold uppercase tracking-[0.12em] text-zinc-400 transition hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                onClick={() => setScanLogOpen((current) => !current)}
              >
                <ChevronDown
                  size={14}
                  className={scanLogOpen ? "rotate-180 transition-transform" : "transition-transform"}
                />
                Scan log ({scanLogCount})
              </button>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <p>
                  {completion}% · {formatDuration(elapsedMs)}
                </p>
                {statusActions}
              </div>
            </div>
          ) : null}
          {hasStartedSearch && scanNotice ? (
            <p
              className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-2 text-xs leading-5 text-amber-100"
            >
              {scanNotice}
            </p>
          ) : null}
          {showOptOutNotice ? (
            <p className="mt-3 rounded-md border border-red-300/30 bg-red-300/10 p-2 text-xs leading-5 text-red-100">
              This URL is not expected to be in the Common Crawl dataset because it is on the Common Crawl Foundation{" "}
              <a
                href="https://commoncrawl.org/blog/common-crawl-foundation-opt-out-registry"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-red-50"
              >
                opt-out registry
              </a>
              .
            </p>
          ) : null}
          {showOptOutNotice && optOutCachedScanAt && captures.length > 0 ? (
            <p className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-2 text-xs leading-5 text-amber-100">
              Showing {captures.length} cached snapshot{captures.length === 1 ? "" : "s"} from a scan on{" "}
              {new Date(optOutCachedScanAt).toLocaleString([], {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              })}
              .
            </p>
          ) : null}
          {hasStartedSearch && scanLogOpen ? (
            <ScanLog
              results={scanLog}
              robotsStatus={robotsStatus}
              optOutMatch={optOutMatch}
              optOutCheckedAt={optOutCachedScanAt ?? scanStartedAt}
              optOutCachedCount={captures.length}
            />
          ) : null}
          {error ? (
            <div className="mt-3 flex items-start gap-2 text-sm text-red-200">
              <p className="flex-1">{error}</p>
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 rounded p-1 text-red-200/70 transition hover:bg-red-200/10 hover:text-red-100"
              >
                <X size={14} />
              </button>
            </div>
          ) : null}
        </header>

        {hasCaptures ? (
          <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <aside className="grid h-fit gap-4">
              <section className="archive-panel rounded-md p-4">
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-zinc-200">
                  <Terminal size={16} />
                  Controls
                </div>
                <div className="mt-4 space-y-3">
                  {viewMode !== "calendar" && <SortSelect value={sortBy} onChange={setSortBy} />}
                  <Filter label="Year" value={yearFilter} onChange={setYearFilter} options={filterOptions.years} />
                  <Filter label="Collection" value={collectionFilter} onChange={setCollectionFilter} options={filterOptions.collections} />
                  <Filter label="MIME" value={mimeFilter} onChange={setMimeFilter} options={filterOptions.mimes} />
                  <Filter label="Status" value={statusFilter} onChange={setStatusFilter} options={filterOptions.statuses} />
                  <Input
                    aria-label="Filter by URL"
                    placeholder="Filter URL text"
                    value={urlFilter}
                    onChange={(event) => setUrlFilter(event.target.value)}
                  />
                </div>
              </section>

              <section className="archive-panel rounded-md p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-200">
                  <Download size={14} />
                  Exports
                </div>

                {htmlZipDownload.active ? (
                  <div className="mt-2">
                    <p className="text-xs text-amber-200">
                      Downloading HTML {htmlZipDownload.completed}/{htmlZipDownload.total}
                    </p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-amber-300 transition-all"
                        style={{
                          width: `${
                            htmlZipDownload.total > 0
                              ? Math.round((htmlZipDownload.completed / htmlZipDownload.total) * 100)
                              : 0
                          }%`
                        }}
                      />
                    </div>
                  </div>
                ) : htmlZipDownload.error ? (
                  <p className="mt-2 text-xs text-red-200">{htmlZipDownload.error}</p>
                ) : null}

                <div className="mt-3 grid gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canExport || htmlZipDownload.active || exportColumns.length === 0}
                    onClick={() => downloadCaptureExport(exportCaptures, exportColumns)}
                    className="justify-center"
                  >
                    <FileText size={14} />
                    Export CSV
                  </Button>
                  {htmlZipDownload.active ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={cancelHtmlZipDownload}
                      className="justify-center"
                    >
                      <X size={14} />
                      Cancel HTML Download
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canExport}
                      onClick={() => void downloadHtmlZip(exportCaptures)}
                      className="justify-center"
                    >
                      <FileArchive size={14} />
                      Download HTML ZIP{canExport ? ` (${exportCaptures.length})` : ""}
                    </Button>
                  )}
                </div>

                {!canExport ? (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    {exportScope === "all"
                      ? "No captures to export yet — run a search first."
                      : "No captures in the current filter view — loosen the filters."}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={() => setExportOptionsOpen((open) => !open)}
                  aria-expanded={exportOptionsOpen}
                  className="mt-3 flex w-full items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-zinc-200"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <SlidersHorizontal size={12} />
                    Options
                  </span>
                  <ChevronDown
                    size={14}
                    className={exportOptionsOpen ? "rotate-180 transition" : "transition"}
                  />
                </button>

                {exportOptionsOpen ? (
                  <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
                    <div>
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                        Scope
                      </span>
                      <SegmentedToggle
                        ariaLabel="Export scope"
                        value={exportScope}
                        onChange={setExportScope}
                        options={[
                          { value: "filtered", label: `Filtered (${filteredCaptures.length})` },
                          { value: "all", label: `All (${captures.length})` }
                        ]}
                      />
                    </div>

                    <div>
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                        CSV columns
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {CAPTURE_COLUMNS.map((column) => (
                          <label
                            key={column.key}
                            className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600"
                          >
                            <input
                              type="checkbox"
                              checked={exportColumns.includes(column.key)}
                              onChange={() => toggleExportColumn(column.key)}
                              className="h-3.5 w-3.5 accent-amber-300"
                            />
                            {column.label}
                          </label>
                        ))}
                      </div>
                      {exportColumns.length === 0 ? (
                        <p className="mt-1 text-[10px] text-amber-200">Select at least one column.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            </aside>

            <section className="archive-panel rounded-md">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 p-4">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-[0.18em]">Captures</h2>
                  <p className="text-xs text-zinc-400">
                    Showing {filteredCaptures.length} of {captures.length} HTML captures.
                  </p>
                </div>
                <ViewModeToggle value={viewMode} onChange={setViewMode} />
              </div>
              {filteredCaptures.length === 0 ? (
                <div className="grid min-h-80 place-items-center p-8 text-center">
                  <div>
                    <Ban className="mx-auto mb-3 text-zinc-600" size={28} />
                    <p className="font-semibold text-zinc-300">No captures in the current view.</p>
                    <p className="mt-1 text-sm text-zinc-500">Start a search or loosen the filters.</p>
                  </div>
                </div>
              ) : viewMode === "calendar" ? (
                <CalendarView captures={filteredCaptures} backContext={resultsBackContext} scanId={activeScanId || undefined} />
              ) : (
                <>
                  <CaptureRowHeader sort={sortBy} onSortChange={setSortBy} />
                  <div className="divide-y divide-zinc-800/70">
                    {pagedCaptures.map((capture) => (
                      <CaptureRow
                        key={`${capture.collectionId}:${capture.timestamp}:${capture.filename}:${capture.offset}`}
                        capture={capture}
                        backContext={resultsBackContext}
                        scanId={activeScanId || undefined}
                      />
                    ))}
                  </div>
                  {totalPages > 1 ? (
                    <Pagination
                      page={currentPage}
                      totalPages={totalPages}
                      pageSize={pageSize}
                      totalItems={filteredCaptures.length}
                      onChange={setPage}
                    />
                  ) : null}
                </>
              )}
            </section>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" | "amber" | "red" }) {
  const valueColor =
    tone === "green"
      ? "text-emerald-300"
      : tone === "amber"
      ? "text-amber-300"
      : tone === "red"
      ? "text-red-300"
      : "text-zinc-100";
  return (
    <div className="flex flex-1 items-center justify-between gap-2 px-3 leading-none">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <span className={`font-mono text-sm font-bold tabular-nums ${valueColor}`}>{value}</span>
    </div>
  );
}

function scanLogMessage(result: CollectionCheckResult) {
  const status = result.httpStatus ? `HTTP ${result.httpStatus}` : "No HTTP response";
  const error = result.error ?? "not checked";
  const attempts = result.attempts > 1 ? ` · ${result.attempts} request attempts` : "";
  const runs = result.runs > 1 ? ` across ${result.runs} runs` : "";
  const cacheText = result.fromCache ? " · cache" : "";
  const retryText = attempts || runs ? `${attempts}${runs}` : "";
  const blockedText =
    result.blockedCaptures && result.blockedCaptures.length > 0
      ? ` · ${result.blockedCaptures.length} blocked over viewer limit (${result.blockedCaptures
          .map((blocked) => `${formatBytes(blocked.sizeBytes)} / ${blocked.sizeBytes} bytes`)
          .join(", ")})`
      : "";
  if (result.status === "not-checked") {
    return `${status} · ${error}${retryText}`;
  }
  if (result.captures.length > 0) {
    return `${status}${cacheText} · found ${result.captures.length} HTML capture${result.captures.length === 1 ? "" : "s"}${retryText}${blockedText}`;
  }
  return `${status}${cacheText} · no matching HTML 200 capture${retryText}`;
}

function formatSearchError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("Common Crawl source list") ||
    message.includes("Could not load the Common Crawl source list") ||
    message.includes("Could not reach Common Crawl from this network")
  ) {
    return "Could not reach Common Crawl from this network. Try again or switch networks.";
  }
  if (/NetworkError|Failed to fetch|fetch resource|Load failed/i.test(message)) {
    return "Could not reach Common Crawl from this network. Try again or switch networks.";
  }
  return message || "Search failed";
}

function buildScanNotice({
  failedCount,
  hasExplicitRateLimit,
  hasGatewayTimeout,
  hasSlowDown,
  availabilityIssue,
  isWaitingForAutoRetry
}: {
  failedCount: number;
  hasExplicitRateLimit: boolean;
  hasGatewayTimeout: boolean;
  hasSlowDown: boolean;
  availabilityIssue: boolean;
  isWaitingForAutoRetry?: boolean;
}) {
  if (!availabilityIssue || failedCount === 0) return "";

  const issueText = hasSlowDown
    ? "Common Crawl is busy."
    : hasGatewayTimeout
    ? "Common Crawl is temporarily slow."
    : hasExplicitRateLimit
      ? "Common Crawl is temporarily limiting requests."
      : "Some Common Crawl checks are failing.";

  if (isWaitingForAutoRetry) {
    return `${issueText} The scan is paused to avoid hammering the API. Auto retry will check again automatically.`;
  }

  return hasSlowDown
    ? `${issueText} Some snapshots may still work. Retry failed items later.`
    : `${issueText} The scan is still running. Retry failed items later if needed.`;
}

function robotsStatusHeadline(status: RobotsUiState) {
  if (status.status === "checking") return "Checking current CCBot policy...";
  if (status.status === "blocked") return "Common Crawl is currently blocked for this URL, but earlier crawls may have been allowed.";
  if (status.status === "allowed") return "Common Crawl is currently allowed for this URL, but this may have differed in the past.";
  if (status.status === "no-robots") return "No robots.txt found, so Common Crawl is currently allowed by default.";
  return "Current CCBot policy could not be checked.";
}

function robotsStatusDetail(status: RobotsUiState) {
  if (status.status === "checking") return "";
  if (status.status === "unavailable") {
    return status.error;
  }
  if (status.status === "no-robots") return "";
  if (status.matchedRule) return `${status.matchedRule.directive}: ${status.matchedRule.path}`;
  return "";
}

function robotsStatusTone(status: RobotsUiState) {
  if (status.status === "blocked" || status.status === "unavailable") return "text-red-200";
  if (status.status === "allowed" || status.status === "no-robots") return "text-emerald-200";
  return "text-amber-200";
}

function RobotsScanLogEntry({ status, withDate = false }: { status: RobotsUiState; withDate?: boolean }) {
  const detail = robotsStatusDetail(status);
  return (
    <div className={scanLogRowClass(withDate)}>
      <p className="whitespace-nowrap font-mono text-[11px] text-zinc-500">{formatLogTimestamp(status.checkedAt, withDate)}</p>
      <p className="whitespace-nowrap font-semibold text-zinc-200">CCBot robots.txt</p>
      <p className={robotsStatusTone(status)}>
        {robotsStatusHeadline(status)}
        {detail ? <span className="ml-1 text-zinc-500">({detail})</span> : null}
      </p>
    </div>
  );
}

function OptOutScanLogEntry({
  checkedAt,
  cachedCount,
  withDate = false
}: {
  checkedAt: number | undefined;
  cachedCount: number;
  withDate?: boolean;
}) {
  return (
    <div className={scanLogRowClass(withDate)}>
      <p className="whitespace-nowrap font-mono text-[11px] text-zinc-500">{formatLogTimestamp(checkedAt, withDate)}</p>
      <p className="whitespace-nowrap font-semibold text-zinc-200">Opt-out registry</p>
      <p className="text-red-200">
        {cachedCount > 0
          ? `URL is on the Common Crawl opt-out registry, so it can't be crawled. The ${cachedCount} snapshot${cachedCount === 1 ? "" : "s"} below are from a previous scan.`
          : "Scan aborted — URL is on the Common Crawl opt-out registry."}
      </p>
    </div>
  );
}

function ScanLog({
  results,
  robotsStatus,
  optOutMatch,
  optOutCheckedAt,
  optOutCachedCount = 0
}: {
  results: CollectionCheckResult[];
  robotsStatus?: RobotsUiState | null;
  optOutMatch?: OptOutMatch | null;
  optOutCheckedAt?: number;
  optOutCachedCount?: number;
}) {
  const showDate = scanLogNeedsDate([
    ...results.map((result) => result.checkedAt),
    robotsStatus?.checkedAt,
    optOutMatch ? optOutCheckedAt : undefined
  ]);
  return (
    <section className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/70">
      <div className="max-h-64 overflow-auto thin-scrollbar">
        {results.length === 0 && !robotsStatus && !optOutMatch ? (
          <p className="p-3 text-xs text-zinc-500">No collections checked yet.</p>
        ) : (
          <div className="divide-y divide-zinc-900">
            {robotsStatus ? <RobotsScanLogEntry status={robotsStatus} withDate={showDate} /> : null}
            {optOutMatch ? (
              <OptOutScanLogEntry checkedAt={optOutCheckedAt} cachedCount={optOutCachedCount} withDate={showDate} />
            ) : null}
            {results.map((result, index) => (
              <div key={`${result.collection.id}:${index}`} className={scanLogRowClass(showDate)}>
                <p className="whitespace-nowrap font-mono text-[11px] text-zinc-500">{formatLogTimestamp(result.checkedAt, showDate)}</p>
                <p className="whitespace-nowrap font-semibold text-zinc-200">{result.collection.id}</p>
                <p
                  className={
                    result.status === "not-checked"
                      ? "text-red-200"
                      : result.captures.length > 0
                        ? "text-emerald-200"
                        : "text-zinc-500"
                  }
                >
                  {scanLogMessage(result)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function getPageRange(page: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

function Pagination({
  page,
  totalPages,
  pageSize,
  totalItems,
  onChange
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onChange: (page: number) => void;
}) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  const pages = getPageRange(page, totalPages);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 p-4 text-xs text-zinc-400"
    >
      <p>
        {start}–{end} of {totalItems}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="h-8 rounded-md border border-zinc-700 bg-zinc-950 px-3 font-semibold uppercase tracking-[0.12em] text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200"
        >
          Prev
        </button>
        {pages.map((p, index) =>
          p === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="px-2 text-zinc-600">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? "page" : undefined}
              onClick={() => onChange(p)}
              className={
                p === page
                  ? "h-8 min-w-[2rem] rounded-md border border-amber-300 bg-amber-300 px-2 font-bold text-zinc-950"
                  : "h-8 min-w-[2rem] rounded-md border border-zinc-700 bg-zinc-950 px-2 font-semibold text-zinc-200 transition hover:border-amber-300 hover:text-amber-100"
              }
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="h-8 rounded-md border border-zinc-700 bg-zinc-950 px-3 font-semibold uppercase tracking-[0.12em] text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

function SortSelect({ value, onChange }: { value: SortOption; onChange: (value: SortOption) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Sort by</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SortOption)}
        className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-amber-300"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex w-full items-center overflow-hidden rounded-md border border-zinc-700 bg-zinc-950"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={
              active
                ? "flex h-8 flex-1 items-center justify-center px-2 text-xs font-bold uppercase tracking-[0.1em] text-zinc-950 bg-amber-300"
                : "flex h-8 flex-1 items-center justify-center px-2 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-300 transition hover:text-amber-100"
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-amber-300"
      >
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ViewModeToggle({
  value,
  onChange
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center overflow-hidden rounded-md border border-zinc-700 bg-zinc-950"
    >
      <button
        type="button"
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
        className={
          value === "list"
            ? "inline-flex h-8 items-center gap-1.5 bg-amber-300 px-3 text-xs font-bold uppercase tracking-[0.12em] text-zinc-950"
            : "inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300 transition hover:text-amber-100"
        }
      >
        <List size={14} />
        List
      </button>
      <button
        type="button"
        aria-pressed={value === "calendar"}
        onClick={() => onChange("calendar")}
        className={
          value === "calendar"
            ? "inline-flex h-8 items-center gap-1.5 bg-amber-300 px-3 text-xs font-bold uppercase tracking-[0.12em] text-zinc-950"
            : "inline-flex h-8 items-center gap-1.5 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300 transition hover:text-amber-100"
        }
      >
        <CalendarDays size={14} />
        Calendar
      </button>
    </div>
  );
}

function AdvancedSettings({
  open,
  onToggle,
  matchType,
  onMatchTypeChange,
  fullScan,
  onFullScanChange,
  disabled,
  earliestArchiveYear
}: {
  open: boolean;
  onToggle: () => void;
  matchType: MatchType;
  onMatchTypeChange: (value: MatchType) => void;
  fullScan: boolean;
  onFullScanChange: (checked: boolean) => void;
  disabled: boolean;
  earliestArchiveYear: number;
}) {
  return (
    <div className="mt-3">
      <div className="flex justify-end">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          Advanced search
          <ChevronDown
            size={14}
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
          />
        </button>
      </div>
      {open ? (
        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Mode
                <Tooltip
                  side="top"
                  className="left-0 w-72 translate-x-0 whitespace-normal text-left normal-case tracking-normal"
                  arrowClassName="left-2 translate-x-0"
                  content={
                    <span className="block">
                      <span className="block">
                        <span className="font-semibold text-amber-200">exact URL:</span> only this exact address.
                      </span>
                      <span className="mt-1 block">
                        <span className="font-semibold text-amber-200">host:</span> all paths on this hostname (e.g. <code>example.com/*</code>).
                      </span>
                      <span className="mt-1 block">
                        <span className="font-semibold text-amber-200">domain:</span> all paths on this domain <em>and</em> all subdomains (e.g. <code>*.example.com/*</code>).
                      </span>
                    </span>
                  }
                >
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="What is mode?"
                    className="grid h-4 w-4 place-items-center rounded-full text-zinc-500 transition hover:text-zinc-200 focus:outline-none focus-visible:text-zinc-200"
                  >
                    <Info size={12} />
                  </span>
                </Tooltip>
              </span>
              <select
                aria-label="Match type"
                value={matchType}
                disabled={disabled}
                onChange={(event) => onMatchTypeChange(event.target.value as MatchType)}
                className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm font-semibold text-zinc-100 outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="exact">exact URL</option>
                <option value="host">host (all paths)</option>
                <option value="domain">domain + subdomains</option>
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Scope
                <Tooltip
                  side="top"
                  className="left-0 w-64 translate-x-0 whitespace-normal text-left normal-case tracking-normal"
                  arrowClassName="left-2 translate-x-0"
                  content={
                    <span className="block">
                      <span className="block">
                        <span className="font-semibold text-amber-200">Default:</span> last 12 months only.
                      </span>
                      <span className="mt-1 block">
                        <span className="font-semibold text-amber-200">Full scan:</span> entire archive — takes much longer.
                      </span>
                    </span>
                  }
                >
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="What is scope?"
                    className="grid h-4 w-4 place-items-center rounded-full text-zinc-500 transition hover:text-zinc-200 focus:outline-none focus-visible:text-zinc-200"
                  >
                    <Info size={12} />
                  </span>
                </Tooltip>
              </span>
              <select
                aria-label="Scope"
                value={fullScan ? "full" : "recent"}
                disabled={disabled}
                onChange={(event) => onFullScanChange(event.target.value === "full")}
                className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm font-semibold text-zinc-100 outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="recent">last 12 months</option>
                <option value="full">full scan (entire archive, since {earliestArchiveYear})</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
