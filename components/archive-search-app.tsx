"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Ban,
  CalendarDays,
  ChevronDown,
  Download,
  Clock,
  History as HistoryIcon,
  Info,
  List,
  Play,
  RotateCcw,
  Square,
  Terminal,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_MATCH_TYPE,
  fetchCollections,
  filterCollectionsByRecentMonths,
  isLikelyCommonCrawlAvailabilityIssue,
  isLikelyRateLimitError,
  searchUrlCoversTarget,
  searchCollections,
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
import { CaptureRow, CaptureRowHeader, type SortOption } from "@/components/capture-row";
import { CalendarView } from "@/components/calendar-view";
import { createMockSearchDataset, createMockWarcRecord, isMockCaptureFilename } from "@/lib/mock-data";
import { APP_NAME, buildTabTitle, stripUrlForTitle } from "@/lib/app-meta";
import { deleteSearches, getSearch, legacyScanSearchKey, legacyScanSearchKeys, listSearches, putSearch, scanSearchKey, searchKey, type StoredSearch } from "@/lib/capture-store";
import { dedupeCaptures, mergeCollectionResults, upsertCollectionResult } from "@/lib/scan-results";
import { fetchAndParseWarcRecord } from "@/lib/warc";
import { createZipBlob } from "@/lib/zip";

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
};

type ScanLockRecord = {
  ownerId: string;
  url: string;
  matchType: MatchType;
  scope: ScanScope;
  startedAt: number;
  expiresAt: number;
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

const SCAN_LOCK_NAME = "wayback-fallback:scan";
const SCAN_LOCK_KEY = "wayback-fallback:active-scan-lock";
const SCAN_LOCK_TTL_MS = 8000;
const SCAN_LOCK_HEARTBEAT_MS = 2000;
const AUTO_RETRY_INTERVAL_MS = 15 * 60 * 1000;

function compareCaptures(a: CommonCrawlCapture, b: CommonCrawlCapture, sort: SortOption) {
  switch (sort) {
    case "timestamp-desc":
      return b.timestamp.localeCompare(a.timestamp);
    case "timestamp-asc":
      return a.timestamp.localeCompare(b.timestamp);
    case "size-desc":
      return Number(b.length) - Number(a.length);
    case "size-asc":
      return Number(a.length) - Number(b.length);
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

function browserInitialParams(): ArchiveSearchInitialParams {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    url: params.get("url") ?? undefined,
    match: params.get("match") ?? undefined,
    scope: params.get("scope") ?? undefined,
    history: params.get("history") ?? undefined,
    action: params.get("action") ?? undefined,
    mock: params.get("mock") ?? undefined,
    year: params.get("year") ?? undefined,
    collection: params.get("collection") ?? undefined,
    mime: params.get("mime") ?? undefined,
    status: params.get("status") ?? undefined,
    filter: params.get("filter") ?? undefined,
    sort: params.get("sort") ?? undefined,
    view: params.get("view") ?? undefined,
    page: params.get("page") ?? undefined
  };
}

function resolveInitialParams(initialParams: ArchiveSearchInitialParams) {
  return Object.keys(initialParams).length > 0 ? initialParams : browserInitialParams();
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

function buildSearchHref(url: string, matchType: MatchType, scope: ScanScope) {
  const params = new URLSearchParams();
  params.set("match", matchType);
  if (scope === "all") params.set("scope", "all");
  params.set("url", url);
  return `/search?${params.toString()}`;
}

function buildMockSearchHref(url: string, matchType: MatchType) {
  const params = new URLSearchParams();
  params.set("mock", "1");
  params.set("match", matchType);
  params.set("url", url);
  return `/search?${params.toString()}`;
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

function capturesFromStoredRecords(records: StoredSearch[], activeCollections: CommonCrawlCollection[]) {
  const activeIds = new Set(activeCollections.map((collection) => collection.id));
  return dedupeCaptures(
    records
      .flatMap((record) => record.captures ?? [])
      .filter((capture) => activeIds.has(capture.collectionId))
  );
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

function downloadCaptureCsv(captures: CommonCrawlCapture[]) {
  const rows = [
    ["URL", "Collection", "WARC URL", "WARC Position"],
    ...captures.map((capture) => [
      capture.url,
      capture.collectionId,
      warcRecordUrl(capture.filename),
      `offset=${capture.offset};length=${capture.length}`
    ])
  ];
  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `common-crawl-results-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(objectUrl);
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

function newOwnerId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function getTabOwnerId() {
  return newOwnerId();
}

function readScanLock(now = Date.now()): ScanLockRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(SCAN_LOCK_KEY);
    if (!value) return null;
    const record = JSON.parse(value) as Partial<ScanLockRecord>;
    if (
      typeof record.ownerId !== "string" ||
      typeof record.url !== "string" ||
      (record.matchType !== "exact" && record.matchType !== "host" && record.matchType !== "domain") ||
      (record.scope !== "recent" && record.scope !== "all") ||
      typeof record.startedAt !== "number" ||
      typeof record.expiresAt !== "number"
    ) {
      window.localStorage.removeItem(SCAN_LOCK_KEY);
      return null;
    }
    if (record.expiresAt <= now) {
      window.localStorage.removeItem(SCAN_LOCK_KEY);
      return null;
    }
    return record as ScanLockRecord;
  } catch {
    window.localStorage.removeItem(SCAN_LOCK_KEY);
    return null;
  }
}

function writeScanLock(ownerId: string, context: { url: string; matchType: MatchType; scope: ScanScope }) {
  const now = Date.now();
  const record: ScanLockRecord = {
    ownerId,
    url: context.url,
    matchType: context.matchType,
    scope: context.scope,
    startedAt: now,
    expiresAt: now + SCAN_LOCK_TTL_MS
  };
  window.localStorage.setItem(SCAN_LOCK_KEY, JSON.stringify(record));
  return record;
}

function acquireLocalScanLock(ownerId: string, context: { url: string; matchType: MatchType; scope: ScanScope }) {
  const existing = readScanLock();
  if (existing && existing.ownerId !== ownerId) return false;
  writeScanLock(ownerId, context);
  return readScanLock()?.ownerId === ownerId;
}

function refreshLocalScanLock(ownerId: string, context: { url: string; matchType: MatchType; scope: ScanScope }, force = false) {
  const existing = readScanLock();
  if (!force && existing && existing.ownerId !== ownerId) return;
  writeScanLock(ownerId, context);
}

function releaseLocalScanLock(ownerId: string) {
  try {
    if (typeof window === "undefined") return;
    const value = window.localStorage.getItem(SCAN_LOCK_KEY);
    if (!value) return;
    const record = JSON.parse(value) as Partial<ScanLockRecord>;
    if (record.ownerId === ownerId) {
      window.localStorage.removeItem(SCAN_LOCK_KEY);
    }
  } catch {
    window.localStorage.removeItem(SCAN_LOCK_KEY);
  }
}

async function withSingleTabScanLock(
  ownerId: string,
  context: { url: string; matchType: MatchType; scope: ScanScope },
  task: () => Promise<void>
) {
  const runWithVisibleLease = async (forceInitialLease = false) => {
    refreshLocalScanLock(ownerId, context, forceInitialLease);
    const heartbeat = window.setInterval(
      () => refreshLocalScanLock(ownerId, context),
      SCAN_LOCK_HEARTBEAT_MS
    );
    try {
      await task();
    } finally {
      window.clearInterval(heartbeat);
      releaseLocalScanLock(ownerId);
    }
  };

  if (typeof navigator !== "undefined" && navigator.locks) {
    let acquired = false;
    await navigator.locks.request(SCAN_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      acquired = true;
      await runWithVisibleLease(true);
    });
    return acquired;
  }

  if (!acquireLocalScanLock(ownerId, context)) return false;
  await runWithVisibleLease();
  return true;
}

export function ArchiveSearchApp({
  autoStart = false,
  initialParams = {}
}: {
  autoStart?: boolean;
  initialParams?: ArchiveSearchInitialParams;
}) {
  const router = useRouter();
  const routeParams = resolveInitialParams(initialParams);
  const initialUrl = normalizeInitialUrl(routeParams.url ?? null);
  const initialMatchType = normalizeInitialMatchType(routeParams.match ?? null);
  const initialScanScope = normalizeInitialScanScope(routeParams.scope ?? null);
  const initialHistoryMode = routeParams.history === "1";
  const initialAction = routeParams.action;
  const initialMockMode = routeParams.mock === "1";
  const initialViewMode = normalizeInitialViewMode(routeParams.view ?? null);
  const initialSortBy = normalizeInitialSort(routeParams.sort ?? null);
  const initialPage = normalizeInitialPage(routeParams.page ?? null);
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
  const [persistedScanScope, setPersistedScanScope] = useState<ScanScope>(initialScanScope);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tabOwnerId, setTabOwnerId] = useState("");
  const [activeScanLock, setActiveScanLock] = useState<ScanLockRecord | null>(null);
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(true);
  const [nextAutoRetryAt, setNextAutoRetryAt] = useState<number | undefined>();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [htmlZipDownload, setHtmlZipDownload] = useState<HtmlZipDownloadState>({
    active: false,
    completed: 0,
    total: 0
  });
  const abortRef = useRef<AbortController | null>(null);
  const htmlZipAbortRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef(false);
  const filterResetMountedRef = useRef(false);

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

  async function loadStoredScan(url: string, activeMatchType: MatchType, activeScope: ScanScope) {
    const loadedCollections = collections.length > 0 ? collections : await fetchCollections();
    const activeCollections = collectionsForScope(loadedCollections, activeScope);
    const storedRecords = await getStoredScanVariants(url, activeMatchType, false, activeScope);
    const stored = storedRecords.reduce<StoredSearch | undefined>((latest, record) => {
      if (!latest || record.updatedAt > latest.updatedAt) return record;
      return latest;
    }, undefined);
    if (!stored) return false;

    const compatibleCaptureRecords = await getCompatibleStoredCaptureRecords(url, activeMatchType, false);
    const storedResults = mergeStoredScanRecords(storedRecords, activeCollections);
    const storedCaptures = dedupeCaptures([
      ...capturesFromStoredRecords(compatibleCaptureRecords, activeCollections),
      ...capturesFromResults(storedResults.filter((result) => result.status === "checked"))
    ]);
    const checkedIds = resultCollectionIds(storedResults);
    const failed = storedResults.filter((result) => result.status === "not-checked");
    const persistedAutoRetry = readAutoRetryState(url, activeMatchType, false, activeScope);

    setTargetUrl(url);
    setMatchType(activeMatchType);
    setScanScope(activeScope);
    setPersistedScanScope(activeScope);
    setCollections(loadedCollections);
    setCaptures(storedCaptures);
    setFailedResults(failed);
    setCheckedCollectionIds(checkedIds);
    setScanLog(storedResults);
    setScanLogOpen(true);
    setError("");
    setState("done");
    setScanStartedAt(stored?.updatedAt);
    setElapsedMs(0);
    setAutoRetryEnabled(persistedAutoRetry?.enabled ?? true);
    setNextAutoRetryAt(persistedAutoRetry?.nextRetryAt);
    setProgress({
      checked: checkedIds.size,
      total: activeCollections.length,
      hits: storedCaptures.length,
      failed: failed.length,
      activeCollections: []
    });
    return true;
  }

  function loadMockResults(options: { url?: string; matchType?: MatchType; syncRoute?: boolean } = {}) {
    abortRef.current?.abort();
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
    setScanLogOpen(true);
    setError("");
    setState("done");
    setScanStartedAt(Date.now() - 129000);
    setElapsedMs(129000);
    setAutoRetryEnabled(persistedAutoRetry?.enabled ?? true);
    setNextAutoRetryAt(persistedAutoRetry?.nextRetryAt);
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
    const url = (options.url ?? targetUrl).trim();
    const activeMatchType = options.matchType ?? matchType;
    const activeScope = options.scope ?? scanScope;
    if (!url) return;

    if (mode === "fresh") {
      const nextHref = buildSearchHref(url, activeMatchType, activeScope);
      const currentHref = `${window.location.pathname}${window.location.search}`;
      if (nextHref !== currentHref) {
        router.replace(nextHref);
        if (window.location.pathname !== "/search") return;
      }
    }

    const ownerId = tabOwnerId || getTabOwnerId();
    if (!tabOwnerId) setTabOwnerId(ownerId);
    const ran = await withSingleTabScanLock(ownerId, { url, matchType: activeMatchType, scope: activeScope }, async () => {
      setActiveScanLock(null);
      await executeRunSearch(mode, { url, matchType: activeMatchType, scope: activeScope });
    });
    if (!ran) {
      const currentLock = readScanLock();
      setActiveScanLock(currentLock);
      setError(formatScanLockError(currentLock));
    }
  }

  async function executeRunSearch(
    mode: RunSearchMode,
    options: { url: string; matchType: MatchType; scope: ScanScope }
  ) {
    const url = options.url;
    const activeMatchType = options.matchType;
    const activeScope = options.scope;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
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
      const loadedCollections = await loadCollectionsIfNeeded(controller);
      const activeCollections = collectionsForScope(loadedCollections, activeScope);
      const storedRecords = loadStoredForMode ? await getStoredScanVariants(url, activeMatchType, false, activeScope) : [];
      const compatibleCaptureRecords = loadStoredForMode
        ? await getCompatibleStoredCaptureRecords(url, activeMatchType, false)
        : [];
      const storedResults = loadStoredForMode ? mergeStoredScanRecords(storedRecords, activeCollections) : [];
      const storedCheckedResults = storedResults.filter((result) => result.status === "checked");
      const storedFailedResults = storedResults.filter((result) => result.status === "not-checked");
      const storedCheckedIds = resultCollectionIds(storedCheckedResults);
      const storedResultIds = resultCollectionIds(storedResults);
      let searchSet = activeCollections.filter((collection) => !storedCheckedIds.has(collection.id));

      if (mode === "resume") {
        searchSet = activeCollections.filter((collection) => !checkedCollectionIds.has(collection.id));
      } else if (mode === "missing") {
        searchSet = activeCollections.filter((collection) => !storedResultIds.has(collection.id));
      } else if (mode === "retry-failed") {
        const failedSource = loadStoredForMode
          ? storedFailedResults
          : failedResults.length > 0
            ? failedResults
            : scanLog.filter((result) => result.status === "not-checked");
        const failedIds = new Set(failedSource.map((result) => result.collection.id));
        searchSet = activeCollections.filter((collection) => failedIds.has(collection.id));
        setFailedResults((current) => current.filter((result) => !failedIds.has(result.collection.id)));
      } else if (mode === "auto-retry") {
        const failedSource = loadStoredForMode
          ? storedFailedResults
          : failedResults.length > 0
            ? failedResults
            : scanLog.filter((result) => result.status === "not-checked");
        const failedIds = new Set(failedSource.map((result) => result.collection.id));
        const attemptedIds = loadStoredForMode ? storedResultIds : checkedCollectionIds;
        searchSet = activeCollections.filter(
          (collection) => failedIds.has(collection.id) || !attemptedIds.has(collection.id)
        );
        setFailedResults((current) => current.filter((result) => !failedIds.has(result.collection.id)));
      }

      const initialResults = loadStoredForMode ? storedResults : [];
      const initialCaptures = loadStoredForMode
        ? dedupeCaptures([
            ...capturesFromStoredRecords(compatibleCaptureRecords, activeCollections),
            ...capturesFromResults(storedCheckedResults)
          ])
        : captures;
      const initialCheckedIds = loadStoredForMode ? storedResultIds : checkedCollectionIds;
      const initialFailedResults = loadStoredForMode ? storedFailedResults : failedResults;
      const rerunIds = new Set(searchSet.map((collection) => collection.id));
      const retainedFailedCount =
        mode === "retry-failed" || mode === "auto-retry"
          ? 0
          : initialFailedResults.filter((result) => !rerunIds.has(result.collection.id)).length;

      if (loadStoredForMode && storedResults.length > 0) {
        setCaptures(initialCaptures);
        setFailedResults(storedFailedResults);
        setCheckedCollectionIds(new Set(storedResultIds));
        setScanLog(storedResults);
        setScanLogOpen(true);
      }

      setProgress({
        checked: initialCheckedIds.size,
        total: activeCollections.length,
        hits: initialCaptures.length,
        failed: retainedFailedCount,
        activeCollections: []
      });

      if (searchSet.length === 0) {
        setState("done");
        return;
      }

      const baseCheckedIds = new Set(initialCheckedIds);
      const baseHitCount = initialCaptures.length;
      const runStatus: { stopReason: SearchStopReason } = { stopReason: "completed" };

      setState("running");

      await searchCollections({
        targetUrl: url,
        collections: searchSet,
        signal: controller.signal,
        matchType: activeMatchType,
        onResult: (result) => {
          baseCheckedIds.add(result.collection.id);
          setCheckedCollectionIds(new Set(baseCheckedIds));
          setScanLog((current) => upsertCollectionResult(current, result));
          if (result.captures.length > 0) {
            setCaptures((current) => dedupeCaptures([...current, ...result.captures]));
          }
          if (result.status === "not-checked") {
            setFailedResults((current) => upsertCollectionResult(current, result));
          } else {
            setFailedResults((current) => removeResult(current, result.collection.id));
          }
        },
        onProgress: (currentProgress) => {
          setProgress({
            ...currentProgress,
            checked: baseCheckedIds.size,
            total: activeCollections.length,
            hits: baseHitCount + currentProgress.hits,
            failed: retainedFailedCount + currentProgress.failed
          });
        },
        onStop: (reason) => {
          runStatus.stopReason = reason;
        }
      });

      if (controller.signal.aborted) {
        setState("cancelled");
      } else if (runStatus.stopReason === "circuit-breaker") {
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
      const entries: { filename: string; content: string }[] = [];
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
          : await fetchAndParseWarcRecord({
              filename: capture.filename,
              offset: capture.offset,
              length: capture.length,
              signal: controller.signal
            });

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
    const ownerId = getTabOwnerId();
    setTabOwnerId(ownerId);
    const refresh = () => {
      const currentLock = readScanLock();
      setActiveScanLock(currentLock?.ownerId === ownerId ? null : currentLock);
    };
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === SCAN_LOCK_KEY) refresh();
    };
    const releaseCurrentLock = () => releaseLocalScanLock(ownerId);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", releaseCurrentLock);
    const intervalId = window.setInterval(refresh, SCAN_LOCK_HEARTBEAT_MS);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", releaseCurrentLock);
      releaseCurrentLock();
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (initialMockMode && !autoStartedRef.current) {
      autoStartedRef.current = true;
      loadMockResults({
        url: initialUrl || "https://example.org/",
        matchType: initialMatchType ?? DEFAULT_MATCH_TYPE
      });
      return;
    }
    if (!autoStart || autoStartedRef.current || !initialUrl) return;
    autoStartedRef.current = true;
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
  }, [autoStart, initialUrl, initialMatchType, initialScanScope, initialHistoryMode, initialAction]);

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
  const uncheckedCount = Math.max(0, (scopedCollections.length || progress.total) - checkedCollectionIds.size);
  const foreignScanLock = activeScanLock && activeScanLock.ownerId !== tabOwnerId ? activeScanLock : null;
  const canResume = !isRunning && targetUrl.trim() && uncheckedCount > 0 && checkedCollectionIds.size > 0;
  const canStartFresh = !isRunning && targetUrl.trim() && !canResume;
  const hasStartedSearch =
    state !== "idle" ||
    progress.total > 0 ||
    checkedCollectionIds.size > 0 ||
    captures.length > 0 ||
    retryableFailedResults.length > 0;
  const hasCaptures = captures.length > 0;
  const completion = progress.total > 0 ? Math.round((progress.checked / progress.total) * 100) : 0;
  const canRetryFailed = !isRunning && retryableFailedResults.length > 0;
  const hasAutoRetryWork = availabilityIssue && (retryableFailedResults.length > 0 || uncheckedCount > 0);
  const canScheduleAutoRetry = !isRunning && Boolean(targetUrl.trim()) && hasAutoRetryWork;
  const canAutoRetryFailed = autoRetryEnabled && canScheduleAutoRetry;
  const autoRetryCountdown = nextAutoRetryAt ? formatDuration(nextAutoRetryAt - nowMs) : "";
  const showAutoRetryAction = !isRunning && hasAutoRetryWork;
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
  const lockNotice = foreignScanLock ? formatScanLockError(foreignScanLock) : "";
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

  return (
    <main
      className={
        hasStartedSearch
          ? "min-h-screen px-4 py-5 text-zinc-100 md:px-8"
          : "grid min-h-screen place-items-center px-4 py-8 text-zinc-100 md:px-8"
      }
    >
      <div className={hasStartedSearch ? "mx-auto flex max-w-7xl flex-col gap-4" : "mx-auto w-full max-w-3xl"}>
        <header className={hasStartedSearch ? "archive-panel rounded-md p-4" : "p-0"}>
          <div className={hasStartedSearch ? "flex flex-col gap-4 lg:flex-row lg:items-end" : "flex flex-col gap-4"}>
            <div className="flex-1">
              <div className={hasStartedSearch ? "mb-3 flex items-center gap-3" : "mb-8 flex flex-col items-center gap-4 text-center"}>
                {hasStartedSearch ? (
                  <div className="flex items-center gap-2">
                    <Link
                      href="/"
                      aria-label="Start a new search"
                      title="Start a new search"
                      className="grid h-10 w-10 place-items-center rounded-md border border-amber-300/40 bg-amber-300 text-zinc-950 transition hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    >
                      <Archive size={20} />
                    </Link>
                    <Link
                      href="/history"
                      aria-label="Open scan history"
                      title="Open scan history"
                      className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700 bg-zinc-950/70 text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    >
                      <HistoryIcon size={20} />
                    </Link>
                  </div>
                ) : null}
                <div>
                  <h1 className={hasStartedSearch ? "text-xl font-black uppercase tracking-[0.18em] text-zinc-50" : "text-4xl font-black uppercase tracking-[0.18em] text-zinc-50 sm:text-5xl"}>
                    {APP_NAME}
                  </h1>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row" suppressHydrationWarning>
                <Input
                  aria-label="URL to search"
                  disabled={isRunning}
                  value={targetUrl}
                  placeholder="https://example.com/page"
                  onChange={(event) => setTargetUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void runSearch("fresh", { scope: scanScope });
                  }}
                />
                {!hasStartedSearch ? (
                  <Button
                    className="h-11 shrink-0 whitespace-nowrap"
                    disabled={!canStartFresh}
                    onClick={() => void runSearch("fresh", { scope: scanScope })}
                  >
                    <Play size={16} />
                    Start scan
                  </Button>
                ) : null}
                {!hasStartedSearch ? (
                  <Link
                    href="/history"
                    className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
                  >
                    <HistoryIcon size={16} />
                    History
                  </Link>
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
                  value={`${progress.checked}/${progress.total || collections.length || "?"}`}
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
                Scan log ({scanLog.length})
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
          {lockNotice ? (
            <p className="mt-3 rounded-md border border-amber-300/30 bg-amber-300/10 p-2 text-xs leading-5 text-amber-100">
              {lockNotice}
            </p>
          ) : null}
          {hasStartedSearch && scanLogOpen ? <ScanLog results={scanLog} /> : null}
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
                  <p className="mt-1 text-xs text-amber-200">
                    Downloading HTML {htmlZipDownload.completed}/{htmlZipDownload.total}
                  </p>
                ) : htmlZipDownload.error ? (
                  <p className="mt-1 text-xs text-red-200">{htmlZipDownload.error}</p>
                ) : null}
                <div className="mt-3 grid gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={filteredCaptures.length === 0 || htmlZipDownload.active}
                    onClick={() => downloadCaptureCsv(filteredCaptures)}
                    className="justify-center"
                  >
                    <Download size={14} />
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
                      disabled={filteredCaptures.length === 0}
                      onClick={() => void downloadHtmlZip(filteredCaptures)}
                      className="justify-center"
                    >
                      <Download size={14} />
                      Download HTML ZIP
                    </Button>
                  )}
                </div>
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
                <CalendarView captures={filteredCaptures} backContext={resultsBackContext} />
              ) : (
                <>
                  <CaptureRowHeader sort={sortBy} onSortChange={setSortBy} />
                  <div className="divide-y divide-zinc-800/70">
                    {pagedCaptures.map((capture) => (
                      <CaptureRow
                        key={`${capture.collectionId}:${capture.timestamp}:${capture.filename}:${capture.offset}`}
                        capture={capture}
                        backContext={resultsBackContext}
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

function formatScanLockError(lock: ScanLockRecord | null) {
  if (!lock) return "A scan is already running in another tab. Wait until it finishes or cancel it there.";
  const target = stripUrlForTitle(lock.url);
  const scope = lock.scope === "all" ? "full scan" : "recent scan";
  return `A ${scope} is already running in another tab${target ? ` for ${target}` : ""}. Wait until it finishes or cancel it there.`;
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

function ScanLog({ results }: { results: CollectionCheckResult[] }) {
  return (
    <section className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/70">
      <div className="max-h-64 overflow-auto thin-scrollbar">
        {results.length === 0 ? (
          <p className="p-3 text-xs text-zinc-500">No collections checked yet.</p>
        ) : (
          <div className="divide-y divide-zinc-900">
            {results.map((result, index) => (
              <div
                key={`${result.collection.id}:${index}`}
                className="grid gap-2 px-3 py-2 text-xs text-zinc-400 sm:grid-cols-[170px_1fr]"
              >
                <p className="font-semibold text-zinc-200">{result.collection.id}</p>
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
