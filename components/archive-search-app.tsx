"use client";

import { type CSSProperties, type ReactNode, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Ban,
  CalendarDays,
  ChevronDown,
  Download,
  Clock,
  FileArchive,
  FileText,
  Info,
  List,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Terminal,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_MATCH_TYPE,
  fetchCollections,
  filterCollectionsByDateRange,
  filterCollectionsByRecentMonths,
  isLikelyCommonCrawlAvailabilityIssue,
  isLikelyRateLimitError,
  queryCollection,
  resetCommonCrawlRateLimitState,
  resultCoversWindow,
  searchUrlCoversTarget,
  shouldPersistScanLogEntry,
  subscribeCommonCrawlRateLimitChanges,
  type CollectionAttemptLog,
  type CollectionCheckResult,
  type CommonCrawlRateLimitChange,
  type CommonCrawlCapture,
  type CommonCrawlCollection,
  type MatchType,
  type ResultsBackContext,
  type ScanDateWindow,
  type ScanLogEntry,
  type ScanLogEvent,
  type SearchProgress,
  type SearchStopReason,
  warcRecordUrl
} from "@/lib/common-crawl";
import { captureYear, formatBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateControl } from "@/components/ui/date-control";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { BrandLockup } from "@/components/brand";
import { CaptureRow, CaptureRowHeader, type SortOption } from "@/components/capture-row";
import dynamic from "next/dynamic";
// Code-split components that aren't part of the initial list/search view so they
// stay out of the first-load JS. SSR is kept (default) so landing HTML and SEO
// content still server-render; only the client chunk is deferred.
const CalendarView = dynamic(() => import("@/components/calendar-view").then((mod) => mod.CalendarView));
const HtmlPrivacyWarningDialog = dynamic(() =>
  import("@/components/html-privacy-warning-dialog").then((mod) => mod.HtmlPrivacyWarningDialog)
);
const LandingSections = dynamic(() => import("@/components/landing-sections").then((mod) => mod.LandingSections));
const VirtualizedCaptureList = dynamic(() =>
  import("@/components/virtualized-capture-list").then((mod) => mod.VirtualizedCaptureList)
);
import { TopRightMenu } from "@/components/top-right-menu";
import { createMockSearchDataset, createMockWarcRecord, isMockCaptureFilename } from "@/lib/mock-data";
import { APP_NAME, buildTabTitle, stripUrlForTitle } from "@/lib/app-meta";
import { markPerformance, measurePerformance, measureSync } from "@/lib/performance";
import {
  coverageCaptures,
  coverageDurationMs,
  coverageResults,
  coverageScanLogResults,
  addCoverageDuration,
  appendCoverageScanLogEntry,
  deleteSearches,
  ensureScanSession,
  ensureTarget,
  findOrCreateLegacySession,
  DEFAULT_CAPTURE_EXPORT_COLUMNS,
  DEFAULT_SEARCH_PAGE_SIZE,
  getCoverage,
  getSettings,
  getScanSession,
  getSearch,
  legacyScanSearchKey,
  legacyScanSearchKeys,
  listHistorySummaries,
  putSearch,
  scanSearchKey,
  scanLogDurationMs,
  searchKey,
  startCoverageRun,
  subscribeToSearchChanges,
  targetIdFor,
  updateSettings,
  upsertCoverageResult,
  type AppSettings,
  type CoverageRecord,
  type HistorySummaryRecord,
  type ScanSession,
  type StoredSearch
} from "@/lib/capture-store";
import { dedupeCaptures, mergeCollectionResults, upsertCollectionResult } from "@/lib/scan-results";
import { loadCaptureRecord } from "@/lib/warc";
import { computeCsv, computeZipBytes } from "@/lib/compute-client";
import { rowsToCsv } from "@/lib/csv";
import { robotsUrlForTarget, type RobotsCheckResult } from "@/lib/robots";
import { readCachedRobotsStatus, writeCachedRobotsStatus } from "@/lib/robots-cache";
import { findOptOutMatch, type OptOutMatch } from "@/lib/opt-out-registry";
import { createLegacySearchHref, createSearchHref } from "@/lib/navigation-state";

type ViewMode = "list" | "calendar";
type ScanScope = "recent" | "all" | "custom";
type RunSearchMode = "fresh" | "resume" | "retry-failed" | "auto-retry" | "missing";

type HtmlZipDownloadState = {
  active: boolean;
  completed: number;
  total: number;
  failed?: number;
  part?: number;
  parts?: number;
  bytes?: number;
  error?: string;
};

type BlockedRobotsConfirmation = {
  session: ScanSession;
  mode: RunSearchMode;
  robotsStatus: RobotsCheckResult;
};

type SearchState =
  | "idle"
  | "loading-stored-scan"
  | "loading-collections"
  | "running"
  | "paused"
  | "done"
  | "error";

type RobotsUiState =
  | { status: "checking"; robotsUrl?: string; checkedAt?: number }
  | RobotsCheckResult;

function blockedRobotsApprovalStorageKey(targetId: string) {
  return `crawlback:blocked-robots-approved:${targetId}`;
}

export type ArchiveSearchInitialParams = {
  url?: string;
  match?: string;
  scope?: string;
  from?: string;
  to?: string;
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
  saved?: string;
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
const RESTORABLE_ACTIVE_SCAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

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

type NormalizedSearchUrl =
  | { ok: true; url: string; addedScheme: boolean }
  | { ok: false; error: string };

function normalizeSearchUrlInput(value: string): NormalizedSearchUrl {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a URL to scan." };
  }

  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  const candidate = hasExplicitScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      error: "Enter a valid URL, such as example.com/page or https://example.com/page."
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs can be scanned." };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "Enter a URL with a hostname." };
  }

  parsed.hash = "";
  return { ok: true, url: parsed.toString(), addedScheme: !hasExplicitScheme };
}

function normalizeSearchUrlOrFallback(value: string, fallback = "https://example.org/") {
  const normalized = normalizeSearchUrlInput(value);
  return normalized.ok ? normalized.url : fallback;
}

type SearchParamReader = {
  get(name: string): string | null;
};

function searchParamsToInitialParams(params?: SearchParamReader | null): ArchiveSearchInitialParams {
  return {
    url: params?.get("url") ?? undefined,
    match: params?.get("match") ?? undefined,
    scope: params?.get("scope") ?? undefined,
    from: params?.get("from") ?? undefined,
    to: params?.get("to") ?? undefined,
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
    scan: params?.get("scan") ?? undefined,
    saved: params?.get("saved") ?? undefined
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
  if (value === "all" || value === "custom") return value;
  return "recent";
}

function normalizeDateInput(value: string | null | undefined): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value ?? "" : "";
}

function hasValidCustomDateRange(dateFrom: string, dateTo: string) {
  return Boolean(dateFrom && dateTo && dateFrom <= dateTo);
}

function customDateRangeIssue(dateFrom: string, dateTo: string) {
  if (!dateFrom && !dateTo) return "Choose a start and end date.";
  if (!dateFrom) return "Choose a start date.";
  if (!dateTo) return "Choose an end date.";
  if (dateFrom > dateTo) return "The start date must be on or before the end date.";
  return null;
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

function buildMockSearchHref(url: string, matchType: MatchType, dateFrom?: string, dateTo?: string) {
  const scope = hasValidCustomDateRange(dateFrom ?? "", dateTo ?? "") ? "custom" : "recent";
  return createLegacySearchHref({ url, matchType, mock: true, scope, dateFrom, dateTo });
}

function removeResult(results: CollectionCheckResult[], collectionId: string) {
  return results.filter((result) => result.collection.id !== collectionId);
}

function collectionsForScope(
  collections: CommonCrawlCollection[],
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
) {
  if (scope === "all") return collections;
  if (scope === "custom" && hasValidCustomDateRange(dateFrom ?? "", dateTo ?? "")) {
    return filterCollectionsByDateRange(collections, dateFrom ?? "", dateTo ?? "");
  }
  return filterCollectionsByRecentMonths(collections);
}

function collectionsByIds(collections: CommonCrawlCollection[], ids?: string[]) {
  if (!ids?.length) return collections;
  const idSet = new Set(ids);
  return collections.filter((collection) => idSet.has(collection.id));
}

function collectionsForSession(
  collections: CommonCrawlCollection[],
  session: Pick<ScanSession, "scope" | "dateFrom" | "dateTo" | "collectionIds">,
  options: { includeNew?: boolean } = {}
) {
  const scoped = collectionsForScope(collections, session.scope, session.dateFrom, session.dateTo);
  if (options.includeNew || !session.collectionIds?.length) return scoped;
  return collectionsByIds(scoped, session.collectionIds);
}

function scanWindowForCollections(
  scope: ScanScope,
  collections: CommonCrawlCollection[],
  dateFrom?: string,
  dateTo?: string
) {
  if (scope === "custom") {
    return { scanWindowFrom: dateFrom, scanWindowTo: dateTo };
  }
  const starts = collections.map((collection) => collection.from).filter(Boolean).sort();
  const ends = collections.map((collection) => collection.to || collection.from).filter(Boolean).sort();
  return {
    scanWindowFrom: starts[0],
    scanWindowTo: ends[ends.length - 1]
  };
}

function scanCollectionMetadata(
  scope: ScanScope,
  collections: CommonCrawlCollection[],
  dateFrom?: string,
  dateTo?: string
) {
  return {
    collectionIds: collections.map((collection) => collection.id),
    collectionListFetchedAt: Date.now(),
    ...scanWindowForCollections(scope, collections, dateFrom, dateTo)
  };
}

function captureDateKey(timestamp: string) {
  if (!/^\d{8,}$/.test(timestamp)) return "";
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

function filterCapturesByDateRange(captures: CommonCrawlCapture[], dateFrom?: string, dateTo?: string) {
  if (!hasValidCustomDateRange(dateFrom ?? "", dateTo ?? "")) return captures;
  return captures.filter((capture) => {
    const day = captureDateKey(capture.timestamp);
    return Boolean(day) && day >= dateFrom! && day <= dateTo!;
  });
}

function filterResultForDateRange(
  result: CollectionCheckResult,
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
): CollectionCheckResult {
  if (scope !== "custom") return result;
  return {
    ...result,
    captures: filterCapturesByDateRange(result.captures, dateFrom, dateTo),
    blockedCaptures: result.blockedCaptures?.filter(({ capture }) => {
      const day = captureDateKey(capture.timestamp);
      return Boolean(day) && day >= (dateFrom ?? "") && day <= (dateTo ?? "");
    })
  };
}

function filterResultsForScope(
  results: CollectionCheckResult[],
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
) {
  return results.map((result) => filterResultForDateRange(result, scope, dateFrom, dateTo));
}

function capturesFromResults(results: CollectionCheckResult[]) {
  return dedupeCaptures(results.flatMap((result) => result.captures));
}

function resultFromAttemptLog(collection: CommonCrawlCollection, attemptLog: CollectionAttemptLog): CollectionCheckResult {
  return {
    collection,
    status: attemptLog.status,
    captures: [],
    checkedAt: attemptLog.checkedAt,
    httpStatus: attemptLog.httpStatus,
    error: attemptLog.error,
    errorKind: attemptLog.errorKind,
    attempts: 1,
    runs: 1,
    attemptLogs: [attemptLog]
  };
}

function attemptLabel(index: number) {
  return `Attempt ${index + 1}`;
}

function isCollectionScanLogEntry(entry: ScanLogEntry): entry is CollectionCheckResult {
  return !("kind" in entry);
}

function scanLogEvent(event: ScanLogEvent["event"], message: string, tone: ScanLogEvent["tone"] = "neutral"): ScanLogEvent {
  return {
    kind: "event",
    event,
    checkedAt: Date.now(),
    message,
    tone
  };
}

function hasStoredCoverageHistory(coverage: Awaited<ReturnType<typeof getCoverage>> | undefined) {
  return Boolean(
    coverage &&
    (
      coverage.scanLogResults?.length ||
      Object.keys(coverage.collectionResults ?? {}).length > 0
    )
  );
}

function coverageHasPendingSessionWork(
  coverage: CoverageRecord | undefined,
  session: Pick<ScanSession, "scope" | "dateFrom" | "dateTo" | "collectionIds">,
  collections: CommonCrawlCollection[]
) {
  if (!coverage) return false;
  const activeCollections = collectionsForSession(collections, session);
  if (activeCollections.length === 0) return false;
  const requestedWindow: ScanDateWindow | undefined =
    session.scope === "custom" && hasValidCustomDateRange(session.dateFrom ?? "", session.dateTo ?? "")
      ? { from: session.dateFrom!, to: session.dateTo! }
      : undefined;

  return activeCollections.some((collection) => {
    const result = coverage.collectionResults[collection.id];
    return !result || result.status !== "checked" || !resultCoversWindow(result.window, requestedWindow);
  });
}

function scanStartEventForMode(mode: RunSearchMode) {
  if (mode === "retry-failed") {
    return scanLogEvent("scan-restarted", "Scan restarted manually.", "amber");
  }
  if (mode === "resume") {
    return scanLogEvent("scan-restarted", "Scan restarted manually.", "amber");
  }
  if (mode === "missing") {
    return scanLogEvent("scan-restarted", "Checking additional archive sources.", "amber");
  }
  if (mode === "auto-retry") {
    return scanLogEvent("scan-restarted", "Scan restarted.", "amber");
  }
  return scanLogEvent("scan-started", "Scan started.");
}

function shouldResetPaceForMode(mode: RunSearchMode) {
  return mode !== "auto-retry";
}

function scanCompletionEvent(input: { checked: number; failed: number; captures: number }) {
  return scanLogEvent(
    "scan-completed",
    `Scan completed · ${input.checked} checked · ${input.failed} failed · ${input.captures} capture${input.captures === 1 ? "" : "s"}.`
  );
}

function scanIncompleteEvent(input: { checked: number; failed: number; captures: number }) {
  return scanLogEvent(
    "scan-paused",
    `Scan paused · ${input.checked} checked · ${input.failed} failed · ${input.captures} capture${input.captures === 1 ? "" : "s"}.`,
    "amber"
  );
}

function formatPaceInterval(ms: number) {
  if (ms < 1_000) return `${ms / 1_000} sec`;
  const seconds = ms / 1_000;
  return Number.isInteger(seconds) ? `${seconds} sec` : `${seconds.toFixed(1)} sec`;
}

function paceChangeEvent(change: CommonCrawlRateLimitChange) {
  const label = `${change.pace} · ${formatPaceInterval(change.intervalMs)}`;
  if (change.reason === "recovered") {
    return scanLogEvent("pace-changed", `Pace restored: ${label} after 10 clean collections.`);
  }
  const reason =
    change.reason === "http_429"
      ? "HTTP 429"
      : change.reason === "http_502"
        ? "repeated HTTP 502"
        : change.reason === "http_503"
          ? "HTTP 503"
          : change.reason === "network_error"
            ? "network failures"
            : "SlowDown";
  return scanLogEvent("pace-changed", `Pace slowed: ${label} after ${reason}.`, "amber");
}

function storedCoverageLoadedEvent(input: { checked: number; total: number; failed: number; captures: number }) {
  return scanLogEvent(
    "stored-coverage-loaded",
    `Loaded stored progress · ${input.checked}/${input.total} sources · ${input.captures} snapshot${input.captures === 1 ? "" : "s"} · ${input.failed} failed.`
  );
}

function filterScanLogForCollections(entries: ScanLogEntry[], activeCollections: CommonCrawlCollection[]) {
  const activeIds = new Set(activeCollections.map((collection) => collection.id));
  return entries.filter((entry) => !isCollectionScanLogEntry(entry) || activeIds.has(entry.collection.id));
}

export function mergePersistedScanLog(
  storedEntries: ScanLogEntry[],
  currentEntries: ScanLogEntry[],
  activeCollections: CommonCrawlCollection[]
) {
  return mergeScanLogSnapshot(
    filterScanLogForCollections(storedEntries, activeCollections),
    currentEntries.filter(shouldPersistScanLogEntry)
  );
}

function isDeduplicatedScanLogEvent(entry: ScanLogEntry) {
  return !isCollectionScanLogEntry(entry) && (
    entry.event === "opt-out-checked" ||
    entry.event === "scope-selected" ||
    entry.event === "stored-coverage-loaded"
  );
}

function scanLogEntryKey(entry: ScanLogEntry) {
  if (!isCollectionScanLogEntry(entry)) {
    if (isDeduplicatedScanLogEvent(entry)) {
      return `event:${entry.event}:${entry.message}`;
    }
    return `event:${entry.event}:${entry.checkedAt ?? ""}:${entry.message}`;
  }
  return `collection:${entry.collection.id}:${entry.checkedAt ?? ""}:${entry.status}:${entry.errorKind ?? ""}:${entry.httpStatus ?? ""}`;
}

function mergeScanLogSnapshot(snapshot: ScanLogEntry[], current: ScanLogEntry[]) {
  const keys = new Set(snapshot.map(scanLogEntryKey));
  return [...snapshot, ...current.filter((entry) => !keys.has(scanLogEntryKey(entry)))];
}

function hasScanLogEntry(entries: ScanLogEntry[], candidate: ScanLogEntry) {
  const candidateKey = scanLogEntryKey(candidate);
  return entries.some((entry) => scanLogEntryKey(entry) === candidateKey);
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

function validStoredScanLogResults(record: StoredSearch, collections: CommonCrawlCollection[]) {
  const entries = record.scanLogResults ?? record.results ?? [];
  const validIds = new Set(collections.map((collection) => collection.id));
  return entries.filter((entry) =>
    shouldPersistScanLogEntry(entry) &&
    (!isCollectionScanLogEntry(entry) || validIds.has(entry.collection.id))
  );
}

function resultCollectionIds(results: CollectionCheckResult[], status?: CollectionCheckResult["status"]) {
  return new Set(
    results
      .filter((result) => (status ? result.status === status : true))
      .map((result) => result.collection.id)
  );
}

function successfulResultCount(results: CollectionCheckResult[]) {
  return resultCollectionIds(results, "checked").size;
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

const DEFAULT_EXPORT_COLUMNS = DEFAULT_CAPTURE_EXPORT_COLUMNS as CaptureColumnKey[];

function selectedExportColumns(columnKeys: CaptureColumnKey[]) {
  // Preserve the canonical column order regardless of selection order.
  return CAPTURE_COLUMNS.filter((column) => columnKeys.includes(column.key));
}

async function buildCaptureExport(
  captures: CommonCrawlCapture[],
  columnKeys: CaptureColumnKey[]
): Promise<{ blob: Blob; filename: string }> {
  const columns = selectedExportColumns(columnKeys);
  const date = new Date().toISOString().slice(0, 10);

  const rows = [
    columns.map((column) => column.label),
    ...captures.map((capture) => columns.map((column) => column.value(capture)))
  ];
  const csv = await computeCsv(rows);
  return {
    blob: new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    filename: `common-crawl-results-${date}.csv`
  };
}

async function downloadCaptureExport(captures: CommonCrawlCapture[], columnKeys: CaptureColumnKey[]) {
  const { blob, filename } = await buildCaptureExport(captures, columnKeys);
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
const HTML_ZIP_MANIFEST_FILENAME = "0001_MANIFEST.csv";
const HTML_ZIP_FAILED_FILENAME = "0002_FAILED.txt";
const HTML_ZIP_WARN_CAPTURE_COUNT = 100;
const HTML_ZIP_BATCH_CAPTURE_LIMIT = 500;
const HTML_ZIP_BATCH_BYTES = 250 * 1024 * 1024;
const HTML_ZIP_WARN_ESTIMATED_BYTES = 250 * 1024 * 1024;
const HTML_ZIP_HARD_CAPTURE_LIMIT = 50_000;
const HTML_ZIP_HARD_ESTIMATED_BYTES = 10 * 1024 * 1024 * 1024;
const HTML_ZIP_DOWNLOAD_PAUSE_MS = 350;

type HtmlZipPartEntry = { filename: string; content: string };
type HtmlZipSuccess = {
  filename: string;
  capture: CommonCrawlCapture;
  source: "cache" | "network" | "mock";
  sizeBytes: number;
};
type HtmlZipFailure = {
  filename: string;
  capture: CommonCrawlCapture;
  error: string;
};

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

function captureLengthBytes(capture: Pick<CommonCrawlCapture, "length">): number {
  const length = Number(capture.length);
  return Number.isFinite(length) && length > 0 ? length : 0;
}

function byteSize(value: string): number {
  return new Blob([value]).size;
}

function waitForBrowserDownload(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function htmlZipPlan(captures: CommonCrawlCapture[]) {
  const estimatedBytes = captures.reduce((sum, capture) => sum + captureLengthBytes(capture), 0);
  const estimatedParts = Math.max(
    1,
    Math.ceil(captures.length / HTML_ZIP_BATCH_CAPTURE_LIMIT),
    estimatedBytes > 0 ? Math.ceil(estimatedBytes / HTML_ZIP_BATCH_BYTES) : 1
  );
  return {
    estimatedBytes,
    estimatedParts,
    tooLarge:
      captures.length > HTML_ZIP_HARD_CAPTURE_LIMIT ||
      estimatedBytes > HTML_ZIP_HARD_ESTIMATED_BYTES,
    needsConfirmation:
      captures.length >= HTML_ZIP_WARN_CAPTURE_COUNT ||
      estimatedBytes >= HTML_ZIP_WARN_ESTIMATED_BYTES ||
      estimatedParts > 1
  };
}

function htmlZipConfirmationMessage(captures: CommonCrawlCapture[], estimatedBytes: number, estimatedParts: number) {
  return [
    `Download ${captures.length} raw HTML capture${captures.length === 1 ? "" : "s"} as ZIP?`,
    "",
    `Estimated compressed WARC input: ${formatBytes(estimatedBytes)}.`,
    `The export may be split into about ${estimatedParts} ZIP file${estimatedParts === 1 ? "" : "s"}.`,
    "",
    "Crawlback will read existing cached HTML, but newly fetched captures will not be added to the local HTML cache during this bulk export."
  ].join("\n");
}

function htmlZipManifestContent(successes: HtmlZipSuccess[], failures: HtmlZipFailure[]): string {
  const rows = [
    ["filename", "url", "timestamp", "collection", "status", "source", "html_bytes", "error"],
    ...successes.map((entry) => [
      entry.filename,
      entry.capture.url,
      entry.capture.timestamp,
      entry.capture.collectionId,
      "exported",
      entry.source,
      String(entry.sizeBytes),
      ""
    ]),
    ...failures.map((entry) => [
      entry.filename,
      entry.capture.url,
      entry.capture.timestamp,
      entry.capture.collectionId,
      "failed",
      "",
      "",
      entry.error
    ])
  ];
  return rowsToCsv(rows);
}

function htmlZipFailedContent(failures: HtmlZipFailure[]): string {
  if (failures.length === 0) return "";
  return [
    `Failed HTML captures: ${failures.length}`,
    "",
    ...failures.map((entry) => [
      entry.filename,
      entry.capture.url,
      `${entry.capture.collectionId} ${entry.capture.timestamp}`,
      entry.error,
      ""
    ].join("\n"))
  ].join("\n");
}

function htmlZipFilename(part: number, parts: number) {
  const date = new Date().toISOString().slice(0, 10);
  if (parts <= 1) return `common-crawl-html-${date}.zip`;
  return `common-crawl-html-${date}-part-${String(part).padStart(2, "0")}.zip`;
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
  if (scope === "custom") return ["custom", "all", "recent"];
  return scope === "all" ? ["recent", "all"] : ["all", "recent"];
}

async function getStoredScanVariants(
  url: string,
  matchType: MatchType,
  mock: boolean,
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
) {
  const keys = new Set([
    ...scanScopesForStoredMerge(scope).map((candidateScope) =>
      scanSearchKey(url, matchType, mock, candidateScope, candidateScope === "custom" ? { dateFrom, dateTo } : undefined)
    ),
    ...legacyScanSearchKeys(url, matchType, mock)
  ]);
  const [keyedRecords, broaderRecords] = await Promise.all([
    Promise.all(Array.from(keys).map((key) => getSearch(key))),
    getBroaderStoredScanRecords(url, matchType, mock, scope, dateFrom, dateTo)
  ]);
  return uniqueStoredSearches([
    ...keyedRecords.filter((record): record is StoredSearch => Boolean(record)),
    ...broaderRecords
  ]).map((record) => filterStoredSearchForRequest(record, url, matchType, scope, dateFrom, dateTo));
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
  ]).map((record) => filterStoredSearchForRequest(record, url, matchType, "recent"));
}

async function getBroaderStoredScanRecords(
  url: string,
  matchType: MatchType,
  mock: boolean,
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
) {
  const summaries = await listHistorySummaries();
  const targetScopeRank = scopeCoverageRank(scope);
  const matchingSummaries = summaries.filter((record) => {
    if (record.mock !== mock) return false;
    if (record.scanScope !== "recent" && record.scanScope !== "all" && record.scanScope !== "custom") return false;
    if (scopeCoverageRank(record.scanScope) < targetScopeRank) return false;
    if (scope === "custom" && record.scanScope === "custom" && (record.dateFrom !== dateFrom || record.dateTo !== dateTo)) {
      return false;
    }
    return searchUrlCoversTarget(record.url, record.matchType, url, matchType);
  });
  const keys = new Set(matchingSummaries.flatMap(storedSearchKeysForSummary));
  const records = await Promise.all(Array.from(keys).map((key) => getSearch(key)));
  return records.filter((record): record is StoredSearch => Boolean(record));
}

function storedSearchKeysForSummary(record: HistorySummaryRecord) {
  return record.storageKeys?.length ? record.storageKeys : [record.key];
}

function uniqueStoredSearches(records: StoredSearch[]) {
  const byKey = new Map<string, StoredSearch>();
  for (const record of records) byKey.set(record.key, record);
  return Array.from(byKey.values());
}

function filterStoredSearchForRequest(
  record: StoredSearch,
  url: string,
  matchType: MatchType,
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
): StoredSearch {
  const filterCapture = (capture: CommonCrawlCapture) => captureMatchesRequest(capture.url, url, matchType);
  return {
    ...record,
    captures: filterCapturesByDateRange(record.captures.filter(filterCapture), dateFrom, dateTo),
    results: record.results?.map((result) => ({
      ...filterResultForDateRange(result, scope, dateFrom, dateTo),
      captures: filterCapturesByDateRange(result.captures.filter(filterCapture), dateFrom, dateTo),
      blockedCaptures: result.blockedCaptures?.filter((blocked) => filterCapture(blocked.capture))
    })),
    scanLogResults: record.scanLogResults?.map((entry) => isCollectionScanLogEntry(entry)
      ? filterResultForDateRange({
          ...entry,
          captures: entry.captures.filter(filterCapture),
          blockedCaptures: entry.blockedCaptures?.filter((blocked) => filterCapture(blocked.capture))
        }, scope, dateFrom, dateTo)
      : entry
    ).filter(shouldPersistScanLogEntry)
  };
}

function captureMatchesRequest(captureUrl: string, targetUrl: string, matchType: MatchType) {
  return searchUrlCoversTarget(targetUrl, matchType, captureUrl, "exact");
}

function scopeCoverageRank(scope: ScanScope) {
  if (scope === "custom") return 0;
  return scope === "all" ? 1 : 0;
}

type AutoRetryState = {
  enabled: boolean;
  nextRetryAt?: number;
};

function autoRetryStateKey(
  url: string,
  matchType: MatchType,
  mock: boolean,
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
) {
  return `${scanSearchKey(url, matchType, mock, scope, { dateFrom, dateTo })}:auto-retry`;
}

function readAutoRetryState(
  url: string,
  matchType: MatchType,
  mock: boolean,
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
): AutoRetryState | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const value = window.localStorage.getItem(autoRetryStateKey(url, matchType, mock, scope, dateFrom, dateTo));
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
  dateFrom: string | undefined,
  dateTo: string | undefined,
  state: AutoRetryState
) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(autoRetryStateKey(url, matchType, mock, scope, dateFrom, dateTo), JSON.stringify(state));
  } catch {
    // Auto-retry persistence is best-effort.
  }
}

function clearAutoRetryState(
  url: string,
  matchType: MatchType,
  mock: boolean,
  scope: ScanScope,
  dateFrom?: string,
  dateTo?: string
) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(autoRetryStateKey(url, matchType, mock, scope, dateFrom, dateTo));
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

export function persistedSearchDurationMs({
  isRunning,
  activeDurationMs,
  storedDurationMs,
  coverage,
  persistedScanLog
}: {
  isRunning: boolean;
  activeDurationMs: number;
  storedDurationMs: number;
  coverage: CoverageRecord | undefined;
  persistedScanLog: ScanLogEntry[];
}) {
  const storedCoverageDuration = coverage?.durationMs ?? 0;
  if (isRunning) {
    return Math.max(Math.round(storedDurationMs), storedCoverageDuration);
  }
  const coverageDuration = coverage?.activeScanStartedAt ? storedCoverageDuration : coverageDurationMs(coverage);
  return Math.max(Math.round(activeDurationMs), coverageDuration, scanLogDurationMs(persistedScanLog));
}

export function restoredCoverageDurationMs(
  coverage: CoverageRecord | undefined,
  scanLog: ScanLogEntry[] = coverageScanLogResults(coverage),
  now = Date.now()
) {
  const storedDuration = coverage?.durationMs ?? 0;
  const logDuration = scanLogDurationMs(scanLog);
  if (hasRestorableActiveScan(coverage, scanLog, now)) {
    return Math.max(coverageDurationMs(coverage, now), logDuration);
  }
  if (!coverage?.activeScanStartedAt) return Math.max(coverageDurationMs(coverage), logDuration);
  return Math.max(storedDuration, logDuration);
}

function hasRestorableActiveScan(
  coverage: CoverageRecord | undefined,
  scanLog: ScanLogEntry[] = coverageScanLogResults(coverage),
  now = Date.now()
) {
  const activeStartedAt = coverage?.activeScanStartedAt;
  if (typeof activeStartedAt !== "number" || !Number.isFinite(activeStartedAt)) return false;
  if (activeStartedAt <= 0 || now < activeStartedAt) return false;
  if (now - activeStartedAt > RESTORABLE_ACTIVE_SCAN_MAX_AGE_MS) return false;
  return !scanLog.some((entry) =>
    "kind" in entry &&
    (entry.event === "scan-completed" || entry.event === "scan-paused" || entry.event === "scan-failed") &&
    typeof entry.checkedAt === "number" &&
    entry.checkedAt >= activeStartedAt
  );
}

function formatSecondsAbbrev(ms: number) {
  return `${formatDuration(ms)} sec`;
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

function LandingStatsFooter() {
  return (
    <div
      className="reveal-fade pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 pt-7 text-sm tracking-wide text-zinc-300"
      style={{ animationDelay: "560ms" }}
    >
      <span>Find archived versions of web pages.</span>
    </div>
  );
}

function LandingAtmosphere() {
  return (
    <div className="landing-atmosphere" aria-hidden>
      <div className="landing-scanlines" />
      <div className="landing-grain" />
      <div className="landing-vignette" />
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
  const initialDateFrom = normalizeDateInput(routeParams.from);
  const initialDateTo = normalizeDateInput(routeParams.to);
  const initialScanScope = normalizeInitialScanScope(
    routeParams.scope ?? (initialDateFrom || initialDateTo ? "custom" : null)
  );
  const initialHistoryMode = routeParams.history === "1";
  const initialAction = routeParams.action;
  const initialMockMode = routeParams.mock === "1";
  const initialViewMode = normalizeInitialViewMode(routeParams.view ?? null);
  const initialSortBy = normalizeInitialSort(routeParams.sort ?? null);
  const initialPage = normalizeInitialPage(routeParams.page ?? null);
  const initialScanId = routeParams.scan;
  const initialSavedKey = routeParams.saved;
  const startsFromSearchRoute = autoStart;
  const startsFromStoredRoute = startsFromSearchRoute && (initialHistoryMode || Boolean(initialScanId) || Boolean(initialSavedKey));
  const [targetUrl, setTargetUrl] = useState(initialUrl);
  const [matchType, setMatchType] = useState<MatchType>(initialMatchType ?? DEFAULT_MATCH_TYPE);
  const [collections, setCollections] = useState<CommonCrawlCollection[]>([]);
  const [captures, setCaptures] = useState<CommonCrawlCapture[]>([]);
  const [failedResults, setFailedResults] = useState<CollectionCheckResult[]>([]);
  const [liveFailedResults, setLiveFailedResults] = useState<CollectionCheckResult[]>([]);
  const [progress, setProgress] = useState<SearchProgress>({
    checked: 0,
    total: 0,
    hits: 0,
    failed: 0,
    activeCollections: []
  });
  const [state, setState] = useState<SearchState>(
    startsFromStoredRoute ? "loading-stored-scan" : startsFromSearchRoute ? "loading-collections" : "idle"
  );
  const [error, setError] = useState("");
  const [yearFilter, setYearFilter] = useState(routeParams.year ?? "all");
  const [collectionFilter, setCollectionFilter] = useState(routeParams.collection ?? "all");
  const [mimeFilter, setMimeFilter] = useState(routeParams.mime ?? "all");
  const [statusFilter, setStatusFilter] = useState(routeParams.status ?? "all");
  const [urlFilter, setUrlFilter] = useState(routeParams.filter ?? "");
  // Feed the heavy filter/sort a low-priority, deferred copy of the text query so
  // the input stays responsive while React re-filters large capture sets in the
  // background (React 19 concurrent feature, no dependency).
  const deferredUrlFilter = useDeferredValue(urlFilter);
  const [sortBy, setSortBy] = useState<SortOption>(initialSortBy);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [scanScope, setScanScope] = useState<ScanScope>(initialScanScope);
  const [customDateFrom, setCustomDateFrom] = useState(initialDateFrom);
  const [customDateTo, setCustomDateTo] = useState(initialDateTo);
  const [page, setPage] = useState(initialPage);
  const [checkedCollectionIds, setCheckedCollectionIds] = useState<Set<string>>(new Set());
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([]);
  const [scanLogOpen, setScanLogOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [scanStartedAt, setScanStartedAt] = useState<number | undefined>();
  const [activeScanId, setActiveScanId] = useState(initialScanId ?? "");
  const [persistedScanScope, setPersistedScanScope] = useState<ScanScope>(initialScanScope);
  const [activeCollectionIds, setActiveCollectionIds] = useState<string[] | undefined>();
  const [storedDurationMs, setStoredDurationMs] = useState(0);
  const [isPersistedScanRunning, setIsPersistedScanRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(true);
  const [nextAutoRetryAt, setNextAutoRetryAt] = useState<number | undefined>();
  // True when the displayed results were loaded from storage (history) rather
  // than scanned live this session. A stored view is static: no auto-retry
  // countdown, no "paused/slow" notice, and no automatic API requests.
  const [isStoredView, setIsStoredView] = useState(false);
  const [robotsStatus, setRobotsStatus] = useState<RobotsUiState | null>(null);
  const [blockedRobotsConfirmation, setBlockedRobotsConfirmation] = useState<BlockedRobotsConfirmation | null>(null);
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
  const [htmlZipWarningOpen, setHtmlZipWarningOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [showHtmlPrivacyWarning, setShowHtmlPrivacyWarning] = useState(true);
  const [exportScope, setExportScope] = useState<ExportScope>("filtered");
  const [exportColumns, setExportColumns] = useState<CaptureColumnKey[]>(DEFAULT_EXPORT_COLUMNS);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const robotsAbortRef = useRef<AbortController | null>(null);
  const htmlZipAbortRef = useRef<AbortController | null>(null);
  const autoStartedSignatureRef = useRef<string | null>(null);
  const blockedRobotsApprovedScanIdsRef = useRef<Set<string>>(new Set());
  const filterResetMountedRef = useRef(false);
  const targetUrlInputRef = useRef<HTMLInputElement | null>(null);
  const loggedAutoRetryAtRef = useRef<number | undefined>(undefined);
  const scanLogRef = useRef<ScanLogEntry[]>([]);
  const autoStartSignature = [
    initialMockMode ? "mock" : "live",
    initialUrl,
    initialMatchType ?? DEFAULT_MATCH_TYPE,
    initialScanScope,
    initialDateFrom,
    initialDateTo,
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

  const hasBlockedRobotsApproval = useCallback((session: Pick<ScanSession, "scanId" | "targetId">) => {
    if (session.scanId && blockedRobotsApprovedScanIdsRef.current.has(session.scanId)) return true;
    if (!session.targetId || typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(blockedRobotsApprovalStorageKey(session.targetId)) === "1";
    } catch {
      return false;
    }
  }, []);

  const rememberBlockedRobotsApproval = useCallback((session: Pick<ScanSession, "scanId" | "targetId">) => {
    if (session.scanId) blockedRobotsApprovedScanIdsRef.current.add(session.scanId);
    if (!session.targetId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(blockedRobotsApprovalStorageKey(session.targetId), "1");
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  const applyRouteResultParams = useCallback(() => {
    setYearFilter(routeParams.year ?? "all");
    setCollectionFilter(routeParams.collection ?? "all");
    setMimeFilter(routeParams.mime ?? "all");
    setStatusFilter(routeParams.status ?? "all");
    setUrlFilter(routeParams.filter ?? "");
    setSortBy(normalizeInitialSort(routeParams.sort ?? null));
    setViewMode(normalizeInitialViewMode(routeParams.view ?? null));
    setCustomDateFrom(normalizeDateInput(routeParams.from));
    setCustomDateTo(normalizeDateInput(routeParams.to));
    setPage(normalizeInitialPage(routeParams.page ?? null));
  }, [
    routeParams.collection,
    routeParams.filter,
    routeParams.from,
    routeParams.mime,
    routeParams.page,
    routeParams.sort,
    routeParams.status,
    routeParams.to,
    routeParams.view,
    routeParams.year
  ]);

  useEffect(() => {
    markPerformance("page-hydrated:search");
    void getSettings()
      .then((settings) => {
        setAppSettings(settings);
        setShowHtmlPrivacyWarning(settings.showHtmlPrivacyWarning);
      })
      .catch(() => setShowHtmlPrivacyWarning(true));
    const unsubscribe = subscribeToSearchChanges(() => {
      void getSettings()
        .then((settings) => {
          setAppSettings(settings);
          setShowHtmlPrivacyWarning(settings.showHtmlPrivacyWarning);
        })
        .catch(() => setShowHtmlPrivacyWarning(true));
    });
    return unsubscribe;
  }, []);

  function requestHtmlZipDownload() {
    if (showHtmlPrivacyWarning) {
      setHtmlZipWarningOpen(true);
      return;
    }
    void downloadHtmlZip(exportCaptures);
  }

  const clearFreshHomeSearchState = useCallback(() => {
    if (autoStart || initialUrl) return;
    const input = targetUrlInputRef.current;
    if (input && document.activeElement === input && input.value.trim()) return;
    const defaultScope = appSettings?.defaultScanScope ?? "recent";
    abortRef.current?.abort();
    setTargetUrl("");
    setMatchType(appSettings?.defaultMatchType ?? DEFAULT_MATCH_TYPE);
    setCaptures([]);
    setFailedResults([]);
    setLiveFailedResults([]);
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
    setSortBy(normalizeInitialSort(appSettings?.defaultSort ?? null));
    setViewMode(appSettings?.defaultViewMode ?? "list");
    setScanScope(defaultScope);
    setActiveCollectionIds(undefined);
    setCustomDateFrom(defaultScope === "custom" ? appSettings?.defaultCustomDateFrom ?? "" : "");
    setCustomDateTo(defaultScope === "custom" ? appSettings?.defaultCustomDateTo ?? "" : "");
    setPage(1);
    setCheckedCollectionIds(new Set());
    setScanLog([]);
    scanLogRef.current = [];
    setScanLogOpen(false);
    setAdvancedOpen(false);
    setScanStartedAt(undefined);
    setActiveScanId("");
    setPersistedScanScope("recent");
    setStoredDurationMs(0);
    setIsPersistedScanRunning(false);
    setElapsedMs(0);
    setAutoRetryEnabled(true);
    setNextAutoRetryAt(undefined);
    setIsStoredView(false);
    setRobotsStatus(null);
    setBlockedRobotsConfirmation(null);
    blockedRobotsApprovedScanIdsRef.current.clear();
    setOptOutMatch(null);
    setOptOutCachedScanAt(undefined);
    setExportColumns((appSettings?.defaultExportColumns ?? DEFAULT_EXPORT_COLUMNS) as CaptureColumnKey[]);
    if (targetUrlInputRef.current) targetUrlInputRef.current.value = "";
  }, [appSettings, autoStart, initialUrl]);

  const filteredCaptures = useMemo(() => {
    return measureSync(
      "search-filter-sort",
      () => {
        const query = deferredUrlFilter.trim().toLowerCase();
        const filtered = captures.filter((capture) => {
          if (yearFilter !== "all" && captureYear(capture.timestamp) !== yearFilter) return false;
          if (collectionFilter !== "all" && capture.collectionId !== collectionFilter) return false;
          if (mimeFilter !== "all" && capture.mime !== mimeFilter) return false;
          if (statusFilter !== "all" && capture.status !== statusFilter) return false;
          if (query && !capture.url.toLowerCase().includes(query)) return false;
          return true;
        });
        return filtered.sort((a, b) => compareCaptures(a, b, sortBy));
      },
      { total: captures.length }
    );
  }, [captures, collectionFilter, deferredUrlFilter, mimeFilter, sortBy, statusFilter, yearFilter]);

  const exportCaptures = exportScope === "all" ? captures : filteredCaptures;
  const canExport = exportCaptures.length > 0;

  const toggleExportColumn = useCallback((key: CaptureColumnKey) => {
    setExportColumns((current) =>
      current.includes(key) ? current.filter((column) => column !== key) : [...current, key]
    );
  }, []);

  // The list is virtualized (no client-side slicing), but the page bounds are
  // still derived for URL/session position persistence and the page-clamp effect.
  const pageSize = appSettings?.searchPageSize ?? DEFAULT_SEARCH_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(filteredCaptures.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    scanLogRef.current = scanLog;
  }, [scanLog]);

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
    () =>
      measureSync(
        "filter-options",
        () => ({
          years: unique(captures.map((capture) => captureYear(capture.timestamp))),
          collections: unique(captures.map((capture) => capture.collectionId)),
          mimes: unique(captures.map((capture) => capture.mime)),
          statuses: unique(captures.map((capture) => capture.status))
        }),
        { total: captures.length }
      ),
    [captures]
  );

  const scopedCollections = useMemo(
    () => collectionsByIds(collectionsForScope(collections, scanScope, customDateFrom, customDateTo), activeCollectionIds),
    [activeCollectionIds, collections, customDateFrom, customDateTo, scanScope]
  );

  const currentScopeCollections = useMemo(
    () => collectionsForScope(collections, scanScope, customDateFrom, customDateTo),
    [collections, customDateFrom, customDateTo, scanScope]
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
    setCustomDateFrom(normalizeDateInput(session.dateFrom));
    setCustomDateTo(normalizeDateInput(session.dateTo));
    setPage(session.page && session.page > 1 ? session.page : 1);
  }

  function applySessionIdentity(session: ScanSession) {
    setActiveScanId(session.scanId);
    setTargetUrl(session.url);
    setMatchType(session.matchType);
    setScanScope(session.scope);
    setPersistedScanScope(session.scope);
    setActiveCollectionIds(session.collectionIds);
    applySessionFilters(session);
  }

  async function applyCoverageToState(session: ScanSession, loadedCollections = collections) {
    const restoreMark = `search-stored-scan-restore:start:${session.scanId}`;
    markPerformance(restoreMark);
    try {
    setState("loading-stored-scan");
    setError("");
    const activeCollections = collectionsForSession(loadedCollections, session);
    const activeIds = new Set(activeCollections.map((collection) => collection.id));
    const coverage = await getCoverage(session.targetId);
    const results = filterResultsForScope(
      coverageResults(coverage).filter((result) => activeIds.has(result.collection.id)),
      session.scope,
      session.dateFrom,
      session.dateTo
    );
    const logResults = filterScanLogForCollections(coverageScanLogResults(coverage), activeCollections);
    const checkedIds = resultCollectionIds(results);
    const failed = results.filter((result) => result.status === "not-checked");
    const successfulResults = successfulResultCount(results);
    const storedCaptureCount = results.reduce((count, result) => count + result.captures.length, 0);
    setCollections(loadedCollections);
    setFailedResults(failed);
    setCheckedCollectionIds(checkedIds);
    setProgress({
      checked: successfulResults,
      total: activeCollections.length,
      hits: storedCaptureCount,
      failed: failed.length,
      activeCollections: []
    });
    const storedCaptures = dedupeCaptures(filterCapturesByDateRange(
      coverageCaptures(coverage).filter((capture) => activeIds.has(capture.collectionId)),
      session.dateFrom,
      session.dateTo
    ));
    const hasRestoredActiveRun = hasRestorableActiveScan(coverage, logResults);
    const storedDuration = restoredCoverageDurationMs(coverage, logResults);
    const displayedDuration = storedDuration || scanLogDurationMs(logResults);
    const cachedRobotsStatus = readCachedRobotsStatus(session.url);
    const restoredLog =
      checkedIds.size > 0 || storedCaptures.length > 0 || failed.length > 0
        ? [
            ...logResults,
            storedCoverageLoadedEvent({
              checked: successfulResults,
              total: activeCollections.length,
              failed: failed.length,
              captures: storedCaptures.length
            })
          ]
        : logResults;

    setCaptures(storedCaptures);
    setFailedResults(failed);
    setCheckedCollectionIds(checkedIds);
    setScanLog(restoredLog);
    scanLogRef.current = restoredLog;
    setLiveFailedResults([]);
    // The scan log always starts collapsed when restoring a stored scan; its
    // open/closed state is intentionally not remembered across visits.
    setScanLogOpen(false);
    const restoredState =
      hasRestoredActiveRun
        ? "running"
        : results.length > 0
        ? "done"
        : startsFromSearchRoute && !initialHistoryMode
          ? "loading-collections"
          : startsFromSearchRoute
            ? "done"
            : "idle";
    setError("");
    setState(restoredState);
    setIsStoredView(results.length > 0 && !hasRestoredActiveRun);
    if (cachedRobotsStatus) setRobotsStatus(cachedRobotsStatus);
    setBlockedRobotsConfirmation(null);
    setScanStartedAt(hasRestoredActiveRun ? coverage?.activeScanStartedAt : undefined);
    setStoredDurationMs(hasRestoredActiveRun ? coverage?.durationMs ?? 0 : storedDuration);
    setIsPersistedScanRunning(hasRestoredActiveRun);
    setElapsedMs(displayedDuration);
    setProgress({
      checked: successfulResults,
      total: activeCollections.length,
      hits: storedCaptures.length,
      failed: failed.length,
      activeCollections: []
    });
    } finally {
      measurePerformance("search-stored-scan-restore", restoreMark, { scope: session.scope });
    }
  }

  async function loadSessionById(scanId: string) {
    const session = await getScanSession(scanId);
    if (!session) return false;
    const loadedCollections = collections.length > 0 ? collections : await fetchCollections();
    applySessionIdentity(session);
    await applyCoverageToState(session, loadedCollections);
    return true;
  }

  async function loadStoredScan(
    url: string,
    activeMatchType: MatchType,
    activeScope: ScanScope,
    dateFrom = customDateFrom,
    dateTo = customDateTo,
    savedKey?: string,
    prefetchedCollections?: CommonCrawlCollection[]
  ) {
    const loadedCollections = prefetchedCollections ?? (collections.length > 0 ? collections : await fetchCollections());
    const legacySession = await findOrCreateLegacySession(url, activeMatchType, false, activeScope, {
      dateFrom,
      dateTo,
      savedKey
    });
    applySessionIdentity(legacySession);
    await applyCoverageToState(legacySession, loadedCollections);
    return legacySession;
  }

  function loadMockResults(
    options: { url?: string; matchType?: MatchType; syncRoute?: boolean; dateFrom?: string; dateTo?: string } = {}
  ) {
    abortRef.current?.abort();
    robotsAbortRef.current?.abort();
    const url = normalizeSearchUrlOrFallback(options.url ?? targetUrl);
    const activeMatchType = options.matchType ?? matchType;
    const activeDateFrom = options.dateFrom ?? customDateFrom;
    const activeDateTo = options.dateTo ?? customDateTo;
    const activeScope = hasValidCustomDateRange(activeDateFrom, activeDateTo) ? "custom" : "recent";
    const mock = createMockSearchDataset(url, activeMatchType);
    const scopedMockCollections = collectionsForScope(mock.collections, activeScope, activeDateFrom, activeDateTo);
    const scopedCollectionIds = new Set(scopedMockCollections.map((collection) => collection.id));
    const scopedCaptures = filterCapturesByDateRange(
      mock.captures.filter((capture) => scopedCollectionIds.has(capture.collectionId)),
      activeDateFrom,
      activeDateTo
    );
    const scopedFailedResults = filterResultsForScope(
      mock.failedResults.filter((result) => scopedCollectionIds.has(result.collection.id)),
      activeScope,
      activeDateFrom,
      activeDateTo
    );
    const checkedIds = new Set(scopedMockCollections.map((collection) => collection.id));
    const failedCount = scopedFailedResults.length;
    const persistedAutoRetry = readAutoRetryState(url, activeMatchType, true, activeScope, activeDateFrom, activeDateTo);

    setTargetUrl(url);
    setMatchType(activeMatchType);
    setScanScope(activeScope);
    setPersistedScanScope(activeScope);
    setCustomDateFrom(activeDateFrom);
    setCustomDateTo(activeDateTo);
    setCollections(mock.collections);
    setActiveCollectionIds(scopedMockCollections.map((collection) => collection.id));
    setCaptures(scopedCaptures);
    setFailedResults(scopedFailedResults);
    setLiveFailedResults([]);
    setCheckedCollectionIds(checkedIds);
    setScanLog(mock.scanLog);
    scanLogRef.current = mock.scanLog;
    // The scan log only opens when the user expands it.
    setScanLogOpen(false);
    setError("");
    setState("done");
    setIsStoredView(true);
    setScanStartedAt(Date.now() - 129000);
    setStoredDurationMs(129000);
    setIsPersistedScanRunning(false);
    setElapsedMs(129000);
    setAutoRetryEnabled(persistedAutoRetry?.enabled ?? true);
    setNextAutoRetryAt(persistedAutoRetry?.nextRetryAt);
    setRobotsStatus(null);
    setBlockedRobotsConfirmation(null);
    setOptOutMatch(null);
    setOptOutCachedScanAt(undefined);
    setProgress({
      checked: scopedMockCollections.length,
      total: scopedMockCollections.length,
      hits: scopedCaptures.length,
      failed: failedCount,
      activeCollections: []
    });

    if (options.syncRoute) {
      const nextHref = buildMockSearchHref(url, activeMatchType, activeDateFrom, activeDateTo);
      const currentHref = `${window.location.pathname}${window.location.search}`;
      if (nextHref !== currentHref) router.replace(nextHref);
    }
  }

  async function runSearch(
    mode: RunSearchMode = "fresh",
    options: { url?: string; matchType?: MatchType; scope?: ScanScope; dateFrom?: string; dateTo?: string } = {}
  ) {
    const fallbackUrl = targetUrl || targetUrlInputRef.current?.value || "";
    const normalizedUrl = normalizeSearchUrlInput(options.url ?? fallbackUrl);
    const activeMatchType = options.matchType ?? matchType;
    const activeScope = options.scope ?? scanScope;
    const activeDateFrom = normalizeDateInput(options.dateFrom ?? customDateFrom);
    const activeDateTo = normalizeDateInput(options.dateTo ?? customDateTo);
    if (!normalizedUrl.ok) {
      setError(normalizedUrl.error);
      return;
    }
    const url = normalizedUrl.url;
    if (targetUrl !== url) setTargetUrl(url);
    if (activeScope === "custom" && !hasValidCustomDateRange(activeDateFrom, activeDateTo)) return;

    abortRef.current?.abort();
    if (shouldResetPaceForMode(mode)) {
      resetCommonCrawlRateLimitState();
    }
    const startupController = new AbortController();
    abortRef.current = startupController;
    const session = await ensureScanSession({
      scanId: mode === "fresh" ? undefined : activeScanId || undefined,
      url,
      matchType: activeMatchType,
      mock: initialMockMode,
      scope: activeScope,
      dateFrom: activeScope === "custom" ? activeDateFrom : undefined,
      dateTo: activeScope === "custom" ? activeDateTo : undefined,
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
    const existingCoverage = mode === "fresh" ? undefined : await getCoverage(session.targetId);
    const reuseStoredPrerequisites = mode !== "fresh" && hasStoredCoverageHistory(existingCoverage);

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
    setBlockedRobotsConfirmation(null);
    setState("loading-collections");
    setIsStoredView(false);
    setOptOutMatch(null);
    setLiveFailedResults([]);
    setScanScope(activeScope);
    setPersistedScanScope(activeScope);
    setCustomDateFrom(activeScope === "custom" ? activeDateFrom : "");
    setCustomDateTo(activeScope === "custom" ? activeDateTo : "");

    const robotsChecksEnabled = await shouldCheckRobotsTxt();
    const precheckedRobotsStatus = initialMockMode || !robotsChecksEnabled
      ? null
      : reuseStoredPrerequisites
        ? (readCachedRobotsStatus(url) ?? robotsStatus)
        : await checkRobotsForUrl(url, startupController.signal, undefined, { preferLive: true });
    if (startupController.signal.aborted) {
      setIsPersistedScanRunning(false);
      setProgress((current) => ({ ...current, activeCollections: [] }));
      setState("paused");
      return;
    }
    // Continuations of a stored scan (missing collections, retries, resume)
    // start without re-confirming blocked robots; the confirmation only gates
    // starting a brand-new scan.
    if (precheckedRobotsStatus?.status === "blocked" && !reuseStoredPrerequisites && !hasBlockedRobotsApproval(session)) {
      setBlockedRobotsConfirmation({
        session,
        mode,
        robotsStatus: precheckedRobotsStatus
      });
      setState("paused");
      setIsPersistedScanRunning(false);
      setScanStartedAt(undefined);
      setNextAutoRetryAt(undefined);
      return;
    }

    await executeRunSearch(mode, {
      session,
      precheckedRobotsStatus,
      reuseStoredPrerequisites
    });
  }

  function pauseScan() {
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    setNextAutoRetryAt(undefined);
    setIsPersistedScanRunning(false);
    setProgress((current) => ({ ...current, activeCollections: [] }));
    setState("paused");
  }

  async function executeRunSearch(
    mode: RunSearchMode,
    options: {
      session: ScanSession;
      precheckedRobotsStatus?: RobotsUiState | null;
      allowBlockedRobots?: boolean;
      reuseStoredPrerequisites?: boolean;
    }
  ) {
    let session = options.session;
    const url = session.url;
    const activeMatchType = session.matchType;
    const activeScope = session.scope;
    const activeDateFrom = session.dateFrom;
    const activeDateTo = session.dateTo;

    // For a custom date range, constrain each CDX query server-side so Common
    // Crawl only returns captures inside the window. A stored result is only
    // reusable when its coverage window is broad enough for the current request.
    const requestedWindow: ScanDateWindow | undefined =
      activeScope === "custom" && hasValidCustomDateRange(activeDateFrom ?? "", activeDateTo ?? "")
        ? { from: activeDateFrom!, to: activeDateTo! }
        : undefined;
    const coversRequestedWindow = (result: CollectionCheckResult) =>
      result.status === "checked" && resultCoversWindow(result.window, requestedWindow);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setOptOutMatch(null);
    setBlockedRobotsConfirmation(null);
    setIsStoredView(false);
    setLiveFailedResults([]);
    if (options.allowBlockedRobots) rememberBlockedRobotsApproval(session);
    // Stored coverage proves this scan was already started deliberately, so a
    // continuation (missing collections, retries, resume) runs without asking
    // for blocked-robots confirmation again.
    const coverageBeforeRun = await getCoverage(session.targetId);
    const isStoredContinuation = mode !== "fresh" && hasStoredCoverageHistory(coverageBeforeRun);
    const robotsChecksEnabled = await shouldCheckRobotsTxt();
    const effectiveRobotsStatus = !robotsChecksEnabled
      ? null
      : options.precheckedRobotsStatus ??
        (options.reuseStoredPrerequisites
          ? null
          : (initialMockMode ? null : await checkRobotsForUrl(url, controller.signal, undefined, { preferLive: true })));
    if (controller.signal.aborted) {
      setIsPersistedScanRunning(false);
      setProgress((current) => ({ ...current, activeCollections: [] }));
      setState("paused");
      return;
    }
    if (
      !options.allowBlockedRobots &&
      !isStoredContinuation &&
      effectiveRobotsStatus?.status === "blocked" &&
      !hasBlockedRobotsApproval(session)
    ) {
      setBlockedRobotsConfirmation({
        session,
        mode,
        robotsStatus: effectiveRobotsStatus
      });
      setState("paused");
      setIsPersistedScanRunning(false);
      setScanStartedAt(undefined);
      setNextAutoRetryAt(undefined);
      return;
    }
    setIsPersistedScanRunning(true);
    setScanScope(activeScope);
    setPersistedScanScope(activeScope);
    setActiveCollectionIds(session.collectionIds);
    const baseDurationMs = mode === "fresh"
      ? 0
      : Math.max(
          restoredCoverageDurationMs(coverageBeforeRun),
          storedDurationMs,
          scanLogDurationMs(scanLogRef.current)
        );
    const runStartedAt = Date.now();
    await startCoverageRun(session, runStartedAt, baseDurationMs, {
      collectionIds: session.collectionIds,
      collectionListFetchedAt: session.collectionListFetchedAt,
      scanWindowFrom: session.scanWindowFrom,
      scanWindowTo: session.scanWindowTo
    });
    let durationPersisted = false;
    const persistRunDuration = async () => {
      if (durationPersisted) return;
      durationPersisted = true;
      const segmentMs = Date.now() - runStartedAt;
      const nextDurationMs = baseDurationMs + Math.max(0, segmentMs);
      setStoredDurationMs(nextDurationMs);
      setIsPersistedScanRunning(false);
      setElapsedMs(nextDurationMs);
      await addCoverageDuration(session.targetId, segmentMs);
    };
    setScanStartedAt(runStartedAt);
    setStoredDurationMs(baseDurationMs);
    setElapsedMs(baseDurationMs);
    setNextAutoRetryAt(undefined);
    setState(collections.length > 0 ? "running" : "loading-collections");

    const loadStoredForMode =
      mode === "fresh" ||
      ((mode === "resume" || mode === "retry-failed" || mode === "auto-retry") &&
        checkedCollectionIds.size === 0 &&
        failedResults.length === 0);

    if (mode === "fresh") {
      setCaptures([]);
      setFailedResults([]);
      setCheckedCollectionIds(new Set());
      setScanLog([]);
      scanLogRef.current = [];
      setProgress({ checked: 0, total: 0, hits: 0, failed: 0, activeCollections: [] });
    }

    const appendRunLogEvent = (entry: ScanLogEvent) => {
      if (hasScanLogEntry(scanLogRef.current, entry)) return;
      scanLogRef.current = [...scanLogRef.current, entry];
      setScanLog(scanLogRef.current);
      void appendCoverageScanLogEntry(session, entry);
    };
    const appendCollectionAttempt = (collection: CommonCrawlCollection, attemptLog: CollectionAttemptLog) => {
      const entry = resultFromAttemptLog(collection, attemptLog);
      scanLogRef.current = [...scanLogRef.current, entry];
      setScanLog(scanLogRef.current);
      void appendCoverageScanLogEntry(session, entry);
    };
    appendRunLogEvent(scanStartEventForMode(mode));
    if (robotsChecksEnabled && !options.precheckedRobotsStatus) {
      void checkRobotsForUrl(url, controller.signal, appendRunLogEvent);
    }
    let pauseLogged = false;
    const appendPauseLog = () => {
      if (pauseLogged) return;
      pauseLogged = true;
      appendRunLogEvent(scanLogEvent("scan-paused", "Scan paused.", "amber"));
    };
    let unsubscribeRateLimitChanges: (() => void) | undefined;

    try {
      const activeOptOutMatch = options.reuseStoredPrerequisites
        ? null
        : await findOptOutMatch(url, activeMatchType, controller.signal);
      if (controller.signal.aborted) {
        appendPauseLog();
        await persistRunDuration();
        setState("paused");
        return;
      }
      if (!options.reuseStoredPrerequisites) {
        appendRunLogEvent(
          scanLogEvent(
            "opt-out-checked",
            activeOptOutMatch ? "Opt-out registry matched this URL." : "Opt-out registry checked, no match.",
            activeOptOutMatch ? "red" : "green"
          )
        );
      }
      if (activeOptOutMatch) {
        const activeCollections = collectionsForScope(collections, activeScope, activeDateFrom, activeDateTo);
        const storedRecords = loadStoredForMode
          ? await getStoredScanVariants(url, activeMatchType, false, activeScope, activeDateFrom, activeDateTo)
          : [];
        const compatibleCaptureRecords = loadStoredForMode
          ? await getCompatibleStoredCaptureRecords(url, activeMatchType, false)
          : [];
        const storedResults = activeCollections.length > 0
          ? filterResultsForScope(mergeStoredScanRecords(storedRecords, activeCollections), activeScope, activeDateFrom, activeDateTo)
          : [];
        const storedCaptures = loadStoredForMode
          ? dedupeCaptures(filterCapturesByDateRange([
              ...capturesFromAnyStoredRecords(compatibleCaptureRecords),
              ...capturesFromResults(storedResults.filter((result) => result.status === "checked"))
            ], activeDateFrom, activeDateTo))
          : captures;

        // The opt-out check only blocks a *live re-scan*. The historical scan
        // still happened, so rebuild its full per-collection log: stored
        // `results` where present, plus entries synthesized from cached captures
        // for collections that only stored captures (legacy/captures-only records).
        const recordTimestamps = [...storedRecords, ...compatibleCaptureRecords]
          .map((record) => record.updatedAt)
          .filter((value): value is number => typeof value === "number");
        const scannedAt = recordTimestamps.length > 0 ? Math.max(...recordTimestamps) : runStartedAt;
        const reconstructedResults = [
          ...storedResults,
          ...synthesizeResultsFromCaptures(storedCaptures, storedResults, activeCollections, scannedAt)
        ];
        const reconstructedScanLog = [
          ...storedRecords.flatMap((record) => validStoredScanLogResults(record, activeCollections)),
          ...synthesizeResultsFromCaptures(storedCaptures, storedResults, activeCollections, scannedAt)
        ];
        const storedCheckedIds = resultCollectionIds(reconstructedResults);
        const storedFailedResults = reconstructedResults.filter((result) => result.status === "not-checked");

        setOptOutMatch(activeOptOutMatch);
        setIsStoredView(true);
        setOptOutCachedScanAt(storedCaptures.length > 0 ? scannedAt : undefined);
        await persistRunDuration();
        setCaptures(storedCaptures);
        setFailedResults(storedFailedResults);
        setLiveFailedResults([]);
        setCheckedCollectionIds(storedCheckedIds);
        scanLogRef.current = mergeScanLogSnapshot(reconstructedScanLog, scanLogRef.current);
        setScanLog(scanLogRef.current);
        // Restored historical scan (live re-scan blocked) stays collapsed.
        setScanLogOpen(false);
        setProgress({
          checked: successfulResultCount(reconstructedResults),
          total: activeCollections.length,
          hits: storedCaptures.length,
          failed: storedFailedResults.length,
          activeCollections: []
        });
        setState("done");
        return;
      }

      const loadedCollections = await loadCollectionsIfNeeded(controller);
      const scopedRunCollections = collectionsForScope(loadedCollections, activeScope, activeDateFrom, activeDateTo);
      const originalCollectionIdsForRun = session.collectionIds;
      const shouldFreezeRunCollections =
        mode === "fresh" ||
        !session.collectionIds?.length ||
        (mode === "missing" && activeScope !== "recent");
      if (shouldFreezeRunCollections) {
        const metadata = scanCollectionMetadata(activeScope, scopedRunCollections, activeDateFrom, activeDateTo);
        session = await ensureScanSession({
          scanId: session.scanId,
          url,
          matchType: activeMatchType,
          mock: initialMockMode,
          scope: activeScope,
          dateFrom: activeScope === "custom" ? activeDateFrom : undefined,
          dateTo: activeScope === "custom" ? activeDateTo : undefined,
          collectionIds: metadata.collectionIds,
          collectionListFetchedAt: metadata.collectionListFetchedAt,
          scanWindowFrom: metadata.scanWindowFrom,
          scanWindowTo: metadata.scanWindowTo,
          year: yearFilter,
          collection: collectionFilter,
          mime: mimeFilter,
          status: statusFilter,
          filter: urlFilter,
          sort: sortBy,
          view: viewMode,
          page: page > 1 ? page : undefined
        });
        setActiveCollectionIds(metadata.collectionIds);
        await startCoverageRun(session, runStartedAt, baseDurationMs, metadata);
      }
      const activeCollections = collectionsForSession(loadedCollections, session, {
        includeNew: mode === "missing" && activeScope !== "recent"
      });
      const target = await ensureTarget(url, activeMatchType, initialMockMode);
      let coverage = await getCoverage(session.targetId);
      let currentResults = filterResultsForScope(
        coverageResults(coverage).filter((result) => activeCollections.some((collection) => collection.id === result.collection.id)),
        activeScope,
        activeDateFrom,
        activeDateTo
      );
      const currentScanLog = filterScanLogForCollections(coverageScanLogResults(coverage), activeCollections);
      let currentCaptures = filterCapturesByDateRange(
        coverageCaptures(coverage).filter((capture) => activeCollections.some((collection) => collection.id === capture.collectionId)),
        activeDateFrom,
        activeDateTo
      );
      let currentCheckedIds = resultCollectionIds(currentResults);
      let currentFailedResults = currentResults.filter((result) => result.status === "not-checked");
      const failedIds = new Set(currentFailedResults.map((result) => result.collection.id));
      const attemptedIds = resultCollectionIds(currentResults);
      // A collection is "covered" only if its stored checked result spans the
      // requested window; windowed results do not satisfy a broader request, so
      // those collections stay in the search set and are re-queried.
      const coveredIds = new Set(
        currentResults.filter(coversRequestedWindow).map((result) => result.collection.id)
      );
      let searchSet = activeCollections.filter((collection) => !coveredIds.has(collection.id));

      if (mode === "missing") {
        const originalIds = new Set(originalCollectionIdsForRun ?? []);
        searchSet =
          activeScope !== "recent" && originalIds.size > 0
            ? activeCollections.filter((collection) => !originalIds.has(collection.id) && (!attemptedIds.has(collection.id) || failedIds.has(collection.id)))
            : activeCollections.filter((collection) => !attemptedIds.has(collection.id));
      } else if (mode === "resume") {
        const pendingCollections = activeCollections.filter((collection) => !coveredIds.has(collection.id) && !failedIds.has(collection.id));
        const failedCollections = activeCollections.filter((collection) => !coveredIds.has(collection.id) && failedIds.has(collection.id));
        searchSet = [...pendingCollections, ...failedCollections];
      } else if (mode === "retry-failed") {
        searchSet = activeCollections.filter((collection) => failedIds.has(collection.id));
      } else if (mode === "auto-retry") {
        searchSet = activeCollections.filter((collection) => !coveredIds.has(collection.id));
      }

      setCollections(loadedCollections);
      setCaptures(currentCaptures);
      setFailedResults(currentFailedResults);
      setCheckedCollectionIds(currentCheckedIds);
      // Stored scan-log rows are restored when opening the scan. During a
      // continuation run, keep the visible log append-only so restarting does
      // not re-inject the same stored attempts into the live UI.
      // Preserve the user's expanded scan-log view when continuing a paused
      // scan from stored history; fresh/manual reruns still start collapsed.
      setScanLogOpen(mode === "fresh" || mode === "auto-retry" ? false : scanLogOpen);
      setProgress({
        checked: currentCheckedIds.size,
        total: activeCollections.length,
        hits: currentCaptures.length,
        failed: currentFailedResults.length,
        activeCollections: []
      });
      const hasVisibleStoredCoverageLog = scanLog.some((entry) => "kind" in entry && entry.event === "stored-coverage-loaded");
      if (
        mode !== "fresh" &&
        !hasVisibleStoredCoverageLog &&
        (currentCheckedIds.size > 0 || currentFailedResults.length > 0 || currentCaptures.length > 0)
      ) {
        appendRunLogEvent(
          storedCoverageLoadedEvent({
            checked: successfulResultCount(currentResults),
            total: activeCollections.length,
            failed: currentFailedResults.length,
            captures: currentCaptures.length
          })
        );
      }

      if (searchSet.length === 0) {
        if (mode === "auto-retry") {
          appendRunLogEvent(scanLogEvent("auto-retry-skipped", "Auto retry skipped: no failed or unchecked collections remain.", "amber"));
        }
        const finalEventInput = {
          checked: successfulResultCount(currentResults),
          failed: currentFailedResults.length,
          captures: currentCaptures.length
        };
        appendRunLogEvent(currentFailedResults.length > 0 ? scanIncompleteEvent(finalEventInput) : scanCompletionEvent(finalEventInput));
        await persistRunDuration();
        setState(currentFailedResults.length > 0 ? "paused" : "done");
        return;
      }

      setState("running");
      let consecutiveAvailabilitySignals = 0;
      let stopReason: SearchStopReason = "completed";
      unsubscribeRateLimitChanges = subscribeCommonCrawlRateLimitChanges((change) => {
        if (change.hostname === "index.commoncrawl.org") {
          appendRunLogEvent(paceChangeEvent(change));
        }
      });

      let didQueueImmediateFailureRetry = mode === "retry-failed" || mode === "auto-retry";
      for (let searchIndex = 0; searchIndex < searchSet.length; searchIndex += 1) {
        const collection = searchSet[searchIndex];
        if (controller.signal.aborted) break;

        coverage = await getCoverage(session.targetId);
        const existing = coverage?.collectionResults[collection.id];
        if (existing && coversRequestedWindow(existing)) {
          appendRunLogEvent(scanLogEvent("collection-skipped", `${collection.id} skipped: already checked successfully.`));
          currentResults = filterResultsForScope(
            coverageResults(coverage).filter((result) =>
              activeCollections.some((activeCollection) => activeCollection.id === result.collection.id)
            ),
            activeScope,
            activeDateFrom,
            activeDateTo
          );
          currentCaptures = filterCapturesByDateRange(
            coverageCaptures(coverage).filter((capture) =>
              activeCollections.some((activeCollection) => activeCollection.id === capture.collectionId)
            ),
            activeDateFrom,
            activeDateTo
          );
          currentCheckedIds = resultCollectionIds(currentResults);
          setCaptures(currentCaptures);
          setCheckedCollectionIds(currentCheckedIds);
          continue;
        }

        setProgress((current) => ({ ...current, activeCollections: [collection.id] }));
        const result = await queryCollection(
          url,
          collection,
          controller.signal,
          undefined,
          undefined,
          undefined,
          undefined,
          activeMatchType,
          (attemptLog) => {
            appendCollectionAttempt(collection, attemptLog);
            if (attemptLog.errorKind === "timeout") {
              appendRunLogEvent(scanLogEvent("request-timeout", `${collection.id} request timed out.`, "red"));
            }
          },
          (delayMs) => appendRunLogEvent(
            scanLogEvent("retry-wait-started", `${collection.id} retry wait started · ${formatSecondsAbbrev(delayMs)}.`, "amber")
          ),
          null,
          null,
          requestedWindow
        );
        if (result.fromCache) {
          appendRunLogEvent(scanLogEvent("cache-hit", `${collection.id} loaded from CDX cache.`));
        }
        coverage = await upsertCoverageResult(target, result);
        currentResults = filterResultsForScope(
          coverageResults(coverage).filter((storedResult) =>
            activeCollections.some((activeCollection) => activeCollection.id === storedResult.collection.id)
          ),
          activeScope,
          activeDateFrom,
          activeDateTo
        );
        currentCaptures = filterCapturesByDateRange(
          coverageCaptures(coverage).filter((capture) =>
            activeCollections.some((activeCollection) => activeCollection.id === capture.collectionId)
          ),
          activeDateFrom,
          activeDateTo
        );
        currentCheckedIds = resultCollectionIds(currentResults);
        currentFailedResults = currentResults.filter((storedResult) => storedResult.status === "not-checked");

        setCaptures(currentCaptures);
        setFailedResults(currentFailedResults);
        setLiveFailedResults((currentLiveFailures) => upsertLiveFailures(currentLiveFailures, result));
        setCheckedCollectionIds(currentCheckedIds);
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

        if (
          !didQueueImmediateFailureRetry &&
          searchIndex === searchSet.length - 1 &&
          currentFailedResults.length > 0
        ) {
          didQueueImmediateFailureRetry = true;
          const retryIds = new Set(currentFailedResults.map((failedResult) => failedResult.collection.id));
          const retryCollections = activeCollections.filter((activeCollection) => retryIds.has(activeCollection.id));
          if (retryCollections.length > 0) {
            appendRunLogEvent(scanLogEvent(
              "scan-restarted",
              `Retrying ${retryCollections.length} failed source${retryCollections.length === 1 ? "" : "s"} before finishing.`,
              "amber"
            ));
            searchSet = [...searchSet, ...retryCollections];
          }
        }
      }
      unsubscribeRateLimitChanges?.();
      unsubscribeRateLimitChanges = undefined;

      await persistRunDuration();

      if (controller.signal.aborted) {
        appendPauseLog();
        setState("paused");
      } else if (stopReason === "circuit-breaker") {
        appendRunLogEvent(
          scanLogEvent(
            "scan-paused",
            `Circuit breaker threshold reached: paused after ${DEFAULT_CIRCUIT_BREAKER_THRESHOLD} consecutive availability failures.`,
            "amber"
          )
        );
        setState("paused");
      } else {
        const finalEventInput = {
          checked: successfulResultCount(currentResults),
          failed: currentFailedResults.length,
          captures: currentCaptures.length
        };
        appendRunLogEvent(currentFailedResults.length > 0 ? scanIncompleteEvent(finalEventInput) : scanCompletionEvent(finalEventInput));
        setState(currentFailedResults.length > 0 ? "paused" : "done");
      }
    } catch (err) {
      unsubscribeRateLimitChanges?.();
      if (controller.signal.aborted) {
        appendPauseLog();
        await persistRunDuration();
        setState("paused");
        return;
      }
      setError(formatSearchError(err));
      appendRunLogEvent(scanLogEvent("scan-failed", formatSearchError(err), "red"));
      await persistRunDuration();
      setState("error");
    }
  }

  async function checkRobotsForUrl(
    url: string,
    parentSignal?: AbortSignal,
    appendLogEvent?: (entry: ScanLogEvent) => void,
    options: { preferLive?: boolean } = {}
  ): Promise<RobotsUiState | null> {
    if (!(await shouldCheckRobotsTxt())) {
      setRobotsStatus(null);
      return null;
    }
    const target = robotsUrlForTarget(url);
    const cached = options.preferLive ? null : readCachedRobotsStatus(url);
    if (cached) {
      setRobotsStatus(cached);
      appendLogEvent?.(scanLogEvent("robots-cached", "CCBot robots.txt loaded from cache."));
      return cached;
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
        appendLogEvent?.(scanLogEvent("robots-checked", "CCBot robots.txt checked live."));
        return result;
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
        appendLogEvent?.(scanLogEvent("robots-checked", "CCBot robots.txt checked live: unavailable.", "red"));
        return result;
      }
    } finally {
      parentSignal?.removeEventListener("abort", abortFromParent);
      if (robotsAbortRef.current === controller) robotsAbortRef.current = null;
    }

    return null;
  }

  async function shouldCheckRobotsTxt() {
    if (appSettings) return appSettings.robotsTxtChecksEnabled;
    try {
      const settings = await getSettings();
      setAppSettings(settings);
      setShowHtmlPrivacyWarning(settings.showHtmlPrivacyWarning);
      return settings.robotsTxtChecksEnabled;
    } catch {
      return true;
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
    const plan = htmlZipPlan(capturesToDownload);
    if (plan.tooLarge) {
      const message = `HTML ZIP export is too large for one browser session (${capturesToDownload.length} captures, estimated ${formatBytes(plan.estimatedBytes)}). Narrow the filters and export in smaller batches.`;
      setHtmlZipDownload({
        active: false,
        completed: 0,
        total: capturesToDownload.length,
        error: message
      });
      appendUiScanLogEvent(scanLogEvent("html-zip-failed", message, "red"));
      return;
    }
    if (
      plan.needsConfirmation &&
      !window.confirm(htmlZipConfirmationMessage(capturesToDownload, plan.estimatedBytes, plan.estimatedParts))
    ) {
      return;
    }

    const controller = new AbortController();
    htmlZipAbortRef.current = controller;
    appendUiScanLogEvent(
      scanLogEvent(
        "html-zip-started",
        `HTML ZIP download started · ${capturesToDownload.length} capture${capturesToDownload.length === 1 ? "" : "s"}.`
      )
    );
    setHtmlZipDownload({
      active: true,
      completed: 0,
      total: capturesToDownload.length,
      failed: 0,
      part: 1,
      parts: plan.estimatedParts,
      bytes: 0
    });

    try {
      let part = 1;
      let parts = plan.estimatedParts;
      let downloadedParts = 0;
      let completed = 0;
      let failedCount = 0;
      let exportedCount = 0;
      let exportedBytes = 0;
      let partCaptureCount = 0;
      let partBytes = 0;
      let entries: HtmlZipPartEntry[] = [{ filename: HTML_ZIP_WARNING_FILENAME, content: htmlZipWarningContent() }];
      let successes: HtmlZipSuccess[] = [];
      let failures: HtmlZipFailure[] = [];

      const updateZipProgress = () => {
        setHtmlZipDownload({
          active: true,
          completed,
          total: capturesToDownload.length,
          failed: failedCount,
          part,
          parts,
          bytes: exportedBytes
        });
      };

      const flushPart = async (force = false) => {
        if (!force && successes.length === 0 && failures.length === 0) return;
        if (successes.length === 0 && failures.length === 0) return;
        entries.push({ filename: HTML_ZIP_MANIFEST_FILENAME, content: htmlZipManifestContent(successes, failures) });
        if (failures.length > 0) {
          entries.push({ filename: HTML_ZIP_FAILED_FILENAME, content: htmlZipFailedContent(failures) });
        }
        parts = Math.max(parts, part);
        updateZipProgress();
        const zipBytes = await computeZipBytes(entries);
        downloadBlob(new Blob([zipBytes], { type: "application/zip" }), htmlZipFilename(part, parts));
        await waitForBrowserDownload(HTML_ZIP_DOWNLOAD_PAUSE_MS);
        downloadedParts += 1;
        part += 1;
        parts = Math.max(parts, part);
        partCaptureCount = 0;
        partBytes = 0;
        entries = [{ filename: HTML_ZIP_WARNING_FILENAME, content: htmlZipWarningContent() }];
        successes = [];
        failures = [];
        updateZipProgress();
      };

      for (let index = 0; index < capturesToDownload.length; index += 1) {
        if (controller.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
        const capture = capturesToDownload[index];
        const filename = htmlArchiveFilename(capture, index);
        try {
          const loaded = isMockCaptureFilename(capture.filename)
            ? {
                record: createMockWarcRecord({
                  filename: capture.filename,
                  timestamp: capture.timestamp,
                  url: capture.url,
                  collection: capture.collectionId
                }),
                source: "mock" as const
              }
            : await loadCaptureRecord({
                capture,
                cacheMode: "read-only",
                retryCount: 2,
                signal: controller.signal
              });
          const contentBytes = byteSize(loaded.record.html);
          if (
            partCaptureCount > 0 &&
            (partCaptureCount >= HTML_ZIP_BATCH_CAPTURE_LIMIT || partBytes + contentBytes > HTML_ZIP_BATCH_BYTES)
          ) {
            await flushPart();
          }
          entries.push({ filename, content: loaded.record.html });
          successes.push({
            filename,
            capture,
            source: loaded.source,
            sizeBytes: contentBytes
          });
          partCaptureCount += 1;
          partBytes += contentBytes;
          exportedCount += 1;
          exportedBytes += contentBytes;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          failedCount += 1;
          failures.push({
            filename,
            capture,
            error: error instanceof Error ? error.message : "Could not load this capture."
          });
          if (partCaptureCount + failures.length >= HTML_ZIP_BATCH_CAPTURE_LIMIT) {
            await flushPart();
          }
        }
        completed = index + 1;
        updateZipProgress();
      }

      await flushPart(true);
      setHtmlZipDownload({
        active: false,
        completed: capturesToDownload.length,
        total: capturesToDownload.length,
        failed: failedCount,
        part: Math.max(1, downloadedParts),
        parts: Math.max(1, downloadedParts),
        bytes: exportedBytes,
        error: failedCount > 0 ? `${failedCount} capture${failedCount === 1 ? "" : "s"} could not be exported. See the ZIP manifest.` : undefined
      });
      appendUiScanLogEvent(
        scanLogEvent(
          "html-zip-completed",
          `HTML ZIP download completed · ${exportedCount} exported · ${failedCount} failed · ${Math.max(1, downloadedParts)} ZIP file${Math.max(1, downloadedParts) === 1 ? "" : "s"}.`,
          failedCount > 0 ? "amber" : "neutral"
        )
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setHtmlZipDownload({
          active: false,
          completed: 0,
          total: 0
        });
        appendUiScanLogEvent(scanLogEvent("html-zip-cancelled", "HTML ZIP download cancelled.", "amber"));
        return;
      }
      const message = error instanceof Error ? error.message : "Could not download all HTML captures.";
      setHtmlZipDownload({
        active: false,
        completed: 0,
        total: capturesToDownload.length,
        error: message
      });
      appendUiScanLogEvent(scanLogEvent("html-zip-failed", `HTML ZIP download failed: ${message}`, "red"));
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
          resetCommonCrawlRateLimitState();
          const loadedCollections = collections.length > 0 ? collections : await fetchCollections();
          const coverage = await getCoverage(session.targetId);
          if (hasStoredCoverageHistory(coverage)) {
            if (!coverageHasPendingSessionWork(coverage, session, loadedCollections)) return;
            await executeRunSearch("resume", {
              session,
              precheckedRobotsStatus: readCachedRobotsStatus(session.url) ?? robotsStatus,
              reuseStoredPrerequisites: true
            });
            return;
          }
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
        url: normalizeSearchUrlOrFallback(initialUrl || "https://example.org/"),
        matchType: initialMatchType ?? DEFAULT_MATCH_TYPE,
        dateFrom: initialDateFrom,
        dateTo: initialDateTo
      });
      return;
    }
    if (!autoStart || !initialUrl || autoStartedSignatureRef.current === autoStartSignature) return;
    autoStartedSignatureRef.current = autoStartSignature;
    const normalizedInitialUrl = normalizeSearchUrlInput(initialUrl);
    if (!normalizedInitialUrl.ok) {
      setError(normalizedInitialUrl.error);
      setState("error");
      return;
    }
    const searchUrl = normalizedInitialUrl.url;
    applyRouteResultParams();
    setTargetUrl(searchUrl);
    const nextMatchType = initialMatchType ?? DEFAULT_MATCH_TYPE;
    setMatchType(nextMatchType);
    setScanScope(initialScanScope);
    setPersistedScanScope(initialScanScope);
    setCustomDateFrom(initialDateFrom);
    setCustomDateTo(initialDateTo);
    void (async () => {
      const loadedCollections = collections.length > 0 ? collections : await fetchCollections();
      const loadedSession = await loadStoredScan(
        searchUrl,
        nextMatchType,
        initialScanScope,
        initialDateFrom,
        initialDateTo,
        initialSavedKey,
        loadedCollections
      );
      const loadedCoverage = await getCoverage(loadedSession.targetId);
      const hasStoredCoverage = hasStoredCoverageHistory(loadedCoverage);
      const shouldResumeStoredScan =
        hasStoredCoverage && coverageHasPendingSessionWork(loadedCoverage, loadedSession, loadedCollections);
      if (initialHistoryMode && !initialAction) return;

      if (initialAction === "retry-failed") {
        await executeRunSearch("retry-failed", { session: loadedSession, reuseStoredPrerequisites: true });
        return;
      }
      if (initialAction === "missing") {
        await executeRunSearch("missing", { session: loadedSession, reuseStoredPrerequisites: true });
        return;
      }
      if (shouldResumeStoredScan) {
        await executeRunSearch("resume", {
          session: loadedSession,
          precheckedRobotsStatus: readCachedRobotsStatus(searchUrl) ?? robotsStatus,
          reuseStoredPrerequisites: true
        });
        return;
      }
      if (hasStoredCoverage) return;
      await runSearch("fresh", {
        url: searchUrl,
        matchType: nextMatchType,
        scope: initialScanScope,
        dateFrom: initialDateFrom,
        dateTo: initialDateTo
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoStart,
    autoStartSignature,
    initialAction,
    initialDateFrom,
    initialDateTo,
    initialHistoryMode,
    initialMatchType,
    initialMockMode,
    initialSavedKey,
    initialScanId,
    initialScanScope,
    initialUrl,
    applyRouteResultParams
  ]);

  const isRunning = state === "loading-collections" || state === "running";
  const currentNoticeFailedResults = liveFailedResults;
  const availabilityIssue = currentNoticeFailedResults.some((result) =>
    isLikelyCommonCrawlAvailabilityIssue(result.error, result.httpStatus, result.errorKind)
  );
  const hasExplicitRateLimit = currentNoticeFailedResults.some((result) =>
    isLikelyRateLimitError(result.error, result.httpStatus, result.errorKind)
  );
  const hasGatewayTimeout = currentNoticeFailedResults.some((result) => result.errorKind === "http_504_gateway_timeout");
  const hasSlowDown = currentNoticeFailedResults.some((result) => result.errorKind === "http_500_slowdown");
  const failedCount = failedResults.length;
  const noticeFailedCount = currentNoticeFailedResults.length;
  const customRangeValid = hasValidCustomDateRange(customDateFrom, customDateTo);
  const customRangeIssue = scanScope === "custom" ? customDateRangeIssue(customDateFrom, customDateTo) : null;
  // Only successfully checked sources count as "done" — a failed source still
  // needs a (re)check, so it must not push completion to 100%.
  const successfulCount = Math.max(0, checkedCollectionIds.size - failedCount);
  const uncheckedCount = Math.max(0, (scopedCollections.length || progress.total) - checkedCollectionIds.size);
  const activeIdSet = new Set(activeCollectionIds ?? []);
  const newCollectionCount =
    scanScope === "recent" || activeIdSet.size === 0
      ? 0
      : currentScopeCollections.filter((collection) => !activeIdSet.has(collection.id)).length;
  const canContinue = !isRunning && !optOutMatch && Boolean(targetUrl.trim()) && uncheckedCount > 0;
  const canRetryFailed = !isRunning && !optOutMatch && Boolean(targetUrl.trim()) && failedCount > 0 && uncheckedCount === 0;
  const canCheckNewCollections = !isRunning && !optOutMatch && Boolean(targetUrl.trim()) && newCollectionCount > 0;
  const canStartFresh = !isRunning && targetUrl.trim() && !canContinue && (scanScope !== "custom" || customRangeValid);
  const hasStartedSearch =
    state !== "idle" ||
    progress.total > 0 ||
    checkedCollectionIds.size > 0 ||
    captures.length > 0 ||
    failedResults.length > 0;
  const hasCaptures = captures.length > 0;
  const completion = progress.total > 0 ? Math.round((successfulCount / progress.total) * 100) : 0;
  const hasAutoRetryWork = availabilityIssue && uncheckedCount > 0;
  const canScheduleAutoRetry = !isRunning && !isStoredView && Boolean(targetUrl.trim()) && hasAutoRetryWork;
  const canAutoRetryFailed = autoRetryEnabled && canScheduleAutoRetry;
  const autoRetryCountdown = nextAutoRetryAt ? formatSecondsAbbrev(nextAutoRetryAt - nowMs) : "";
  const showAutoRetryAction = !isRunning && !isStoredView && hasAutoRetryWork;
  const isWaitingForAutoRetry = canAutoRetryFailed && Boolean(nextAutoRetryAt);
  const displayedSourceTotal = progress.total || scopedCollections.length || "?";
  const scanNotice = isRunning || isWaitingForAutoRetry
    ? buildScanNotice({
        failedCount: noticeFailedCount,
        hasExplicitRateLimit,
        hasGatewayTimeout,
        hasSlowDown,
        availabilityIssue,
        isWaitingForAutoRetry
      })
    : "";
  const scanSummary = hasStartedSearch
    ? buildCuratedScanSummary({
      state,
      captures: captures.length,
      checked: successfulCount,
      total: progress.total || scopedCollections.length,
      failed: failedCount,
      unchecked: uncheckedCount
    })
    : null;
  const showOptOutNotice = Boolean(optOutMatch);
  const blockedRobotsPrompt = blockedRobotsConfirmation;
  const showBlockedRobotsNotice = Boolean(blockedRobotsPrompt);
  const scanLogCount =
    scanLog.reduce((count, result) => count + scanLogRowsForResult(result), 0) +
    (robotsStatus ? 1 : 0) +
    (optOutMatch ? 1 : 0);
  const showEmptyOutcome = hasStartedSearch && !hasCaptures && state !== "error";
  const isFinishedScopedScan =
    hasStartedSearch &&
    !isRunning &&
    state !== "error" &&
    state !== "loading-stored-scan" &&
    (scanScope === "recent" || scanScope === "custom") &&
    Boolean(targetUrl.trim()) &&
    progress.total > 0 &&
    uncheckedCount === 0 &&
    failedCount === 0;
  const canOfferFullScan =
    !isRunning &&
    state !== "loading-stored-scan" &&
    (scanScope === "recent" || scanScope === "custom") &&
    !optOutMatch &&
    (showEmptyOutcome || isFinishedScopedScan);
  const fullScanDescription =
    hasCaptures
      ? `This ${scanScope === "custom" ? "custom" : "recent"} scan is complete. A full scan checks the entire archive since ${earliestArchiveYear} and may find older snapshots.`
      : scanScope === "custom"
      ? `No snapshots were found in this date range. A full scan checks the entire archive since ${earliestArchiveYear} and may take much longer.`
      : `No snapshots were found in the last 12 months. A full scan checks the entire archive since ${earliestArchiveYear} and may take much longer.`;
  // When the scan is blocked and there is nothing to show below yet, the empty
  // outcome card becomes the home for the blocked explanation and primary action.
  const pausedBeforeAnyScan =
    scanSummary?.phase === "paused" && successfulCount === 0;
  const showBlockedRobotsEmptyOutcome = showEmptyOutcome && showBlockedRobotsNotice;
  const showBlockedRobotsBanner = showBlockedRobotsNotice && !showEmptyOutcome;
  const pausedReason = showBlockedRobotsNotice
    ? "Common Crawl is currently blocked for this URL. That does not necessarily mean it was always blocked: older scans may still have been allowed to check this URL."
    : scanNotice || undefined;
  const blockedRobotsAction = blockedRobotsPrompt ? (
    <Button
      className="shrink-0 whitespace-nowrap"
      size="sm"
      onClick={() => void executeRunSearch(blockedRobotsPrompt.mode, {
        session: blockedRobotsPrompt.session,
        precheckedRobotsStatus: blockedRobotsPrompt.robotsStatus,
        allowBlockedRobots: true
      })}
    >
      <Play size={14} />
      Start scan anyway
    </Button>
  ) : null;
  const appendUiScanLogEvent = (entry: ScanLogEvent) => {
    scanLogRef.current = [...scanLogRef.current, entry];
    setScanLog(scanLogRef.current);
    const trimmedUrl = targetUrl.trim();
    if (!trimmedUrl) return;
    void ensureScanSession({
      scanId: activeScanId || undefined,
      url: trimmedUrl,
      matchType,
      mock: initialMockMode,
      scope: scanScope,
      dateFrom: scanScope === "custom" ? customDateFrom : undefined,
      dateTo: scanScope === "custom" ? customDateTo : undefined,
      year: yearFilter,
      collection: collectionFilter,
      mime: mimeFilter,
      status: statusFilter,
      filter: urlFilter,
      sort: sortBy,
      view: viewMode,
      page: page > 1 ? page : undefined
    }).then((session) => appendCoverageScanLogEntry(session, entry));
  };
  const resultsBackContext = useMemo<ResultsBackContext>(
    () => ({
      url: targetUrl.trim(),
      match: matchType,
      mock: initialMockMode ? "1" : null,
      scope: scanScope,
      dateFrom: scanScope === "custom" ? customDateFrom : null,
      dateTo: scanScope === "custom" ? customDateTo : null,
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
      customDateFrom,
      customDateTo,
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
  const hasStatusActions =
    (state === "error" && Boolean(targetUrl.trim())) ||
    (!isRunning && (state === "paused" || isWaitingForAutoRetry)) ||
    canContinue ||
    canCheckNewCollections ||
    canRetryFailed ||
    canOfferFullScan ||
    showAutoRetryAction ||
    isRunning;
  const statusActionButtons = hasStartedSearch && hasStatusActions ? (
    <div className="flex shrink-0 flex-wrap justify-end gap-2">
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
      {canContinue ? (
        <Button size="sm" variant="secondary" onClick={() => void runSearch("resume")}>
          <RotateCcw size={14} />
          Continue
        </Button>
      ) : null}
      {canCheckNewCollections ? (
        <Button size="sm" variant="secondary" onClick={() => void runSearch("missing")}>
          <RotateCcw size={14} />
          Check new ({newCollectionCount})
        </Button>
      ) : null}
      {canRetryFailed ? (
        <Button size="sm" variant="secondary" onClick={() => void runSearch("retry-failed")}>
          <RotateCcw size={14} />
          Retry failed ({failedCount})
        </Button>
      ) : null}
      {canOfferFullScan && !showEmptyOutcome ? (
        <Button
          size="sm"
          variant="secondary"
          title={fullScanDescription}
          onClick={() => void runSearch("missing", { scope: "all", dateFrom: "", dateTo: "" })}
        >
          <Play size={14} />
          Run full scan
        </Button>
      ) : null}
      {showAutoRetryAction ? (
        <Button
          className="shrink-0 whitespace-nowrap"
          size="sm"
          title="Toggle automatic retry for failed and unchecked sources"
          onClick={() => {
            const enabled = !autoRetryEnabled;
            setAutoRetryEnabled(enabled);
            appendUiScanLogEvent(
              enabled
                ? scanLogEvent("auto-retry-enabled", "Auto retry started.", "amber")
                : scanLogEvent("auto-retry-disabled", "Auto retry stopped.", "amber")
            );
          }}
        >
          <Clock size={14} />
          {autoRetryEnabled ? `Auto retry ${autoRetryCountdown ? `in ${autoRetryCountdown}` : "on"}` : "Auto retry off"}
        </Button>
      ) : null}
      {isRunning ? (
        <Button variant="danger" size="sm" onClick={pauseScan}>
          <Pause size={14} />
          Pause
        </Button>
      ) : null}
    </div>
  ) : null;
  const headerStatusActions = hasStartedSearch && hasStatusActions ? (
    <div className="flex shrink-0 flex-wrap justify-end gap-2">
      {!isRunning && (state === "paused" || isWaitingForAutoRetry) ? (
        <Badge tone="amber" className="h-8 gap-1.5 px-3">
          <Clock size={12} />
          Paused
        </Badge>
      ) : null}
      {statusActionButtons}
    </div>
  ) : null;
  const emptyOutcomeActions = showBlockedRobotsEmptyOutcome ? blockedRobotsAction : statusActionButtons;

  useEffect(() => {
    const urlForTitle = autoStart ? (initialUrl || targetUrl) : "";
    document.title = buildTabTitle(stripUrlForTitle(urlForTitle));
  }, [autoStart, initialUrl, targetUrl]);

  useEffect(() => {
    if (!canScheduleAutoRetry) {
      if (nextAutoRetryAt) {
        appendUiScanLogEvent(scanLogEvent("auto-retry-skipped", "Auto retry skipped: no retryable work remains.", "amber"));
        loggedAutoRetryAtRef.current = undefined;
      }
      setNextAutoRetryAt(undefined);
      return;
    }
    if (!canAutoRetryFailed) return;

    const retryAt = nextAutoRetryAt ?? Date.now() + AUTO_RETRY_INTERVAL_MS;
    if (!nextAutoRetryAt) setNextAutoRetryAt(retryAt);
    if (loggedAutoRetryAtRef.current !== retryAt) {
      loggedAutoRetryAtRef.current = retryAt;
      appendUiScanLogEvent(
        scanLogEvent("auto-retry-scheduled", `Auto retry scheduled in ${formatSecondsAbbrev(retryAt - Date.now())}.`, "amber")
      );
    }
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
      clearAutoRetryState(trimmedUrl, matchType, initialMockMode, persistedScanScope, customDateFrom, customDateTo);
      return;
    }
    writeAutoRetryState(trimmedUrl, matchType, initialMockMode, persistedScanScope, customDateFrom, customDateTo, {
      enabled: autoRetryEnabled,
      nextRetryAt: nextAutoRetryAt
    });
  }, [
    autoRetryEnabled,
    canScheduleAutoRetry,
    customDateFrom,
    customDateTo,
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
    if ((!isRunning && !isPersistedScanRunning) || !scanStartedAt) return;
    const updateElapsed = () => setElapsedMs(storedDurationMs + Date.now() - scanStartedAt);
    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [isRunning, isPersistedScanRunning, scanStartedAt, storedDurationMs]);

  useEffect(() => {
    const trimmedUrl = targetUrl.trim();
    if (isStoredView) return;
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
  }, [captures, targetUrl, matchType, initialMockMode, isStoredView]);

  useEffect(() => {
    const trimmedUrl = targetUrl.trim();
    if (isStoredView) return;
    if (!trimmedUrl || scanLog.length === 0) return;
    const key = scanSearchKey(trimmedUrl, matchType, initialMockMode, persistedScanScope, {
      dateFrom: customDateFrom,
      dateTo: customDateTo
    });
    const legacyKeys =
      persistedScanScope === "custom" ? [] : [legacyScanSearchKey(trimmedUrl, matchType, initialMockMode, persistedScanScope)];
    const persistedCollections = collectionsForScope(collections, persistedScanScope, customDateFrom, customDateTo);
    const storedCollections = collectionsByIds(persistedCollections, activeCollectionIds);
    const storedMetadata = scanCollectionMetadata(persistedScanScope, storedCollections, customDateFrom, customDateTo);
    const activeDurationMs =
      isPersistedScanRunning && scanStartedAt
        ? storedDurationMs
        : elapsedMs || scanLogDurationMs(scanLog);
    const timer = window.setTimeout(() => {
      void (async () => {
        // The UI scan log only holds the entries of the current visit, so a
        // partial run (e.g. rescanning one new collection) must not shrink the
        // stored record. Coverage is the source of truth for what has been
        // checked; layer it over the log entries so the final per-collection
        // state wins.
        const coverage = await getCoverage(targetIdFor(trimmedUrl, matchType, initialMockMode));
        const storedCollectionIds = new Set(storedCollections.map((collection) => collection.id));
        const coverageScoped = coverageResults(coverage).filter((result) =>
          storedCollectionIds.has(result.collection.id)
        );
        const persistedResults = mergeCollectionResults(scanLog.filter(isCollectionScanLogEntry), coverageScoped);
        const persistedScanLog = mergePersistedScanLog(
          coverageScanLogResults(coverage),
          scanLog,
          storedCollections
        );
        const persistedDurationMs = persistedSearchDurationMs({
          isRunning: isPersistedScanRunning,
          activeDurationMs,
          storedDurationMs,
          coverage,
          persistedScanLog
        });
        await putSearch({
          key,
          url: trimmedUrl,
          matchType,
          mock: initialMockMode,
          scanScope: persistedScanScope,
          dateFrom: persistedScanScope === "custom" ? customDateFrom : undefined,
          dateTo: persistedScanScope === "custom" ? customDateTo : undefined,
          collections: storedCollections,
          collectionIds: storedMetadata.collectionIds,
          collectionListFetchedAt: storedMetadata.collectionListFetchedAt,
          scanWindowFrom: storedMetadata.scanWindowFrom,
          scanWindowTo: storedMetadata.scanWindowTo,
          captures,
          results: persistedResults,
          scanLogResults: persistedScanLog,
          durationMs: persistedDurationMs,
          activeScanStartedAt: isPersistedScanRunning ? scanStartedAt : undefined,
          updatedAt: Date.now()
        });
        await deleteSearches(legacyKeys);
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeCollectionIds, captures, collections, customDateFrom, customDateTo, elapsedMs, initialMockMode, isPersistedScanRunning, isStoredView, matchType, persistedScanScope, scanLog, scanStartedAt, storedDurationMs, targetUrl]);

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
        dateFrom: scanScope === "custom" ? customDateFrom : undefined,
        dateTo: scanScope === "custom" ? customDateTo : undefined,
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
    customDateFrom,
    customDateTo,
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
      id="top"
      className={
        hasStartedSearch
          ? "min-h-screen px-4 py-5 text-zinc-100 md:px-8"
          : "relative min-h-[100svh] text-zinc-100"
      }
    >
      {hasStartedSearch ? null : <LandingAtmosphere />}
      {hasStartedSearch ? null : <LandingHeroMenu />}
      {hasStartedSearch ? null : <LandingStatsFooter />}
      <div
        className={
          hasStartedSearch
            ? "mx-auto flex max-w-7xl flex-col gap-4"
            : "relative z-10 grid min-h-[100svh] w-full place-items-center px-4 py-8 md:px-8"
        }
      >
        {hasStartedSearch ? <h1 className="sr-only">Crawlback scan results</h1> : null}
        <header className={hasStartedSearch ? "archive-panel rounded-md p-4" : "w-full max-w-3xl p-0"}>
          <div className={hasStartedSearch ? "flex flex-col gap-4 lg:flex-row lg:items-end" : "flex flex-col gap-4"}>
            <div className="flex-1">
              <div className={hasStartedSearch ? "mb-3 flex items-center gap-3" : "mb-8 flex flex-col items-center gap-3 text-center"}>
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
                  </div>
                ) : null}
                {hasStartedSearch ? null : (
                  <>
                    <h1>
                      <BrandLockup
                        size="hero"
                        className="justify-center gap-5"
                        wordClassName="leading-none decode-in"
                      />
                    </h1>
                  </>
                )}
              </div>
              <div
                className={`flex gap-2${hasStartedSearch ? " flex-col sm:flex-row" : " flex-row reveal"}`}
                style={hasStartedSearch ? undefined : { animationDelay: "260ms" }}
                suppressHydrationWarning
              >
                {hasStartedSearch ? (
                  <div
                    aria-label="Scanned URL"
                    title={targetUrl}
                    className="flex h-11 w-full items-center overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
                  >
                    <span className="truncate font-mono">{targetUrl}</span>
                  </div>
                ) : (
                  <div className="flex-1">
                    <div className="relative">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-bold leading-none text-amber-300"
                      >
                        &gt;
                      </span>
                      <Input
                        ref={targetUrlInputRef}
                        aria-label="URL to search"
                        disabled={isRunning}
                        value={targetUrl}
                        placeholder="whitehouse.gov/administration"
                        autoComplete="off"
                        className="terminal-input pl-8 font-mono"
                        onChange={(event) => setTargetUrl(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void runSearch("fresh", { url: event.currentTarget.value, scope: scanScope });
                        }}
                      />
                    </div>
                  </div>
                )}
                {!hasStartedSearch ? (
                  <Button
                    className="h-11 shrink-0 whitespace-nowrap transition-transform hover:-translate-y-0.5 active:translate-y-0"
                    disabled={!canStartFresh}
                    onClick={() => void runSearch("fresh", { url: targetUrlInputRef.current?.value, scope: scanScope })}
                  >
                    <Play size={16} />
                    Start scan
                  </Button>
                ) : null}
              </div>
              {!hasStartedSearch ? (
                <div className="reveal" style={{ animationDelay: "380ms" }}>
                  <AdvancedSettings
                    open={advancedOpen}
                    onToggle={() => setAdvancedOpen((value) => !value)}
                    matchType={matchType}
                    onMatchTypeChange={setMatchType}
                    scope={scanScope}
                    onScopeChange={(value) => {
                      setActiveCollectionIds(undefined);
                      setScanScope(value);
                    }}
                    customDateFrom={customDateFrom}
                    customDateTo={customDateTo}
                    customRangeIssue={customRangeIssue}
                    onCustomDateFromChange={(value) => {
                      setActiveCollectionIds(undefined);
                      setCustomDateFrom(value);
                    }}
                    onCustomDateToChange={(value) => {
                      setActiveCollectionIds(undefined);
                      setCustomDateTo(value);
                    }}
                    disabled={isRunning}
                    earliestArchiveYear={earliestArchiveYear}
                  />
                </div>
              ) : null}
            </div>
            {hasStartedSearch ? (
              <div className="flex flex-col items-end gap-2 lg:w-[420px]">
                <TopRightMenu mode="inline" />
                <div className="flex h-11 w-full divide-x divide-zinc-800 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/60">
                  <Stat
                    label="Sources"
                    value={`${successfulCount}/${displayedSourceTotal}`}
                  />
                  <Stat label="Snapshots" value={String(captures.length)} tone={captures.length === 0 ? "neutral" : "green"} />
                  <Stat label="Failed" value={String(failedCount)} tone={failedCount > 0 ? "red" : "neutral"} />
                </div>
              </div>
            ) : null}
          </div>
          {hasStartedSearch ? (
            <div
              className="mt-4 h-2 overflow-hidden rounded-sm bg-zinc-900"
              role="progressbar"
              aria-label="Scan progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={completion}
            >
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
                aria-expanded={scanLogOpen}
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
                {showEmptyOutcome ? null : headerStatusActions}
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
          {showBlockedRobotsBanner ? (
            <div className="mt-3 flex flex-col gap-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-3xl">
                {pausedReason}
              </p>
              {blockedRobotsAction}
            </div>
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
                      {htmlZipDownload.parts && htmlZipDownload.parts > 1
                        ? ` · ZIP ${htmlZipDownload.part ?? 1}/${htmlZipDownload.parts}`
                        : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {htmlZipDownload.bytes ? formatBytes(htmlZipDownload.bytes) : "0 B"} exported
                      {htmlZipDownload.failed ? ` · ${htmlZipDownload.failed} failed` : ""}
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
                    onClick={() => void downloadCaptureExport(exportCaptures, exportColumns)}
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
                      onClick={requestHtmlZipDownload}
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
                  {/* Virtualized: renders the whole result set but only mounts
                      rows near the viewport (no client-side pagination needed). */}
                  <VirtualizedCaptureList
                    captures={filteredCaptures}
                    backContext={resultsBackContext}
                    scanId={activeScanId || undefined}
                  />
                </>
              )}
            </section>
          </section>
        ) : showEmptyOutcome && scanSummary ? (
          <EmptyScanOutcome
            summary={showBlockedRobotsEmptyOutcome ? { ...scanSummary, description: pausedReason } : scanSummary}
            isRunning={isRunning}
            canContinue={canContinue && !showBlockedRobotsEmptyOutcome}
            canRetryFailed={canRetryFailed && !showBlockedRobotsEmptyOutcome}
            canRunFullScan={canOfferFullScan && !showBlockedRobotsEmptyOutcome && !pausedBeforeAnyScan}
            fullScanDescription={
              canOfferFullScan && !showBlockedRobotsEmptyOutcome && !pausedBeforeAnyScan ? fullScanDescription : undefined
            }
            onRunFullScan={() => void runSearch("missing", { scope: "all", dateFrom: "", dateTo: "" })}
            actions={emptyOutcomeActions}
          />
        ) : null}
        {hasStartedSearch ? null : (
          <a
            href="#how-it-works"
            aria-label="Learn how Crawlback works"
            className="reveal-fade group absolute bottom-6 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border border-amber-300/55 bg-zinc-950/70 text-amber-200 shadow-[0_0_0_1px_rgba(250,204,21,0.12)] backdrop-blur-sm transition hover:border-amber-200 hover:bg-amber-300/10 hover:text-amber-100 hover:shadow-[0_0_0_1px_rgba(250,204,21,0.22)]"
            style={{ animationDelay: "700ms" }}
          >
            <span className="scroll-hint block">
              <ChevronDown size={30} strokeWidth={2.6} />
            </span>
          </a>
        )}
      </div>
      {hasStartedSearch ? null : <LandingSections />}
      {hasStartedSearch ? null : <LandingScrollTop />}
      {htmlZipWarningOpen ? (
        <HtmlPrivacyWarningDialog
          open={htmlZipWarningOpen}
          actionLabel="Download HTML ZIP"
          onCancel={() => setHtmlZipWarningOpen(false)}
          onContinue={({ dontShowAgain }) => {
            setHtmlZipWarningOpen(false);
            if (dontShowAgain) {
              setShowHtmlPrivacyWarning(false);
              void updateSettings({ showHtmlPrivacyWarning: false }).catch(() => undefined);
            }
            void downloadHtmlZip(exportCaptures);
          }}
        />
      ) : null}
    </main>
  );
}

function LandingHeroMenu() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setHidden(window.scrollY > Math.max(220, window.innerHeight * 0.42));
    };
    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  return (
    <div className={hidden ? "landing-hero-menu is-hidden" : "landing-hero-menu"}>
      <TopRightMenu />
    </div>
  );
}

function LandingScrollTop() {
  const [scrollState, setScrollState] = useState({
    progress: "0%",
    visible: false,
    nearEnd: false
  });

  useEffect(() => {
    let frame = 0;

    const updateScrollState = () => {
      frame = 0;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;

      setScrollState({
        progress: `${(ratio * 100).toFixed(2)}%`,
        visible: window.scrollY > 180,
        nearEnd: ratio > 0.9
      });
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateScrollState);
    };

    updateScrollState();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  return (
    <a
      href="#top"
      aria-label="Back to top"
      className={`landing-scroll-top${scrollState.visible ? " is-visible" : ""}${
        scrollState.nearEnd ? " is-near-end" : ""
      }`}
      style={{ "--scroll-progress": scrollState.progress } as CSSProperties}
    >
      <ArrowUp size={22} strokeWidth={2.4} aria-hidden />
    </a>
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
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 leading-none">
      <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <span className={`shrink-0 font-mono text-sm font-bold tabular-nums ${valueColor}`}>{value}</span>
    </div>
  );
}

type CuratedScanSummary = {
  phase: "loading" | "searching" | "paused" | "empty";
  title: string;
  description?: string;
};

function buildCuratedScanSummary(input: {
  state: SearchState;
  captures: number;
  checked: number;
  total: number;
  failed: number;
  unchecked: number;
}): CuratedScanSummary {
  if (input.state === "loading-stored-scan") {
    return {
      phase: "loading",
      title: "Loading",
      description: "Reading saved scan data from local history. Large histories can take a moment."
    };
  }

  if (input.state === "loading-collections" || input.state === "running") {
    return {
      phase: "searching",
      title: "Searching",
    };
  }

  if (input.state === "paused") {
    return {
      phase: "paused",
      title: "Scan paused",
    };
  }

  if (input.failed > 0 || input.unchecked > 0) {
    return {
      phase: "paused",
      title: "Scan paused",
    };
  }

  return {
    phase: "empty",
    title: input.captures === 0 ? "No snapshots found" : "Scan complete",
  };
}

function EmptyScanOutcome({
  summary,
  isRunning,
  canContinue,
  canRetryFailed,
  canRunFullScan,
  fullScanDescription,
  onRunFullScan,
  actions,
}: {
  summary: CuratedScanSummary;
  isRunning: boolean;
  canContinue: boolean;
  canRetryFailed: boolean;
  canRunFullScan: boolean;
  fullScanDescription?: string;
  onRunFullScan: () => void;
  actions?: ReactNode;
}) {
  const iconClass =
    summary.phase === "loading" || summary.phase === "searching"
      ? "mx-auto mb-3 animate-spin text-amber-200"
      : summary.phase === "paused"
        ? "mx-auto mb-3 text-amber-200"
        : "mx-auto mb-3 text-zinc-600";
  const Icon = summary.phase === "loading" || summary.phase === "searching" ? Loader2 : summary.phase === "paused" ? Clock : Ban;
  const isLoadingStoredScan = summary.phase === "loading";
  // While this section is on screen it is the single home for the scan's action
  // buttons: the header banner hands its `statusActions` down here (via `actions`)
  // so Continue/Retry/etc. aren't rendered twice. The full-scan offer stays local
  // to this card and only appears when there is nothing to resume or retry.
  const hasResumeAction = !isLoadingStoredScan && !isRunning && (canContinue || canRetryFailed);
  const fullScanAction = !isLoadingStoredScan && !hasResumeAction && !isRunning && canRunFullScan
    ? (
      <div className="mt-5 flex flex-col items-center gap-3">
        {fullScanDescription ? <p className="max-w-xl text-sm leading-relaxed text-zinc-400">{fullScanDescription}</p> : null}
        <Button type="button" onClick={onRunFullScan}>
          <Play size={16} />
          Run full scan across entire archive
        </Button>
      </div>
    )
    : null;

  return (
    <section className="archive-panel rounded-md p-6">
      <div className="mx-auto max-w-2xl text-center">
        <Icon className={iconClass} size={30} />
        <p className="text-lg font-black uppercase tracking-[0.16em] text-zinc-100">{summary.title}</p>
        {summary.description ? (
          <p className="mx-auto mt-3 max-w-4xl text-sm leading-relaxed text-zinc-400">{summary.description}</p>
        ) : null}
        {actions ? <div className="mt-5 flex justify-center">{actions}</div> : null}
        {fullScanAction}
      </div>
    </section>
  );
}

function scanLogCallMessage(call: CollectionAttemptLog, result: CollectionCheckResult) {
  const status = call.httpStatus ? `HTTP ${call.httpStatus}` : "No HTTP response";
  if (call.status === "not-checked") return `${status} · ${call.error ?? "not checked"}`;
  const cacheText = result.fromCache ? " · cache" : "";
  const captureCount = call.captureCount ?? result.captures.length;
  const blockedText =
    result.blockedCaptures && result.blockedCaptures.length > 0
      ? ` · ${result.blockedCaptures.length} blocked over viewer limit (${result.blockedCaptures
          .map((blocked) => `${formatBytes(blocked.sizeBytes)} / ${blocked.sizeBytes} bytes`)
          .join(", ")})`
      : "";
  if (captureCount > 0) {
    return `${status}${cacheText} · found ${captureCount} HTML capture${captureCount === 1 ? "" : "s"}${blockedText}`;
  }
  return `${status}${cacheText} · no matching HTML 200 capture`;
}

function scanLogCallTone(call: CollectionAttemptLog) {
  if (call.status === "not-checked") return "text-red-200";
  return call.captureCount && call.captureCount > 0 ? "text-emerald-200" : "text-zinc-500";
}

function scanLogRowsForResult(result: ScanLogEntry) {
  if (!isCollectionScanLogEntry(result)) return 1;
  return result.attemptLogs?.length ? result.attemptLogs.length : 1;
}

function scanLogTimestampsForResult(result: ScanLogEntry) {
  if (!isCollectionScanLogEntry(result)) return [result.checkedAt];
  return result.attemptLogs?.length
    ? result.attemptLogs.map((call) => call.checkedAt ?? result.checkedAt)
    : [result.checkedAt];
}

function scanLogEventTone(event: ScanLogEvent) {
  if (event.tone === "red") return "text-red-200";
  if (event.tone === "amber") return "text-amber-200";
  if (event.tone === "green") return "text-emerald-300";
  return "text-zinc-400";
}

type ScanLogRenderRow =
  | { kind: "collection"; result: CollectionCheckResult; call: CollectionAttemptLog; index: number; timestamp?: number; sequence: number }
  | { kind: "event"; event: ScanLogEvent; timestamp?: number; sequence: number }
  | { kind: "robots"; status: RobotsUiState; timestamp?: number; sequence: number }
  | { kind: "opt-out"; checkedAt?: number; cachedCount: number; timestamp?: number; sequence: number };

function scanLogRenderRows(input: {
  results: ScanLogEntry[];
  robotsStatus?: RobotsUiState | null;
  optOutMatch?: OptOutMatch | null;
  optOutCheckedAt?: number;
  optOutCachedCount: number;
}): ScanLogRenderRow[] {
  const rows: ScanLogRenderRow[] = [];
  let sequence = 0;
  if (input.optOutMatch) {
    rows.push({ kind: "opt-out", checkedAt: input.optOutCheckedAt, cachedCount: input.optOutCachedCount, timestamp: input.optOutCheckedAt, sequence: sequence++ });
  }
  let lastRobotsEventSequence: number | undefined;
  let lastRobotsEventTimestamp: number | undefined;
  for (const result of input.results) {
    if (!isCollectionScanLogEntry(result)) {
      const eventSequence = sequence++;
      rows.push({ kind: "event", event: result, timestamp: result.checkedAt, sequence: eventSequence });
      if (result.event === "robots-cached" || result.event === "robots-checked") {
        lastRobotsEventSequence = eventSequence;
        lastRobotsEventTimestamp = result.checkedAt;
      }
      continue;
    }
    const calls = result.attemptLogs?.length
      ? result.attemptLogs
      : [{
          status: result.status,
          checkedAt: result.checkedAt,
          httpStatus: result.httpStatus,
          error: result.error,
          errorKind: result.errorKind,
          captureCount: result.captures.length
        } satisfies CollectionAttemptLog];
    calls.forEach((call, index) => {
      rows.push({
        kind: "collection",
        result,
        call,
        index,
        timestamp: call.checkedAt ?? result.checkedAt,
        sequence: sequence++
      });
    });
  }
  if (input.robotsStatus) {
    rows.push({
      kind: "robots",
      status: input.robotsStatus,
      timestamp: lastRobotsEventTimestamp ?? input.robotsStatus.checkedAt,
      sequence: lastRobotsEventSequence == null ? -1 : lastRobotsEventSequence + 0.5
    });
  }
  return rows.sort((left, right) => {
    const leftTimestamp = left.timestamp ?? 0;
    const rightTimestamp = right.timestamp ?? 0;
    if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
    return left.sequence - right.sequence;
  });
}

function upsertLiveFailures(
  currentFailures: CollectionCheckResult[],
  result: CollectionCheckResult
): CollectionCheckResult[] {
  if (result.status === "checked") {
    return currentFailures.filter((failure) => failure.collection.id !== result.collection.id);
  }
  return upsertCollectionResult(currentFailures, result);
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

  const ipSuggestion =
    hasExplicitRateLimit || !hasSlowDown
      ? " If retries keep failing, try a different network or VPN — this IP may be rate-limited."
      : "";

  if (isWaitingForAutoRetry) {
    return `${issueText} The scan is paused to avoid hammering the API. Auto retry will check again automatically.${ipSuggestion}`;
  }

  return hasSlowDown
    ? `${issueText} Some snapshots may still work. Continue later to check failed and remaining items.`
    : `${issueText} The scan is still running. Continue later if needed.${ipSuggestion}`;
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
  results: ScanLogEntry[];
  robotsStatus?: RobotsUiState | null;
  optOutMatch?: OptOutMatch | null;
  optOutCheckedAt?: number;
  optOutCachedCount?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rows = scanLogRenderRows({ results, robotsStatus, optOutMatch, optOutCheckedAt, optOutCachedCount });
  const showDate = scanLogNeedsDate(rows.map((row) => row.timestamp));
  const rowCount = rows.length;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [rowCount]);

  return (
    <section className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/70">
      <div ref={scrollRef} className="max-h-64 overflow-auto thin-scrollbar">
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-zinc-500">No collections checked yet.</p>
        ) : (
          <div className="divide-y divide-zinc-900">
            {rows.map((row) => {
              if (row.kind === "robots") {
                return <RobotsScanLogEntry key={`robots:${row.timestamp ?? "unknown"}:${row.sequence}`} status={row.status} withDate={showDate} />;
              }
              if (row.kind === "opt-out") {
                return <OptOutScanLogEntry key={`opt-out:${row.timestamp ?? "unknown"}:${row.sequence}`} checkedAt={row.checkedAt} cachedCount={row.cachedCount} withDate={showDate} />;
              }
              if (row.kind === "event") {
                return <ScanLogEventEntry key={`${row.event.event}:${row.event.checkedAt ?? "unknown"}:${row.sequence}`} event={row.event} withDate={showDate} />;
              }
              return (
                <ScanLogCollectionEntry
                  key={`${row.result.collection.id}:${row.timestamp ?? "unknown"}:${row.index}:${row.sequence}`}
                  result={row.result}
                  call={row.call}
                  attemptIndex={row.index}
                  withDate={showDate}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function ScanLogEventEntry({ event, withDate }: { event: ScanLogEvent; withDate: boolean }) {
  return (
    <div className={scanLogRowClass(withDate)}>
      <p className="whitespace-nowrap font-mono text-[11px] text-zinc-500">{formatLogTimestamp(event.checkedAt, withDate)}</p>
      <p className="whitespace-nowrap font-semibold text-zinc-200">Scan</p>
      <p className={scanLogEventTone(event)}>{event.message}</p>
    </div>
  );
}

function ScanLogCollectionEntry({
  result,
  call,
  attemptIndex,
  withDate
}: {
  result: CollectionCheckResult;
  call: CollectionAttemptLog;
  attemptIndex: number;
  withDate: boolean;
}) {
  return (
    <div className={scanLogRowClass(withDate)}>
      <p className="whitespace-nowrap font-mono text-[11px] text-zinc-500">{formatLogTimestamp(call.checkedAt ?? result.checkedAt, withDate)}</p>
      <p className="whitespace-nowrap font-semibold text-zinc-200">{result.collection.id}</p>
      <p className={scanLogCallTone(call)}>{`${attemptLabel((call.attemptNumber ?? attemptIndex + 1) - 1)} · ${scanLogCallMessage(call, result)}`}</p>
    </div>
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
  scope,
  onScopeChange,
  customDateFrom,
  customDateTo,
  customRangeIssue,
  onCustomDateFromChange,
  onCustomDateToChange,
  disabled,
  earliestArchiveYear
}: {
  open: boolean;
  onToggle: () => void;
  matchType: MatchType;
  onMatchTypeChange: (value: MatchType) => void;
  scope: ScanScope;
  onScopeChange: (value: ScanScope) => void;
  customDateFrom: string;
  customDateTo: string;
  customRangeIssue: string | null;
  onCustomDateFromChange: (value: string) => void;
  onCustomDateToChange: (value: string) => void;
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
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 transition hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
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
            <div className="flex flex-col gap-1">
              <span id="advanced-match-type-label" className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
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
                  <button
                    type="button"
                    aria-label="What is mode?"
                    className="grid h-4 w-4 place-items-center rounded-full text-zinc-500 transition hover:text-zinc-200 focus:outline-none focus-visible:text-zinc-200"
                  >
                    <Info size={12} />
                  </button>
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
            </div>
            <div className="flex flex-col gap-1">
              <span id="advanced-scope-label" className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
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
                      <span className="mt-1 block">
                        <span className="font-semibold text-amber-200">Custom:</span> search only within your chosen date range.
                      </span>
                    </span>
                  }
                >
                  <button
                    type="button"
                    aria-label="What is scope?"
                    className="grid h-4 w-4 place-items-center rounded-full text-zinc-500 transition hover:text-zinc-200 focus:outline-none focus-visible:text-zinc-200"
                  >
                    <Info size={12} />
                  </button>
                </Tooltip>
              </span>
              <select
                aria-label="Scope"
                value={scope}
                disabled={disabled}
                onChange={(event) => onScopeChange(event.target.value as ScanScope)}
                className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm font-semibold text-zinc-100 outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="recent">last 12 months</option>
                <option value="all">full scan (entire archive, since {earliestArchiveYear})</option>
                <option value="custom">custom date range</option>
              </select>
            </div>
            {scope === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <DateControl
                  label="From"
                  value={customDateFrom}
                  onChange={onCustomDateFromChange}
                  max={customDateTo || undefined}
                  disabled={disabled}
                />
                <DateControl
                  label="To"
                  value={customDateTo}
                  onChange={onCustomDateToChange}
                  min={customDateFrom || undefined}
                  disabled={disabled}
                />
                {customRangeIssue ? (
                  <p className="sm:col-span-2 text-xs text-amber-200">{customRangeIssue}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
