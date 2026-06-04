"use client";

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Database,
  ExternalLink,
  History,
  RotateCcw,
  Settings,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { BrandLockup } from "@/components/brand";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteSearch,
  deleteSearches,
  deleteCachedCapture,
  deleteCachedCapturesForHistoryRecord,
  listSearches,
  listCachedCaptureRecordsForCaptures,
  scanSearchKey,
  subscribeToSearchChanges,
  type CachedHtmlCaptureRecord,
  type StoredSearch
} from "@/lib/capture-store";
import {
  fetchCollections,
  filterCollectionsByRecentMonths,
  searchUrlCoversTarget,
  type CollectionCheckResult,
  type CommonCrawlCollection
} from "@/lib/common-crawl";
import { dedupeCaptures, mergeCollectionResults } from "@/lib/scan-results";

type ScanScope = "recent" | "all";
type ScanOutcome = "complete" | "partial" | "empty";
type SortKey = "status" | "url" | "scope" | "match" | "updated" | "captures" | "sources" | "failed";
type SortDir = "asc" | "desc";

type HistoryRecord = StoredSearch & {
  scanScope: ScanScope;
  results: CollectionCheckResult[];
  storageKeys?: string[];
};

const PAGE_SIZE = 25;
const HISTORY_GRID_CLASS =
  "grid items-center gap-3 [grid-template-columns:28px_80px_minmax(140px,1fr)_56px_56px_96px_64px_64px_64px_210px] xl:[grid-template-columns:28px_72px_minmax(140px,1fr)_52px_52px_88px_60px_60px_60px_560px]";
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
  const [showCoveredScans, setShowCoveredScans] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [cacheRecordsByKey, setCacheRecordsByKey] = useState<Record<string, CachedHtmlCaptureRecord[]>>({});
  const [expandedCacheKey, setExpandedCacheKey] = useState<string | null>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const scopeFilterRef = useRef<HTMLSelectElement | null>(null);
  const outcomeFilterRef = useRef<HTMLSelectElement | null>(null);
  const dateFromRef = useRef<HTMLInputElement | null>(null);
  const dateToRef = useRef<HTMLInputElement | null>(null);
  const showCoveredRef = useRef<HTMLInputElement | null>(null);

  const syncRestoredControls = useCallback(() => {
    const restoredQuery = queryInputRef.current?.value ?? "";
    const restoredScope = scopeFilterRef.current?.value;
    const restoredOutcome = outcomeFilterRef.current?.value;
    const restoredDateFrom = dateFromRef.current?.value ?? "";
    const restoredDateTo = dateToRef.current?.value ?? "";
    const restoredShowCovered = showCoveredRef.current?.checked;

    setQuery((current) => (current === restoredQuery ? current : restoredQuery));
    if (restoredScope === "any" || restoredScope === "recent" || restoredScope === "all") {
      setScopeFilter((current) => (current === restoredScope ? current : restoredScope));
    }
    if (restoredOutcome === "all" || restoredOutcome === "complete" || restoredOutcome === "partial" || restoredOutcome === "empty") {
      setOutcomeFilter((current) => (current === restoredOutcome ? current : restoredOutcome));
    }
    setDateFrom((current) => (current === restoredDateFrom ? current : restoredDateFrom));
    setDateTo((current) => (current === restoredDateTo ? current : restoredDateTo));
    if (typeof restoredShowCovered === "boolean") {
      setShowCoveredScans((current) => (current === restoredShowCovered ? current : restoredShowCovered));
    }
  }, []);

  const clearFreshControls = useCallback(() => {
    setQuery("");
    setScopeFilter("any");
    setOutcomeFilter("all");
    setDateFrom("");
    setDateTo("");
    setShowCoveredScans(false);
    if (queryInputRef.current) queryInputRef.current.value = "";
    if (scopeFilterRef.current) scopeFilterRef.current.value = "any";
    if (outcomeFilterRef.current) outcomeFilterRef.current.value = "all";
    if (dateFromRef.current) dateFromRef.current.value = "";
    if (dateToRef.current) dateToRef.current.value = "";
    if (showCoveredRef.current) showCoveredRef.current.checked = false;
  }, []);

  useEffect(() => {
    void refreshRecords().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const refresh = () => {
      void refreshRecords().finally(() => setLoading(false));
    };
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
      window.removeEventListener("pageshow", handlePageShow);
      unsubscribe();
    };
  }, [clearFreshControls, syncRestoredControls]);

  async function refreshRecords() {
    const [searches, collections] = await Promise.all([
      listSearches(),
      fetchCollections().catch(() => [] as CommonCrawlCollection[])
    ]);
    setRecords(mergeHistoryRecords(searches.filter(isHistoryRecord)));
    setCurrentCollections(collections);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadCacheRecords() {
      const entries = await Promise.all(
        records.map(async (record) => [record.key, await listCachedCaptureRecordsForCaptures(record.captures)] as const)
      );
      if (!cancelled) setCacheRecordsByKey(Object.fromEntries(entries));
    }
    void loadCacheRecords();
    return () => {
      cancelled = true;
    };
  }, [records]);

  const stats = useMemo(() => {
    const captures = records.reduce((sum, record) => sum + record.captures.length, 0);
    const failed = records.reduce((sum, record) => sum + failedCount(record, currentCollections), 0);
    return { scans: records.length, captures, failed };
  }, [currentCollections, records]);

  const visibleBaseRecords = useMemo(() => {
    if (showCoveredScans) return records;
    return records.filter((record) => !isCoveredByBroaderCompleteScan(record, records, currentCollections));
  }, [currentCollections, records, showCoveredScans]);

  const hiddenCoveredCount = records.length - visibleBaseRecords.length;

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const fromTimestamp = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined;
    const toTimestamp = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : undefined;

    return visibleBaseRecords.filter((record) => {
      if (scopeFilter !== "any" && record.scanScope !== scopeFilter) return false;
      if (outcomeFilter !== "all" && scanOutcome(record, currentCollections) !== outcomeFilter) return false;
      if (fromTimestamp !== undefined && record.updatedAt < fromTimestamp) return false;
      if (toTimestamp !== undefined && record.updatedAt > toTimestamp) return false;
      if (!normalizedQuery) return true;
      return record.url.toLowerCase().includes(normalizedQuery);
    });
  }, [currentCollections, dateFrom, dateTo, outcomeFilter, query, scopeFilter, visibleBaseRecords]);

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

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleRecords = sortedRecords.slice(pageStart, pageStart + PAGE_SIZE);
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
    !!dateTo,
    showCoveredScans
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0 || query.trim().length > 0;

  function clearFilters() {
    setQuery("");
    setScopeFilter("any");
    setOutcomeFilter("all");
    setDateFrom("");
    setDateTo("");
    setShowCoveredScans(false);
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
    const deleteCache = record.captures.length > 0 && window.confirm("Also delete cached HTML files for this scan?");
    if (record.storageKeys && record.storageKeys.length > 1) {
      await deleteSearches(record.storageKeys);
    } else {
      await deleteSearch(record.key);
    }
    if (deleteCache) await deleteCachedCapturesForHistoryRecord(record);
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
      for (const record of selected) await deleteCachedCapturesForHistoryRecord(record);
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
      for (const record of records) await deleteCachedCapturesForHistoryRecord(record);
    }
    setSelectedKeys([]);
    await refreshRecords();
  }

  async function handleDeleteCachedCapture(recordKey: string, cacheKey: string) {
    if (!window.confirm("Delete this cached HTML file?")) return;
    await deleteCachedCapture(cacheKey);
    setCacheRecordsByKey((current) => ({
      ...current,
      [recordKey]: (current[recordKey] ?? []).filter((record) => record.cacheKey !== cacheKey)
    }));
  }

  return (
    <main className="min-h-screen px-4 py-5 text-zinc-100 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4" suppressHydrationWarning>
        <header className="archive-panel rounded-md p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-3">
                <Link
                  href="/"
                  aria-label="Start a new search"
                  title="Start a new search"
                  className="rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  <BrandLockup wordClassName="text-xl leading-none" />
                </Link>
                <Link
                  href="/settings"
                  aria-label="Open settings"
                  title="Open settings"
                  className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700 bg-zinc-950/70 text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  <Settings size={20} />
                </Link>
                <div>
                  <h1 className="text-xl font-black uppercase tracking-[0.18em] text-zinc-50">
                    Scan history
                  </h1>
                </div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-zinc-800 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/60 lg:w-[430px]">
              <Stat label="Scans" value={String(stats.scans)} />
              <Stat label="Snapshots" value={String(stats.captures)} tone={stats.captures > 0 ? "green" : "neutral"} />
              <Stat label="Failed" value={String(stats.failed)} tone={stats.failed > 0 ? "red" : "neutral"} />
            </div>
          </div>
        </header>

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
                  ["all", "Full"]
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
              <label className="flex h-10 items-center gap-2 self-end rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm font-semibold text-zinc-200">
                <input
                  ref={showCoveredRef}
                  type="checkbox"
                  checked={showCoveredScans}
                  onChange={(event) => setShowCoveredScans(event.target.checked)}
                  className="h-4 w-4 accent-amber-300"
                />
                Show covered
              </label>
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
              <span className="text-xs text-zinc-500">
                {selectedKeys.length > 0
                  ? `${selectedKeys.length} selected`
                  : `${sortedRecords.length} shown${hiddenCoveredCount > 0 && !showCoveredScans ? `, ${hiddenCoveredCount} covered hidden` : ""}`}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={selectedRecords.length === 0}
                onClick={() => downloadCsv(selectedRecords, "selected")}
                suppressHydrationWarning
              >
                <Download size={14} />
                Export selected
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
                  <span />
                  <SortHeader label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="URL" sortKey="url" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Scope" sortKey="scope" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Match" sortKey="match" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Updated" sortKey="updated" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Snapshots" sortKey="captures" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                  <span className="text-right text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Cached</span>
                  <SortHeader label="Sources" sortKey="sources" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                  <SortHeader label="Failed" sortKey="failed" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                  <span className="text-right text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Actions</span>
                </div>
                <div className="divide-y divide-zinc-800/70">
                  {visibleRecords.map((record) => (
                    <HistoryRow
                      key={record.key}
                      record={record}
                      currentCollections={currentCollections}
                      hasFullScan={hasCoveringFullScan(record, records, currentCollections)}
                      selected={selectedKeySet.has(record.key)}
                      cacheRecords={cacheRecordsByKey[record.key] ?? []}
                      cacheExpanded={expandedCacheKey === record.key}
                      onToggleCache={(key) => setExpandedCacheKey((current) => current === key ? null : key)}
                      onDeleteCachedCapture={handleDeleteCachedCapture}
                      onSelectedChange={toggleRecordSelection}
                      onDelete={handleDeleteRecord}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 p-4 text-xs text-zinc-400">
                <p>
                  {sortedRecords.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, sortedRecords.length)} of{" "}
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

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={records.length === 0}
            onClick={() => downloadCsv(records, "all")}
            suppressHydrationWarning
          >
            <Download size={14} />
            Export all
          </Button>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={sortedRecords.length === 0}
              onClick={() => downloadCsv(sortedRecords, "filtered")}
              suppressHydrationWarning
            >
              <Download size={14} />
              Export view
            </Button>
          ) : null}
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={records.length === 0}
            onClick={() => void handleClearHistory()}
            suppressHydrationWarning
          >
            <Trash2 size={14} />
            Clear history
          </Button>
        </div>
      </div>
    </main>
  );
}

function HistoryRow({
  record,
  currentCollections,
  hasFullScan,
  selected,
  cacheRecords,
  cacheExpanded,
  onToggleCache,
  onDeleteCachedCapture,
  onSelectedChange,
  onDelete
}: {
  record: HistoryRecord;
  currentCollections: CommonCrawlCollection[];
  hasFullScan: boolean;
  selected: boolean;
  cacheRecords: CachedHtmlCaptureRecord[];
  cacheExpanded: boolean;
  onToggleCache: (key: string) => void;
  onDeleteCachedCapture: (recordKey: string, cacheKey: string) => Promise<void>;
  onSelectedChange: (key: string, checked: boolean) => void;
  onDelete: (record: HistoryRecord) => Promise<void>;
}) {
  const parsed = tryParseUrl(record.url);
  const host = parsed?.hostname ?? record.url;
  const path = parsed ? `${parsed.pathname}${parsed.search}` : "";
  const outcome = scanOutcome(record, currentCollections);
  const sourceStats = sourceCounts(record, currentCollections);
  const openHref = searchHref(record, false);
  const continueHref = searchHref(record, "missing");
  const retryFailedHref = searchHref(record, "retry-failed");
  const fullScanHref = fullScanHrefFor(record);
  const canRunFullScan = record.scanScope === "recent" && !hasFullScan;

  return (
    <>
    <article className={`${HISTORY_GRID_CLASS} px-4 py-3 text-sm transition hover:bg-zinc-900/45`}>
      <label>
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(record.key, event.target.checked)}
          aria-label={`Select saved scan for ${record.url}`}
          className="h-4 w-4 accent-amber-300"
        />
      </label>
      <div>
        <Badge tone={outcome === "complete" ? "green" : outcome === "partial" ? "amber" : "neutral"}>
          {outcome}
        </Badge>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-zinc-50" title={record.url}>
          {host}
        </p>
        {path && path !== "/" ? (
          <p className="mt-0.5 truncate text-xs text-zinc-500" title={path}>
            {path}
          </p>
        ) : null}
      </div>
      <span className="truncate text-xs text-zinc-400">
        {record.scanScope === "all" ? "full" : "recent"}
      </span>
      <span className="truncate text-xs text-zinc-400">{record.matchType}</span>
      <time className="truncate text-xs text-zinc-500" title={formatDateTime(record.updatedAt)}>
        {formatDate(record.updatedAt)}
      </time>
      <Metric value={String(record.captures.length)} tone={record.captures.length > 0 ? "green" : "neutral"} />
      <Metric value={`${cacheRecords.length}/${record.captures.length}`} tone={cacheRecords.length > 0 ? "green" : "neutral"} />
      <Metric value={`${sourceStats.processed}/${sourceStats.total}`} tone={sourceStats.missing > 0 ? "red" : "neutral"} />
      <Metric value={String(sourceStats.failed)} tone={sourceStats.failed > 0 ? "red" : "neutral"} />
      <div className="flex items-center justify-end gap-1">
        {canRunFullScan ? (
          <LinkButton href={fullScanHref} size="sm" variant="secondary" title="Full scan" aria-label="Full scan" className="w-8 px-0 xl:w-auto xl:px-3">
            <RotateCcw size={14} />
            <span className="hidden xl:inline">Full scan</span>
          </LinkButton>
        ) : null}
        {sourceStats.missing > 0 ? (
          <LinkButton href={continueHref} size="sm" variant="secondary" title="Continue" aria-label="Continue" className="w-8 px-0 xl:w-auto xl:px-3">
            <RotateCcw size={14} />
            <span className="hidden xl:inline">Continue</span>
          </LinkButton>
        ) : null}
        {sourceStats.failed > 0 ? (
          <LinkButton href={retryFailedHref} size="sm" variant="secondary" title="Retry failed" aria-label="Retry failed" className="w-8 px-0 xl:w-auto xl:px-3">
            <RotateCcw size={14} />
            <span className="hidden xl:inline">Retry failed</span>
          </LinkButton>
        ) : null}
        <LinkButton href={openHref} size="sm" variant="primary" title="Open" aria-label="Open" className="w-8 px-0 xl:w-auto xl:px-3">
          <ExternalLink size={14} />
          <span className="hidden xl:inline">Open</span>
        </LinkButton>
        <Button type="button" size="sm" variant="secondary" aria-label="Manage cached HTML" title="Cached HTML" onClick={() => onToggleCache(record.key)} className="w-8 px-0 xl:w-auto xl:px-3">
          <Database size={14} />
          <span className="hidden xl:inline">Storage</span>
        </Button>
        <Button type="button" size="sm" variant="danger" aria-label="Delete saved scan" title="Delete" onClick={() => void onDelete(record)} className="w-8 px-0 xl:w-auto xl:px-3">
          <Trash2 size={14} />
          <span className="hidden xl:inline">Delete</span>
        </Button>
      </div>
    </article>
    {cacheExpanded ? (
      <section className="border-t border-zinc-900 bg-zinc-950/45 px-4 py-3">
        {cacheRecords.length === 0 ? (
          <p className="text-xs font-semibold text-zinc-500">No cached HTML files for this scan yet.</p>
        ) : (
          <div className="grid gap-2">
            {cacheRecords.map((cached) => (
              <div key={cached.cacheKey} className="grid items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_110px_96px_36px]">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-zinc-200" title={cached.url ?? cached.filename}>
                    {cached.url ?? cached.filename}
                  </p>
                  <p className="mt-0.5 truncate text-zinc-500">{cached.timestamp || cached.collectionId || cached.filename}</p>
                </div>
                <span className="font-mono text-zinc-400">{formatStorageBytes(cached.sizeBytes)}</span>
                <time className="text-zinc-500" title={formatDateTime(cached.lastAccessedAt)}>{formatDate(cached.lastAccessedAt)}</time>
                <Button type="button" size="sm" variant="danger" aria-label="Delete cached HTML" title="Delete cached HTML" onClick={() => void onDeleteCachedCapture(record.key, cached.cacheKey)} className="w-8 px-0">
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "green" | "red";
}) {
  const valueColor =
    tone === "green" ? "text-emerald-300" : tone === "red" ? "text-red-300" : "text-zinc-100";
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 leading-none">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <span className={`font-mono text-sm font-bold tabular-nums ${valueColor}`}>{value}</span>
    </div>
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
      className={`group flex w-full items-center gap-1 p-0 text-[10px] font-bold uppercase tracking-[0.14em] transition ${justify} ${color}`}
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
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
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

function DateControl({
  label,
  value,
  onChange,
  inputRef
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-amber-300"
      />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid min-h-80 place-items-center p-8 text-center">
      <div>
        <History className="mx-auto mb-3 text-zinc-600" size={30} />
        <p className="font-semibold text-zinc-300">{text}</p>
      </div>
    </div>
  );
}

function isHistoryRecord(record: StoredSearch): record is HistoryRecord {
  return (
    !record.mock &&
    (record.scanScope === "recent" || record.scanScope === "all") &&
    Array.isArray(record.results)
  );
}

function mergeHistoryRecords(records: HistoryRecord[]) {
  const byScan = new Map<string, HistoryRecord>();
  for (const record of records) {
    const identity = `${record.matchType}:${record.url}`;
    const current = byScan.get(identity);
    if (!current) {
      byScan.set(identity, {
        ...record,
        key: scanSearchKey(record.url, record.matchType, record.mock, record.scanScope),
        storageKeys: [record.key]
      });
      continue;
    }

    const mergedScope: ScanScope = current.scanScope === "all" || record.scanScope === "all" ? "all" : "recent";
    const mergedResults =
      current.scanScope === "all"
        ? mergeCollectionResults(record.results, current.results)
        : mergeCollectionResults(current.results, record.results);
    const mergedCollections =
      record.scanScope === "all"
        ? record.collections ?? current.collections
        : current.collections ?? record.collections;
    byScan.set(identity, {
      ...current,
      key: scanSearchKey(record.url, record.matchType, record.mock, mergedScope),
      captures: dedupeCaptures([...current.captures, ...record.captures]),
      scanScope: mergedScope,
      collections: mergedCollections,
      results: mergedResults,
      updatedAt: Math.max(current.updatedAt, record.updatedAt),
      storageKeys: Array.from(new Set([...(current.storageKeys ?? [current.key]), record.key]))
    });
  }
  return Array.from(byScan.values());
}

function activeCollectionsFor(record: HistoryRecord, currentCollections: CommonCrawlCollection[]) {
  if (currentCollections.length > 0) {
    return record.scanScope === "all" ? currentCollections : filterCollectionsByRecentMonths(currentCollections);
  }
  return record.collections ?? record.results.map((result) => result.collection);
}

function sourceCounts(record: HistoryRecord, currentCollections: CommonCrawlCollection[]) {
  const activeCollections = activeCollectionsFor(record, currentCollections);
  const activeIds = new Set(activeCollections.map((collection) => collection.id));
  const activeResults = record.results.filter((result) => activeIds.has(result.collection.id));
  const resultIds = new Set(activeResults.map((result) => result.collection.id));
  const failed = activeResults.filter((result) => result.status === "not-checked").length;
  return {
    total: activeCollections.length,
    processed: activeResults.length,
    failed,
    missing: activeCollections.filter((collection) => !resultIds.has(collection.id)).length
  };
}

function failedCount(record: HistoryRecord, currentCollections: CommonCrawlCollection[] = []) {
  return sourceCounts(record, currentCollections).failed;
}

function matchCoverageRank(matchType: HistoryRecord["matchType"]) {
  if (matchType === "domain") return 2;
  if (matchType === "host") return 1;
  return 0;
}

function scopeCoverageRank(scope: ScanScope) {
  return scope === "all" ? 1 : 0;
}

function isCoveredByBroaderCompleteScan(
  record: HistoryRecord,
  records: HistoryRecord[],
  currentCollections: CommonCrawlCollection[]
) {
  const matchRank = matchCoverageRank(record.matchType);
  const scopeRank = scopeCoverageRank(record.scanScope);
  return records.some((candidate) => {
    if (candidate.key === record.key) return false;
    if (candidate.mock !== record.mock) return false;
    if (scanOutcome(candidate, currentCollections) !== "complete") return false;
    const candidateMatchRank = matchCoverageRank(candidate.matchType);
    const candidateScopeRank = scopeCoverageRank(candidate.scanScope);
    return searchUrlCoversTarget(candidate.url, candidate.matchType, record.url, record.matchType) &&
      candidateMatchRank >= matchRank &&
      candidateScopeRank >= scopeRank &&
      (candidateMatchRank > matchRank || candidateScopeRank > scopeRank);
  });
}

function hasCoveringFullScan(
  record: HistoryRecord,
  records: HistoryRecord[],
  currentCollections: CommonCrawlCollection[]
) {
  return records.some((candidate) => {
    if (candidate.scanScope !== "all") return false;
    if (candidate.mock !== record.mock) return false;
    if (scanOutcome(candidate, currentCollections) !== "complete") return false;
    return searchUrlCoversTarget(candidate.url, candidate.matchType, record.url, record.matchType);
  });
}

function scanOutcome(record: HistoryRecord, currentCollections: CommonCrawlCollection[] = []): ScanOutcome {
  const counts = sourceCounts(record, currentCollections);
  if (counts.failed > 0 || counts.missing > 0) return "partial";
  if (record.captures.length > 0) return "complete";
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
      cmp = left.captures.length - right.captures.length;
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

function searchHref(record: HistoryRecord, action: false | "missing" | "retry-failed") {
  const params = new URLSearchParams();
  params.set("match", record.matchType);
  params.set("url", record.url);
  if (record.scanScope === "all") params.set("scope", "all");
  if (action) {
    params.set("action", action);
  } else {
    params.set("history", "1");
  }
  return `/search?${params.toString()}`;
}

function fullScanHrefFor(record: HistoryRecord) {
  const params = new URLSearchParams();
  params.set("match", record.matchType);
  params.set("scope", "all");
  params.set("action", "missing");
  params.set("url", record.url);
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

function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function downloadCsv(records: HistoryRecord[], mode: "all" | "filtered" | "selected") {
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
      String(record.captures.length),
      String(sourceCounts(record, []).processed),
      String(failedCount(record)),
      String(record.collections?.length ?? record.results.length)
    ])
  ];
  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `common-crawl-history-${mode}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

function escapeCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
