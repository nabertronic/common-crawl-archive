"use client";

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  History,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { BrandLockup } from "@/components/brand";
import { TopRightMenu } from "@/components/top-right-menu";
import { Button, LinkButton } from "@/components/ui/button";
import { DateControl } from "@/components/ui/date-control";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  deleteSearches,
  deleteCachedCaptureKeys,
  countCachedCaptureKeys,
  DEFAULT_HISTORY_PAGE_SIZE,
  getSettings,
  listHistorySummaries,
  listRecentHistorySummaries,
  normalizeScanUrl,
  scanSearchKey,
  searchCachedHtml,
  subscribeToSearchChanges,
  type AppSettings,
  type CachedHtmlSearchMatch,
  type HistorySummaryRecord
} from "@/lib/capture-store";
import {
  fetchCollections,
  filterCollectionsByDateRange,
  filterCollectionsByRecentMonths,
  type CommonCrawlCapture,
  type CommonCrawlCollection
} from "@/lib/common-crawl";
import { createViewerHref } from "@/lib/navigation-state";
import { markPerformance, measureAsync } from "@/lib/performance";
import { computeCsv } from "@/lib/compute-client";
import { toJsonText } from "@/lib/json-export";

type ScanScope = "recent" | "all" | "custom";
type ScanOutcome = "complete" | "partial" | "empty";
type SortKey = "status" | "url" | "scope" | "match" | "updated" | "captures" | "sources" | "failed";
type SortDir = "asc" | "desc";

type HistoryRecord = HistorySummaryRecord & {
  scanScope: ScanScope;
  storageKeys?: string[];
};

const HISTORY_GRID_CLASS = "history-grid";
const HISTORY_SELECT_COL_CLASS = "history-col-select";
const HISTORY_STATUS_COL_CLASS = "history-col-status";
const HISTORY_URL_COL_CLASS = "history-col-url";
const HISTORY_SCOPE_COL_CLASS = "history-col-scope";
const HISTORY_MATCH_COL_CLASS = "history-col-match";
const HISTORY_UPDATED_COL_CLASS = "history-col-updated";
const HISTORY_SNAPSHOTS_COL_CLASS = "history-col-snapshots";
const HISTORY_CACHED_COL_CLASS = "history-col-cached";
const HISTORY_SOURCES_COL_CLASS = "history-col-sources";
const HISTORY_FAILED_COL_CLASS = "history-col-failed";
const HISTORY_ACTIONS_COL_CLASS = "history-col-actions";
const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  status: "asc",
  url: "asc",
  scope: "asc",
  match: "asc",
  updated: "desc",
  captures: "desc",
  sources: "desc",
  failed: "desc"
};

function isBackForwardNavigation() {
  if (typeof performance === "undefined") return false;
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return navigation?.type === "back_forward";
}

export function HistoryApp() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [currentCollections, setCurrentCollections] = useState<CommonCrawlCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"any" | ScanScope>("any");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | ScanOutcome>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [cachedCountsByKey, setCachedCountsByKey] = useState<Record<string, number>>({});
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  // Once the full history has loaded, stop applying the fast first-page result
  // so it can never regress the complete list back to a partial one.
  const fullHistoryLoadedRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const scopeFilterRef = useRef<HTMLSelectElement | null>(null);
  const outcomeFilterRef = useRef<HTMLSelectElement | null>(null);
  const dateFromRef = useRef<HTMLInputElement | null>(null);
  const dateToRef = useRef<HTMLInputElement | null>(null);

  const syncRestoredControls = useCallback(() => {
    const restoredQuery = queryInputRef.current?.value ?? "";
    const restoredScope = scopeFilterRef.current?.value;
    const restoredOutcome = outcomeFilterRef.current?.value;
    const restoredDateFrom = dateFromRef.current?.value ?? "";
    const restoredDateTo = dateToRef.current?.value ?? "";

    setQuery((current) => (current === restoredQuery ? current : restoredQuery));
    if (restoredScope === "any" || restoredScope === "recent" || restoredScope === "all") {
      setScopeFilter((current) => (current === restoredScope ? current : restoredScope));
    }
    if (restoredOutcome === "all" || restoredOutcome === "complete" || restoredOutcome === "partial" || restoredOutcome === "empty") {
      setOutcomeFilter((current) => (current === restoredOutcome ? current : restoredOutcome));
    }
    setDateFrom((current) => (current === restoredDateFrom ? current : restoredDateFrom));
    setDateTo((current) => (current === restoredDateTo ? current : restoredDateTo));
  }, []);

  const clearFreshControls = useCallback(() => {
    setQuery("");
    setScopeFilter("any");
    setOutcomeFilter("all");
    setDateFrom("");
    setDateTo("");
    if (queryInputRef.current) queryInputRef.current.value = "";
    if (scopeFilterRef.current) scopeFilterRef.current.value = "any";
    if (outcomeFilterRef.current) outcomeFilterRef.current.value = "all";
    if (dateFromRef.current) dateFromRef.current.value = "";
    if (dateToRef.current) dateToRef.current.value = "";
  }, []);

  useEffect(() => {
    markPerformance("page-hydrated:history");
    void refreshRecords().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const refresh = () => scheduleRefresh();
    const syncOrClear = (restoreFromHistory: boolean) => {
      if (restoreFromHistory) {
        syncRestoredControls();
        return;
      }
      clearFreshControls();
    };
    const animationFrameId = window.requestAnimationFrame(() => syncOrClear(isBackForwardNavigation()));
    const timeoutId = window.setTimeout(() => syncOrClear(isBackForwardNavigation()), 100);
    const unsubscribe = subscribeToSearchChanges(refresh);
    const handlePageShow = (event: PageTransitionEvent) => {
      syncOrClear(event.persisted || isBackForwardNavigation());
      refresh();
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      window.removeEventListener("pageshow", handlePageShow);
      unsubscribe();
    };
  }, [clearFreshControls, syncRestoredControls]);

  async function refreshRecords() {
    // Fast first paint on large histories: render the most-recent page from the
    // owner_updatedAt index while the full list (needed for filter/sort/search/
    // export) loads. Guarded so it never overwrites the complete list once loaded.
    if (!fullHistoryLoadedRef.current) {
      void listRecentHistorySummaries(DEFAULT_HISTORY_PAGE_SIZE)
        .then((recent) => {
          if (!fullHistoryLoadedRef.current && recent.length > 0) {
            setRecords(mergeHistoryRecords(recent.filter(isHistoryRecord)));
            setLoading(false);
          }
        })
        .catch(() => undefined);
    }
    const [searches, collections, settings] = await measureAsync("history-refresh", () => Promise.all([
        listHistorySummaries(),
        fetchCollections().catch(() => [] as CommonCrawlCollection[]),
        getSettings().catch(() => null)
      ])
    );
    fullHistoryLoadedRef.current = true;
    setRecords(mergeHistoryRecords(searches.filter(isHistoryRecord)));
    setCurrentCollections(collections);
    setAppSettings(settings);
  }

  function scheduleRefresh(delayMs = 350) {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void runQueuedRefresh();
    }, delayMs);
  }

  async function runQueuedRefresh() {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    try {
      do {
        refreshQueuedRef.current = false;
        await refreshRecords();
      } while (refreshQueuedRef.current);
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  }

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const fromTimestamp = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined;
    const toTimestamp = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : undefined;

    return records.filter((record) => {
      if (scopeFilter !== "any" && record.scanScope !== scopeFilter) return false;
      if (outcomeFilter !== "all" && scanOutcome(record, currentCollections) !== outcomeFilter) return false;
      if (fromTimestamp !== undefined && record.updatedAt < fromTimestamp) return false;
      if (toTimestamp !== undefined && record.updatedAt > toTimestamp) return false;
      if (!normalizedQuery) return true;
      return record.url.toLowerCase().includes(normalizedQuery);
    });
  }, [currentCollections, dateFrom, dateTo, outcomeFilter, query, records, scopeFilter]);

  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((left, right) =>
      compareRecords(left, right, sortKey, sortDir, currentCollections)
    );
  }, [filteredRecords, sortKey, sortDir, currentCollections]);

  useEffect(() => {
    setPage(1);
  }, [query, scopeFilter, outcomeFilter, dateFrom, dateTo, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_SORT_DIR[key]);
    }
  }

  useEffect(() => {
    setSelectedKeys((current) => current.filter((key) => records.some((record) => record.key === key)));
  }, [records]);

  const pageSize = appSettings?.historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleRecords = useMemo(
    () => sortedRecords.slice(pageStart, pageStart + pageSize),
    [pageSize, pageStart, sortedRecords]
  );
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const allVisibleSelected =
    visibleRecords.length > 0 && visibleRecords.every((record) => selectedKeySet.has(record.key));
  const selectedRecords = useMemo(
    () => records.filter((record) => selectedKeySet.has(record.key)),
    [records, selectedKeySet]
  );
  const activeFilterCount = [
    scopeFilter !== "any",
    outcomeFilter !== "all",
    !!dateFrom,
    !!dateTo
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0 || query.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    async function loadCachedCounts() {
      const entries = await Promise.all(
        visibleRecords.map(async (record) => [record.key, await countCachedCaptureKeys(record.captureKeys ?? [])] as const)
      );
      if (!cancelled) {
        setCachedCountsByKey((current) => ({
          ...current,
          ...Object.fromEntries(entries)
        }));
      }
    }
    void loadCachedCounts();
    return () => {
      cancelled = true;
    };
  }, [visibleRecords]);

  function clearFilters() {
    setQuery("");
    setScopeFilter("any");
    setOutcomeFilter("all");
    setDateFrom("");
    setDateTo("");
  }

  function toggleRecordSelection(key: string, checked: boolean) {
    setSelectedKeys((current) => {
      if (checked) return current.includes(key) ? current : [...current, key];
      return current.filter((candidate) => candidate !== key);
    });
  }

  function toggleVisibleSelection(checked: boolean) {
    const visibleKeys = visibleRecords.map((record) => record.key);
    const visibleKeySet = new Set(visibleKeys);
    setSelectedKeys((current) => {
      if (checked) return Array.from(new Set([...current, ...visibleKeys]));
      return current.filter((key) => !visibleKeySet.has(key));
    });
  }

  async function handleDeleteRecord(record: HistoryRecord) {
    if (!window.confirm("Delete this saved scan?")) return;
    const deleteCache = record.captureCount > 0 && window.confirm("Also delete cached HTML files for this scan?");
    await deleteSearches(record.storageKeys ?? [record.key]);
    if (deleteCache) await deleteCachedCaptureKeys(record.captureKeys ?? []);
    await refreshRecords();
  }

  async function handleDeleteSelected() {
    if (selectedKeys.length === 0) return;
    if (!window.confirm(`Delete ${selectedKeys.length} selected saved scan${selectedKeys.length === 1 ? "" : "s"}?`)) return;
    const deleteCache = window.confirm("Also delete cached HTML files for the selected scans?");
    const selected = records.filter((record) => selectedKeys.includes(record.key));
    const keys = records
      .filter((record) => selectedKeys.includes(record.key))
      .flatMap((record) => record.storageKeys ?? [record.key]);
    await deleteSearches(Array.from(new Set(keys)));
    if (deleteCache) {
      await deleteCachedCaptureKeys(selected.flatMap((record) => record.captureKeys ?? []));
    }
    setSelectedKeys([]);
    await refreshRecords();
  }

  async function handleClearHistory() {
    if (records.length === 0) return;
    if (!window.confirm("Delete all saved scan history entries?")) return;
    const deleteCache = window.confirm("Also delete all cached HTML files referenced by history?");
    await deleteSearches(Array.from(new Set(records.flatMap((record) => record.storageKeys ?? [record.key]))));
    if (deleteCache) {
      await deleteCachedCaptureKeys(records.flatMap((record) => record.captureKeys ?? []));
    }
    setSelectedKeys([]);
    await refreshRecords();
  }

  return (
    <main className="min-h-screen px-4 py-5 text-zinc-100 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4" suppressHydrationWarning>
        <header className="archive-panel relative z-40 rounded-md p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Link
                href="/"
                aria-label="Start a new search"
                title="Start a new search"
                className="rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              >
                <BrandLockup className="translate-y-[1.5px]" wordClassName="text-xl leading-none" />
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl font-black uppercase leading-none tracking-[0.18em] text-zinc-50">
                  Scan history
                </h1>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <TopRightMenu
                mode="inline"
                items={[
                  { href: "/", label: "New Scan", icon: "search" },
                  { href: "/settings", label: "Settings", icon: "settings" }
                ]}
              />
            </div>
          </div>
        </header>

        <CachedHtmlSearchPanel />

        <section className="archive-panel rounded-md p-4">
          <div className="flex flex-col gap-2 lg:flex-row">
            <label className="relative flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                size={16}
              />
              <Input
                ref={queryInputRef}
                type="search"
                aria-label="Search history"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by URL"
                className="pl-10"
              />
            </label>
            <Button
              type="button"
              variant={filtersOpen || activeFilterCount > 0 ? "primary" : "secondary"}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal size={16} />
              Filters
              {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
            </Button>
            {hasActiveFilters ? (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                <X size={16} />
                Clear
              </Button>
            ) : null}
          </div>

          {filtersOpen ? (
            <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-2 lg:grid-cols-5">
              <SelectControl
                label="Scope"
                selectRef={scopeFilterRef}
                value={scopeFilter}
                onChange={(value) => setScopeFilter(value as "any" | ScanScope)}
                options={[
                  ["any", "All scopes"],
                  ["recent", "Recent"],
                  ["all", "Full"],
                  ["custom", "Custom"]
                ]}
              />
              <SelectControl
                label="Outcome"
                selectRef={outcomeFilterRef}
                value={outcomeFilter}
                onChange={(value) => setOutcomeFilter(value as "all" | ScanOutcome)}
                options={[
                  ["all", "All outcomes"],
                  ["complete", "Complete"],
                  ["partial", "Partial"],
                  ["empty", "No snapshots"]
                ]}
              />
              <DateControl label="From" inputRef={dateFromRef} value={dateFrom} onChange={setDateFrom} />
              <DateControl label="To" inputRef={dateToRef} value={dateTo} onChange={setDateTo} />
            </div>
          ) : null}
        </section>

        <section className="archive-panel rounded-md">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 p-4">
            <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(event) => toggleVisibleSelection(event.target.checked)}
                aria-label="Select visible history entries"
                className="h-4 w-4 accent-amber-300"
              />
              Select visible
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {selectedKeys.length > 0 ? (
                <span className="text-xs text-zinc-500">{selectedKeys.length} selected</span>
              ) : null}
              <div className="inline-flex overflow-hidden rounded-md border border-zinc-700" role="group" aria-label="Export format">
                {(["csv", "json"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    aria-pressed={exportFormat === format}
                    onClick={() => setExportFormat(format)}
                    className={`h-8 px-2.5 text-xs font-semibold uppercase tracking-wide transition ${
                      exportFormat === format
                        ? "bg-amber-300/10 text-amber-200"
                        : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {format}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selectedRecords.length === 0}
                onClick={() => void downloadHistoryExport(selectedRecords, "selected", exportFormat)}
                suppressHydrationWarning
              >
                <Download size={14} />
                Export selected
              </Button>
              {hasActiveFilters ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={sortedRecords.length === 0}
                  onClick={() => void downloadHistoryExport(sortedRecords, "filtered", exportFormat)}
                  suppressHydrationWarning
                >
                  <Download size={14} />
                  Export view
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={records.length === 0}
                onClick={() => void downloadHistoryExport(records, "all", exportFormat)}
                suppressHydrationWarning
              >
                <Download size={14} />
                Export all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={selectedRecords.length === 0}
                onClick={() => void handleDeleteSelected()}
                suppressHydrationWarning
              >
                <Trash2 size={14} />
                Delete selected
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={records.length === 0}
                onClick={() => void handleClearHistory()}
                suppressHydrationWarning
              >
                <Trash2 size={14} />
                Clear history
              </Button>
            </div>
          </div>

          {loading ? (
            <EmptyState text="Loading local history..." />
          ) : records.length === 0 ? (
            <EmptyState text="No saved scans yet." />
          ) : sortedRecords.length === 0 ? (
            <EmptyState text="No scans match the current filters." />
          ) : (
            <>
              <div>
                <div className={`${HISTORY_GRID_CLASS} border-b border-zinc-800 px-4 py-3`}>
                  <span className={HISTORY_SELECT_COL_CLASS} />
                  <div className={HISTORY_STATUS_COL_CLASS}>
                    <SortHeader label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  </div>
                  <div className={HISTORY_URL_COL_CLASS}>
                    <SortHeader label="URL" sortKey="url" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  </div>
                  <div className={HISTORY_SCOPE_COL_CLASS}>
                    <SortHeader label="Scope" sortKey="scope" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  </div>
                  <div className={HISTORY_MATCH_COL_CLASS}>
                    <SortHeader label="Match" sortKey="match" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  </div>
                  <div className={HISTORY_UPDATED_COL_CLASS}>
                    <SortHeader label="Updated" sortKey="updated" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  </div>
                  <div className={HISTORY_SNAPSHOTS_COL_CLASS}>
                    <SortHeader label="Snapshots" sortKey="captures" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                  </div>
                  <span className={`${HISTORY_CACHED_COL_CLASS} text-right text-xs font-bold uppercase tracking-[0.14em] text-zinc-500`}>Cached</span>
                  <div className={HISTORY_SOURCES_COL_CLASS}>
                    <SortHeader label="Sources" sortKey="sources" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                  </div>
                  <div className={HISTORY_FAILED_COL_CLASS}>
                    <SortHeader label="Failed" sortKey="failed" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                  </div>
                  <span className={`${HISTORY_ACTIONS_COL_CLASS} text-right text-xs font-bold uppercase tracking-[0.14em] text-zinc-500`}>Actions</span>
                </div>
                <div className="divide-y divide-zinc-800/70">
                  {visibleRecords.map((record) => (
                    <HistoryRow
                      key={record.key}
                      record={record}
                      currentCollections={currentCollections}
                      selected={selectedKeySet.has(record.key)}
                      cachedCount={cachedCountsByKey[record.key] ?? 0}
                      onSelectedChange={toggleRecordSelection}
                      onDelete={handleDeleteRecord}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 p-4 text-xs text-zinc-400">
                <p>
                  {sortedRecords.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + pageSize, sortedRecords.length)} of{" "}
                  {sortedRecords.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={currentPage === 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    Prev
                  </Button>
                  <span className="min-w-20 text-center">
                    {currentPage}/{totalPages}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={currentPage === totalPages}
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function HistoryRow({
  record,
  currentCollections,
  selected,
  cachedCount,
  onSelectedChange,
  onDelete
}: {
  record: HistoryRecord;
  currentCollections: CommonCrawlCollection[];
  selected: boolean;
  cachedCount: number;
  onSelectedChange: (key: string, checked: boolean) => void;
  onDelete: (record: HistoryRecord) => Promise<void>;
}) {
  const parsed = tryParseUrl(record.url);
  const host = parsed?.hostname ?? record.url;
  const path = parsed ? `${parsed.pathname}${parsed.search}` : "";
  const outcome = scanOutcome(record, currentCollections);
  const sourceStats = sourceCounts(record, currentCollections);
  const newCount = newCollectionsFor(record, currentCollections).length;
  const openHref = searchHref(record, newCount > 0 ? "missing" : undefined);
  const checkNewHref = searchHref(record, "missing");
  const retryFailedHref = searchHref(record, "retry-failed");
  const hasCache = cachedCount > 0;

  const labelClass = "hidden lg:inline";
  const buttonClass = "w-8 px-0 lg:w-auto lg:px-3";

  return (
    <>
    <article className={`${HISTORY_GRID_CLASS} px-4 py-3 text-sm transition hover:bg-zinc-900/45`}>
      <label className={HISTORY_SELECT_COL_CLASS}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(record.key, event.target.checked)}
          aria-label={`Select saved scan for ${record.url}`}
          className="h-4 w-4 accent-amber-300"
        />
      </label>
      <div className={HISTORY_STATUS_COL_CLASS}>
        <div className="flex flex-nowrap items-center gap-1">
          <Badge tone={outcome === "complete" ? "green" : outcome === "partial" ? "amber" : "neutral"}>
            {outcome}
          </Badge>
          {newCount > 0 ? <NewCollectionsBadge count={newCount} /> : null}
        </div>
      </div>
      <div className={`${HISTORY_URL_COL_CLASS} min-w-0`}>
        <p className="truncate text-sm font-bold text-zinc-50" title={record.url}>
          {host}
        </p>
        {path && path !== "/" ? (
          <p className="mt-0.5 truncate text-xs text-zinc-500" title={path}>
            {path}
          </p>
        ) : null}
      </div>
      <span className={`${HISTORY_SCOPE_COL_CLASS} truncate text-xs text-zinc-400`}>
        {record.scanScope === "all" ? "full" : record.scanScope === "custom" ? "custom" : "recent"}
      </span>
      <span className={`${HISTORY_MATCH_COL_CLASS} truncate text-xs text-zinc-400`}>{record.matchType}</span>
      <time className={`${HISTORY_UPDATED_COL_CLASS} truncate text-xs text-zinc-500`} title={formatDateTime(record.updatedAt)}>
        {formatDate(record.updatedAt)}
      </time>
      <div className={HISTORY_SNAPSHOTS_COL_CLASS}>
        <Metric value={String(record.captureCount)} tone={record.captureCount > 0 ? "green" : "neutral"} />
      </div>
      <div className={`${HISTORY_CACHED_COL_CLASS} text-right`}>
        <p className={`font-mono text-sm font-bold tabular-nums ${hasCache ? "text-emerald-200" : "text-zinc-200"}`}>
          {cachedCount}/{record.captureCount}
        </p>
      </div>
      <div className={HISTORY_SOURCES_COL_CLASS}>
        <Metric value={`${sourceStats.processed}/${sourceStats.total}`} tone={sourceStats.missing > 0 ? "red" : "neutral"} />
      </div>
      <div className={HISTORY_FAILED_COL_CLASS}>
        <Metric value={String(sourceStats.failed)} tone={sourceStats.failed > 0 ? "red" : "neutral"} />
      </div>
      <div className={`${HISTORY_ACTIONS_COL_CLASS} flex min-w-0 items-center justify-end gap-1 overflow-hidden`}>
        {newCount > 0 ? (
          <LinkButton href={checkNewHref} size="sm" variant="secondary" title="Check new collections" aria-label="Check new collections" className={buttonClass}>
            <RotateCcw size={14} />
            <span className={labelClass}>New</span>
          </LinkButton>
        ) : null}
        {sourceStats.failed > 0 ? (
          <LinkButton href={retryFailedHref} size="sm" variant="secondary" title="Retry failed collections" aria-label="Retry failed collections" className={buttonClass}>
            <RotateCcw size={14} />
            <span className={labelClass}>Retry</span>
          </LinkButton>
        ) : null}
        <LinkButton href={openHref} size="sm" variant="primary" title="Open" aria-label="Open" className={buttonClass}>
          <ExternalLink size={14} />
          <span className={labelClass}>Open</span>
        </LinkButton>
        <Button type="button" size="sm" variant="danger" aria-label="Delete saved scan" title="Delete" onClick={() => void onDelete(record)} className={buttonClass}>
          <Trash2 size={14} />
          <span className={labelClass}>Delete</span>
        </Button>
      </div>
    </article>
    </>
  );
}

function NewCollectionsBadge({ count }: { count: number }) {
  const title = count === 1 ? "New Collection Available" : `${count} New Collections Available`;
  const description =
    count === 1
      ? "Open this scan and search again to include the new Common Crawl collection."
      : "Open this scan and search again to include the new Common Crawl collections.";
  return (
    <Tooltip
      side="bottom"
      content={
        <span className="block">
          <span className="block font-semibold text-red-100">{title}</span>
          <span className="mt-1 block text-zinc-300">{description}</span>
        </span>
      }
      className="left-0 w-72 translate-x-0 whitespace-normal text-left normal-case tracking-normal"
      arrowClassName="left-3 translate-x-0"
    >
      <Badge
        tone="red"
        tabIndex={0}
        aria-label={`${title}. ${description}`}
        className="h-6 w-6 justify-center px-0"
      >
        <CircleAlert size={14} aria-hidden="true" />
      </Badge>
    </Tooltip>
  );
}

function Metric({
  value,
  tone = "neutral"
}: {
  value: string;
  tone?: "neutral" | "green" | "red";
}) {
  const color = tone === "green" ? "text-emerald-200" : tone === "red" ? "text-red-200" : "text-zinc-200";
  return (
    <p className={`text-right font-mono text-sm font-bold tabular-nums ${color}`}>{value}</p>
  );
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = "left"
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = currentKey === sortKey;
  const justify = align === "right" ? "justify-end" : "justify-start";
  const color = active ? "text-amber-300" : "text-zinc-500 hover:text-zinc-300";
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`group flex w-full items-center gap-1 p-0 text-xs font-bold uppercase tracking-[0.14em] transition ${justify} ${color}`}
    >
      <span>{label}</span>
      {active ? (
        currentDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
      ) : (
        <ChevronsUpDown size={11} className="opacity-40 group-hover:opacity-70" />
      )}
    </button>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  options,
  fullValueOptions,
  selectRef
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  fullValueOptions?: { value: string; label: string }[];
  selectRef?: RefObject<HTMLSelectElement | null>;
}) {
  const renderedOptions = fullValueOptions ?? options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }));
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <select
        ref={selectRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-amber-300"
      >
        {renderedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid min-h-80 place-items-center p-8 text-center">
      <div>
        <History className="mx-auto mb-3 text-zinc-500" size={30} />
        <p className="font-semibold text-zinc-300">{text}</p>
      </div>
    </div>
  );
}

function isHistoryRecord(record: HistorySummaryRecord): record is HistoryRecord {
  return (
    !record.mock &&
    (record.scanScope === "recent" || record.scanScope === "all" || record.scanScope === "custom")
  );
}

function mergeHistoryRecords(records: HistoryRecord[]) {
  const byScan = new Map<string, HistoryRecord>();
  for (const record of records) {
    // Match by normalized URL so records saved before URL normalization
    // ("hutt.io") merge with their canonical twin ("https://hutt.io/").
    const identity = `${record.matchType}:${normalizeScanUrl(record.url)}:${record.scanScope}:${record.dateFrom ?? ""}:${record.dateTo ?? ""}`;
    const current = byScan.get(identity);
    if (!current) {
      byScan.set(identity, {
        ...record,
        key: scanSearchKey(record.url, record.matchType, record.mock, record.scanScope, {
          dateFrom: record.dateFrom,
          dateTo: record.dateTo
        }),
        storageKeys: [record.key]
      });
      continue;
    }

    const mergedScope: ScanScope =
      current.scanScope === "all" || record.scanScope === "all"
        ? "all"
        : current.scanScope === "custom" || record.scanScope === "custom"
          ? "custom"
          : "recent";
    const mergedCollections =
      record.scanScope === "all"
        ? record.collections ?? current.collections
        : current.collections ?? record.collections;
    // Anchor the saved-collection list on the record with the most checked
    // results; a sparse record (e.g. an interrupted re-scan) may carry a
    // frozen list that already includes newer collections and would hide the
    // "new collections available" hint.
    const checkedCount = (entry: HistoryRecord) => entry.sourceProcessed - entry.failedCount;
    const coverageAnchor = checkedCount(record) > checkedCount(current) ? record : current;
    const captureKeys = Array.from(new Set([...(current.captureKeys ?? []), ...(record.captureKeys ?? [])]));
    byScan.set(identity, {
      ...current,
      key: scanSearchKey(record.url, record.matchType, record.mock, mergedScope, {
        dateFrom: record.dateFrom ?? current.dateFrom,
        dateTo: record.dateTo ?? current.dateTo
      }),
      scanScope: mergedScope,
      dateFrom: record.dateFrom ?? current.dateFrom,
      dateTo: record.dateTo ?? current.dateTo,
      collections: mergedCollections,
      collectionIds:
        coverageAnchor.collectionIds ??
        coverageAnchor.collections?.map((collection) => collection.id) ??
        mergedCollections?.map((collection) => collection.id),
      collectionListFetchedAt: Math.max(current.collectionListFetchedAt ?? 0, record.collectionListFetchedAt ?? 0) || undefined,
      scanWindowFrom: current.scanWindowFrom ?? record.scanWindowFrom,
      scanWindowTo: current.scanWindowTo ?? record.scanWindowTo,
      captureCount: Math.max(current.captureCount, record.captureCount, captureKeys.length),
      captureKeys,
      sourceTotal: Math.max(current.sourceTotal, record.sourceTotal),
      sourceProcessed: Math.max(current.sourceProcessed, record.sourceProcessed),
      failedCount: Math.max(current.failedCount, record.failedCount),
      durationMs: Math.max(current.durationMs ?? 0, record.durationMs ?? 0) || undefined,
      activeScanStartedAt: current.activeScanStartedAt ?? record.activeScanStartedAt,
      updatedAt: Math.max(current.updatedAt, record.updatedAt),
      storageKeys: Array.from(new Set([...(current.storageKeys ?? [current.key]), record.key]))
    });
  }
  return Array.from(byScan.values());
}

function activeCollectionsFor(record: HistoryRecord, currentCollections: CommonCrawlCollection[]) {
  if (record.collections?.length) return record.collections;
  if (record.collectionIds?.length && currentCollections.length > 0) {
    const ids = new Set(record.collectionIds);
    return currentCollections.filter((collection) => ids.has(collection.id));
  }
  if (currentCollections.length > 0) {
    if (record.scanScope === "all") return currentCollections;
    if (record.scanScope === "custom" && record.dateFrom && record.dateTo) {
      return filterCollectionsByDateRange(currentCollections, record.dateFrom, record.dateTo);
    }
    return filterCollectionsByRecentMonths(currentCollections);
  }
  return record.collections ?? [];
}

function currentCollectionsFor(record: HistoryRecord, currentCollections: CommonCrawlCollection[]) {
  if (record.scanScope === "recent" || currentCollections.length === 0) return [];
  if (record.scanScope === "custom" && record.dateFrom && record.dateTo) {
    return filterCollectionsByDateRange(currentCollections, record.dateFrom, record.dateTo);
  }
  return record.scanScope === "all" ? currentCollections : [];
}

function savedCollectionIds(record: HistoryRecord) {
  return new Set([
    ...(record.collectionIds ?? []),
    ...(record.collections ?? []).map((collection) => collection.id)
  ]);
}

function newCollectionsFor(record: HistoryRecord, currentCollections: CommonCrawlCollection[]) {
  const savedIds = savedCollectionIds(record);
  if (savedIds.size === 0) return [];
  return currentCollectionsFor(record, currentCollections).filter((collection) => !savedIds.has(collection.id));
}

function sourceCounts(record: HistoryRecord, currentCollections: CommonCrawlCollection[]) {
  const activeCollections = activeCollectionsFor(record, currentCollections);
  const total = activeCollections.length || record.sourceTotal;
  const processed = Math.min(record.sourceProcessed, total);
  const failed = Math.min(record.failedCount, processed);
  return {
    total,
    processed,
    failed,
    missing: Math.max(0, total - processed)
  };
}

function failedCount(record: HistoryRecord, currentCollections: CommonCrawlCollection[] = []) {
  return sourceCounts(record, currentCollections).failed;
}

function scanOutcome(record: HistoryRecord, currentCollections: CommonCrawlCollection[] = []): ScanOutcome {
  const counts = sourceCounts(record, currentCollections);
  if (counts.failed > 0 || counts.missing > 0) return "partial";
  if (record.captureCount > 0) return "complete";
  return "empty";
}

function compareRecords(
  left: HistoryRecord,
  right: HistoryRecord,
  sortKey: SortKey,
  sortDir: SortDir,
  currentCollections: CommonCrawlCollection[]
) {
  const sign = sortDir === "asc" ? 1 : -1;
  let cmp = 0;
  switch (sortKey) {
    case "status":
      cmp = scanOutcome(left, currentCollections).localeCompare(scanOutcome(right, currentCollections));
      break;
    case "url":
      cmp = left.url.localeCompare(right.url);
      break;
    case "scope":
      cmp = left.scanScope.localeCompare(right.scanScope);
      break;
    case "match":
      cmp = left.matchType.localeCompare(right.matchType);
      break;
    case "captures":
      cmp = left.captureCount - right.captureCount;
      break;
    case "sources": {
      const ls = sourceCounts(left, currentCollections);
      const rs = sourceCounts(right, currentCollections);
      const lr = ls.total > 0 ? ls.processed / ls.total : 0;
      const rr = rs.total > 0 ? rs.processed / rs.total : 0;
      cmp = lr - rr;
      break;
    }
    case "failed":
      cmp = failedCount(left, currentCollections) - failedCount(right, currentCollections);
      break;
    case "updated":
    default:
      cmp = left.updatedAt - right.updatedAt;
  }
  if (cmp === 0) cmp = left.updatedAt - right.updatedAt;
  return cmp * sign;
}

function searchHref(record: HistoryRecord, action?: "missing" | "retry-failed") {
  const params = new URLSearchParams();
  params.set("match", record.matchType);
  params.set("url", record.url);
  if (action) params.set("action", action);
  params.set("saved", (record.storageKeys ?? [record.key]).join(","));
  if (record.scanScope === "all" || record.scanScope === "custom") params.set("scope", record.scanScope);
  if (record.dateFrom) params.set("from", record.dateFrom);
  if (record.dateTo) params.set("to", record.dateTo);
  params.set("history", "1");
  return `/search?${params.toString()}`;
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(timestamp);
}

function viewerHrefForMatch(match: CachedHtmlSearchMatch): string {
  const capture: CommonCrawlCapture = {
    collectionId: match.collectionId ?? "",
    collectionName: "",
    collectionFrom: "",
    collectionTo: "",
    timestamp: match.timestamp ?? "",
    url: match.url ?? "",
    status: match.status ?? "",
    mime: match.mime ?? "",
    filename: match.filename,
    offset: match.offset,
    length: match.length
  };
  return createViewerHref(capture, {});
}

function formatMatchTimestamp(timestamp?: string): string {
  if (!timestamp) return "";
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(timestamp);
  if (!match) return timestamp;
  const [, y, mo, d, h, mi] = match;
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

/**
 * Full-text search across locally cached HTML captures. Purely local: it scans
 * the IndexedDB HTML cache, so results only include pages the user has opened or
 * bulk-exported (and thus cached), never the live web.
 */
function CachedHtmlSearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CachedHtmlSearchMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const lastQueryRef = useRef("");

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    lastQueryRef.current = trimmed;
    if (!trimmed) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchCachedHtml(trimmed, { limit: 100 }));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  return (
    <section className="archive-panel rounded-md p-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-xs font-bold uppercase tracking-[0.14em] text-zinc-200"
      >
        <Search size={14} />
        Full-text search (cached pages)
        {open ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
      </button>
      {open ? (
        <div className="mt-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find text inside cached HTML…"
              aria-label="Search cached HTML"
              className="flex-1"
            />
            <Button type="submit" size="sm" disabled={searching || query.trim().length === 0}>
              <Search size={14} />
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>
          <p className="mt-2 text-xs text-zinc-500">
            Only pages you have opened or exported are cached locally and searchable here.
          </p>
          {results !== null ? (
            results.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-400">No cached pages match “{lastQueryRef.current}”.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {results.map((match) => (
                  <li key={match.cacheKey}>
                    <Link
                      href={viewerHrefForMatch(match)}
                      className="block rounded-md border border-zinc-800 bg-zinc-950 p-3 transition hover:border-zinc-600"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-amber-200">{match.url || "(unknown URL)"}</span>
                        <span className="shrink-0 text-xs text-zinc-500">{formatMatchTimestamp(match.timestamp)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">
                        {match.inUrl && !match.snippet ? "Matched in the URL." : match.snippet}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type HistoryExportMode = "all" | "filtered" | "selected";

function historyExportRecord(record: HistoryRecord, mode: HistoryExportMode, exportedAt: string) {
  return {
    exportedAt,
    mode,
    key: record.key,
    updatedAt: new Date(record.updatedAt).toISOString(),
    url: record.url,
    matchType: record.matchType,
    scanScope: record.scanScope,
    outcome: scanOutcome(record),
    captures: record.captureCount,
    checkedCollections: sourceCounts(record, []).processed,
    failedCollections: failedCount(record),
    storedCollections: record.collectionIds?.length ?? record.collections?.length ?? record.sourceTotal
  };
}

function triggerDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function downloadHistoryExport(
  records: HistoryRecord[],
  mode: HistoryExportMode,
  format: "csv" | "json"
) {
  const date = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    const exportedAt = new Date().toISOString();
    const json = toJsonText({
      tool: "Crawlback",
      exportedAt,
      mode,
      recordCount: records.length,
      records: records.map((record) => historyExportRecord(record, mode, exportedAt))
    });
    triggerDownload(new Blob([json], { type: "application/json;charset=utf-8" }), `common-crawl-history-${mode}-${date}.json`);
    return;
  }
  await downloadCsv(records, mode);
}

async function downloadCsv(records: HistoryRecord[], mode: "all" | "filtered" | "selected") {
  const rows = [
    [
      "exportedAt",
      "mode",
      "key",
      "updatedAt",
      "url",
      "matchType",
      "scanScope",
      "outcome",
      "captures",
      "checkedCollections",
      "failedCollections",
      "storedCollections"
    ],
    ...records.map((record) => [
      new Date().toISOString(),
      mode,
      record.key,
      new Date(record.updatedAt).toISOString(),
      record.url,
      record.matchType,
      record.scanScope,
      scanOutcome(record),
      String(record.captureCount),
      String(sourceCounts(record, []).processed),
      String(failedCount(record)),
      String(record.collectionIds?.length ?? record.collections?.length ?? record.sourceTotal)
    ])
  ];
  const csv = await computeCsv(rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `common-crawl-history-${mode}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

