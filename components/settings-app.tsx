"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Database,
  FileText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Table2,
  Trash2
} from "lucide-react";
import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import { TopRightMenu } from "@/components/top-right-menu";
import { Button } from "@/components/ui/button";
import { DateControl } from "@/components/ui/date-control";
import { Input } from "@/components/ui/input";
import {
  clearAllLocalAppData,
  clearHtmlCache,
  DEFAULT_CAPTURE_EXPORT_COLUMNS,
  DEFAULT_HISTORY_PAGE_SIZE,
  DEFAULT_SCAN_SCOPE,
  DEFAULT_HTML_CACHE_LIMIT_BYTES,
  DEFAULT_LARGE_CAPTURE_LIMIT_BYTES,
  DEFAULT_SEARCH_PAGE_SIZE,
  getCacheStats,
  getSettings,
  pruneHtmlCache,
  resetSettings,
  subscribeToSearchChanges,
  updateSettings,
  type AppCaptureColumnKey,
  type AppSettings,
  type CacheStats
} from "@/lib/capture-store";
import { getCollectionCacheInfo, refreshCollections, type CollectionCacheInfo } from "@/lib/common-crawl";
import { markPerformance, measureAsync } from "@/lib/performance";
import { revokeStorageConsent } from "@/lib/website-preferences";

const SORT_OPTIONS = [
  ["timestamp-desc", "Date (newest first)"],
  ["timestamp-asc", "Date (oldest first)"],
  ["size-desc", "Size (largest first)"],
  ["size-asc", "Size (smallest first)"],
  ["url-asc", "URL (A-Z)"],
  ["url-desc", "URL (Z-A)"],
  ["status-asc", "Status (asc)"],
  ["status-desc", "Status (desc)"],
  ["collection-desc", "Collection (newest first)"],
  ["collection-asc", "Collection (oldest first)"]
] as const;

const CAPTURE_COLUMNS: { key: AppCaptureColumnKey; label: string }[] = [
  { key: "url", label: "URL" },
  { key: "timestamp", label: "Timestamp" },
  { key: "collection", label: "Collection" },
  { key: "status", label: "Status" },
  { key: "mime", label: "MIME" },
  { key: "digest", label: "Digest" },
  { key: "warcUrl", label: "WARC URL" },
  { key: "warcPosition", label: "WARC Position" }
];

const SECTIONS = [
  { id: "scan-settings", label: "Scan settings" },
  { id: "results-defaults", label: "Results" },
  { id: "viewer", label: "Viewer" },
  { id: "storage", label: "Storage" },
  { id: "export", label: "Export defaults" },
  { id: "danger-zone", label: "Danger zone" }
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const LEDGER_SECONDARY_BUTTON =
  "ledger:rounded-[3px] ledger:border-zinc-50 ledger:bg-transparent ledger:text-zinc-50 ledger:shadow-none ledger:hover:bg-zinc-50 ledger:hover:text-zinc-950";
const LEDGER_DANGER_BUTTON =
  "ledger:rounded-[3px] ledger:border-amber-300 ledger:bg-transparent ledger:text-amber-300 ledger:shadow-none ledger:hover:bg-amber-300 ledger:hover:text-zinc-950";

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [stats, setStats] = useState<CacheStats>({ count: 0, sizeBytes: 0 });
  const [collectionInfo, setCollectionInfo] = useState<CollectionCacheInfo>({ count: 0 });
  const [refreshingCollections, setRefreshingCollections] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>(SECTIONS[0].id);
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  const flashCounter = useRef(0);
  const saveSequence = useRef(0);

  function showFlash(text: string) {
    flashCounter.current += 1;
    setFlash({ id: flashCounter.current, text });
  }

  useEffect(() => {
    if (!flash) return;
    const timeoutId = window.setTimeout(() => setFlash(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [flash]);

  async function refresh() {
    const [loadedSettings, loadedStats] = await measureAsync("settings-refresh", () => Promise.all([
        getSettings(),
        getCacheStats()
      ])
    );
    setSettings(loadedSettings);
    setStats(loadedStats);
    setCollectionInfo(getCollectionCacheInfo());
  }

  useEffect(() => {
    markPerformance("page-hydrated:settings");
    void refresh();
    const unsubscribe = subscribeToSearchChanges(() => void refresh());
    return unsubscribe;
  }, []);

  useEffect(() => {
    let frameId = 0;

    const updateActiveSection = () => {
      frameId = 0;
      const page = document.documentElement;
      const atPageEnd = window.scrollY + window.innerHeight >= page.scrollHeight - 2;
      if (atPageEnd) {
        setActiveSection(SECTIONS[SECTIONS.length - 1].id);
        return;
      }

      const activationLine = Math.min(320, window.innerHeight * 0.44);
      let current: SectionId = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const element = document.getElementById(section.id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (window.scrollY > 2 && rect.top <= activationLine) {
          current = section.id;
        }
      }
      setActiveSection(current);
    };

    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  async function saveSettings(input: Parameters<typeof updateSettings>[0], message = "Saved.") {
    if (!settings) return;
    const previous = settings;
    const sequence = saveSequence.current + 1;
    saveSequence.current = sequence;
    setSettings({
      ...previous,
      ...input
    });
    try {
      const next = await updateSettings(input);
      if (saveSequence.current !== sequence) return;
      setSettings(next);
      showFlash(message);
    } catch (error) {
      if (saveSequence.current !== sequence) return;
      setSettings(previous);
      showFlash(error instanceof Error ? error.message : "Could not save settings.");
    }
  }

  async function toggleExportColumn(column: AppCaptureColumnKey) {
    if (!settings) return;
    const current = settings.defaultExportColumns.length ? settings.defaultExportColumns : DEFAULT_CAPTURE_EXPORT_COLUMNS;
    const next = current.includes(column)
      ? current.filter((item) => item !== column)
      : [...current, column];
    if (next.length === 0) {
      showFlash("Keep at least one column selected.");
      return;
    }
    await saveSettings({ defaultExportColumns: next }, "CSV defaults saved.");
  }

  async function handleClearCache() {
    if (!window.confirm("Delete all cached HTML files? History entries stay intact.")) return;
    await clearHtmlCache();
    showFlash("HTML cache cleared.");
    await refresh();
  }

  async function handlePruneCache() {
    setPruning(true);
    try {
      await pruneHtmlCache(settings?.htmlCacheLimitBytes);
      showFlash("Cache pruned to the current limit.");
      await refresh();
    } finally {
      setPruning(false);
    }
  }

  async function handleResetSettings() {
    if (!window.confirm("Reset settings to their defaults?")) return;
    await resetSettings();
    showFlash("Settings reset to defaults.");
    await refresh();
  }

  async function handleClearAll() {
    if (!window.confirm("Delete all local app data, including history, settings, and cached HTML?")) return;
    await clearAllLocalAppData();
    showFlash("All local app data cleared.");
    await refresh();
  }

  async function handleRefreshCollections() {
    setRefreshingCollections(true);
    try {
      const collections = await refreshCollections();
      setCollectionInfo(getCollectionCacheInfo());
      showFlash(`Collection list refreshed (${collections.length} collections).`);
    } catch (error) {
      showFlash(error instanceof Error ? error.message : "Could not refresh Common Crawl list.");
    } finally {
      setRefreshingCollections(false);
    }
  }

  const exportColumns = settings?.defaultExportColumns?.length
    ? settings.defaultExportColumns
    : DEFAULT_CAPTURE_EXPORT_COLUMNS;

  return (
    <main className="min-h-screen px-4 py-5 text-zinc-100 md:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="archive-panel relative z-40 rounded-md p-4 ledger:!border-0 ledger:!bg-transparent ledger:!shadow-none ledger:rounded-none ledger:p-0">
          <div className="flex items-center justify-between gap-3 ledger:border-b-[1.5px] ledger:border-zinc-50 ledger:pb-6">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Link
                href="/"
                aria-label="Start a new search"
                title="Start a new search"
                className="rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              >
                <BrandLockup className="translate-y-[1.5px]" wordClassName="text-xl leading-none" />
              </Link>
              <div className="min-w-0">
                <h1 className="border-l border-zinc-700 pl-3 text-xl font-bold leading-none text-zinc-50 ledger:font-serif ledger:text-[32px] ledger:font-normal ledger:tracking-[-0.02em]">Settings</h1>
              </div>
            </div>
            <div className="flex items-center justify-end">
              <TopRightMenu
                mode="inline"
                items={[
                  { href: "/", label: "New Scan", icon: "search" },
                  { href: "/history", label: "History", icon: "history" }
                ]}
              />
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
          <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-5 lg:block lg:self-start">
            <div className="archive-panel max-h-[calc(100vh-2.5rem)] overflow-y-auto rounded-md p-2 ledger:!border-0 ledger:!bg-transparent ledger:!shadow-none ledger:rounded-none ledger:p-0">
              <ul className="grid gap-1 ledger:gap-0">
                {SECTIONS.map((section, index) => {
                  const active = activeSection === section.id;
                  const danger = section.id === "danger-zone";
                  return (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        onClick={() => setActiveSection(section.id)}
                        aria-current={active ? "true" : undefined}
                        className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-xs font-bold uppercase tracking-[0.12em] transition ledger:transition-colors ledger:duration-150 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                          active
                            ? danger
                              ? "border-red-500/40 bg-red-500/10 text-red-200"
                              : "border-amber-300/50 bg-amber-300/10 text-amber-200"
                            : "border-transparent text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                        } ${
                          active
                            ? "ledger:border-transparent ledger:bg-transparent ledger:font-bold ledger:normal-case ledger:tracking-normal ledger:text-[15px] ledger:text-zinc-50"
                            : "ledger:rounded-none ledger:border-transparent ledger:bg-transparent ledger:font-semibold ledger:normal-case ledger:tracking-normal ledger:text-[15px] ledger:text-zinc-300 ledger:hover:text-zinc-50"
                        } ledger:rounded-none ledger:px-0 ledger:py-2.5`}
                      >
                        <span className={`font-mono text-xs tabular-nums ${active ? "opacity-80" : "text-zinc-500"} ${active ? "ledger:text-amber-300 ledger:opacity-100" : ""} ledger:hidden`}>
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {section.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>

          <div className="flex min-w-0 flex-col gap-4 pb-24 lg:pb-[45vh] ledger:gap-12">
            <Panel id="scan-settings" icon={<Search size={16} />} title="Scan settings">
              <SettingRow label="Default match mode" description="How the URL is matched against the index.">
                <SelectField
                  ariaLabel="Default match mode"
                  value={settings?.defaultMatchType ?? "exact"}
                  onChange={(value) => void saveSettings({ defaultMatchType: value as AppSettings["defaultMatchType"] })}
                  options={[
                    ["exact", "Exact URL"],
                    ["host", "Host"],
                    ["domain", "Domain + subdomains"]
                  ]}
                />
              </SettingRow>
              <SettingRow label="Default scan window" description="Which collections a new scan covers.">
                <SelectField
                  ariaLabel="Default scan window"
                  value={settings?.defaultScanScope ?? DEFAULT_SCAN_SCOPE}
                  onChange={(value) => void saveSettings({ defaultScanScope: value as AppSettings["defaultScanScope"] })}
                  options={[
                    ["recent", "Last 12 months"],
                    ["all", "Full archive"],
                    ["custom", "Custom date range"]
                  ]}
                />
              </SettingRow>
              {settings?.defaultScanScope === "custom" ? (
                <div className="grid gap-3 py-3 sm:grid-cols-2">
                  <DateControl
                    label="Default from"
                    value={settings.defaultCustomDateFrom ?? ""}
                    onChange={(value) => void saveSettings({ defaultCustomDateFrom: value })}
                  />
                  <DateControl
                    label="Default to"
                    value={settings.defaultCustomDateTo ?? ""}
                    onChange={(value) => void saveSettings({ defaultCustomDateTo: value })}
                  />
                </div>
              ) : null}
              <SettingRow
                label="Robots.txt check"
                description="Contact the target site's robots.txt once before new scans to check CCBot crawl permissions."
              >
                <Switch
                  ariaLabel="Check target robots.txt before scans"
                  checked={settings?.robotsTxtChecksEnabled ?? true}
                  onChange={(checked) =>
                    void saveSettings(
                      { robotsTxtChecksEnabled: checked },
                      checked ? "Robots.txt checks enabled." : "Robots.txt checks disabled."
                    )
                  }
                />
              </SettingRow>
              <div className="grid gap-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-100">Common Crawl list</p>
                    <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                      Re-fetch the list of available crawl collections used for new scans.
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className={LEDGER_SECONDARY_BUTTON}
                      disabled={refreshingCollections}
                      onClick={() => void handleRefreshCollections()}
                    >
                      <RefreshCw size={14} className={refreshingCollections ? "animate-spin" : ""} />
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 divide-x divide-zinc-800 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 ledger:rounded-none ledger:border-zinc-600">
                  <Stat label="Collections" value={String(collectionInfo.count)} />
                  <Stat label="Fetched" value={collectionInfo.fetchedAt ? shortDateTime(collectionInfo.fetchedAt) : "Never"} />
                </div>
              </div>
            </Panel>

            <Panel id="results-defaults" icon={<Table2 size={16} />} title="Results defaults">
              <SettingRow label="Result view" description="Initial layout for scan results.">
                <SelectField
                  ariaLabel="Default result view"
                  value={settings?.defaultViewMode ?? "list"}
                  onChange={(value) => void saveSettings({ defaultViewMode: value as AppSettings["defaultViewMode"] })}
                  options={[
                    ["list", "List"],
                    ["calendar", "Calendar"]
                  ]}
                />
              </SettingRow>
              <SettingRow label="Sort order" description="Initial sorting of captures.">
                <SelectField
                  ariaLabel="Default sort order"
                  value={settings?.defaultSort ?? "timestamp-desc"}
                  onChange={(value) => void saveSettings({ defaultSort: value })}
                  options={[...SORT_OPTIONS]}
                />
              </SettingRow>
              <SettingRow label="Search page size" description="Captures per page in scan results.">
                <NumberField
                  ariaLabel="Search page size"
                  value={settings?.searchPageSize ?? DEFAULT_SEARCH_PAGE_SIZE}
                  min={25}
                  max={500}
                  step={25}
                  unit="rows"
                  onCommit={(value) => void saveSettings({ searchPageSize: value })}
                />
              </SettingRow>
              <SettingRow label="History page size" description="Saved scans per page in history.">
                <NumberField
                  ariaLabel="History page size"
                  value={settings?.historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE}
                  min={10}
                  max={100}
                  step={5}
                  unit="rows"
                  onCommit={(value) => void saveSettings({ historyPageSize: value })}
                />
              </SettingRow>
            </Panel>

            <Panel id="viewer" icon={<ShieldAlert size={16} />} title="Viewer">
              <SettingRow
                label="Large capture limit"
                description="Ask before opening captures bigger than this."
              >
                <NumberField
                  ariaLabel="Large capture limit in megabytes"
                  value={Math.round((settings?.largeCaptureLimitBytes ?? DEFAULT_LARGE_CAPTURE_LIMIT_BYTES) / 1024 / 1024)}
                  min={1}
                  max={500}
                  step={1}
                  unit="MB"
                  onCommit={(value) => void saveSettings({ largeCaptureLimitBytes: value * 1024 * 1024 })}
                />
              </SettingRow>
              <SettingRow
                label="HTML privacy warning"
                description="Warn before copying or downloading raw HTML — it can load live assets when opened later."
              >
                <Switch
                  ariaLabel="Warn before copying or downloading raw HTML"
                  checked={settings?.showHtmlPrivacyWarning ?? true}
                  onChange={(checked) =>
                    void saveSettings(
                      { showHtmlPrivacyWarning: checked },
                      checked ? "HTML privacy warning enabled." : "HTML privacy warning disabled."
                    )
                  }
                />
              </SettingRow>
            </Panel>

            <Panel id="storage" icon={<Database size={16} />} title="Storage">
              <SettingRow
                label="Browser storage"
                description="Allowed. Turning it off stops app features from using it. Saved data stays until you clear it."
              >
                <Button type="button" size="sm" variant="secondary" className={LEDGER_SECONDARY_BUTTON} onClick={() => revokeStorageConsent()}>
                  Turn storage off
                </Button>
              </SettingRow>
              <div className="py-3">
                <div className="grid grid-cols-3 divide-x divide-zinc-800 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 ledger:rounded-none ledger:border-zinc-600">
                  <Stat label="Cached files" value={String(stats.count)} />
                  <Stat label="Size" value={formatStorageBytes(stats.sizeBytes)} />
                  <Stat label="Last used" value={stats.lastAccessedAt ? shortDate(stats.lastAccessedAt) : "Never"} />
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className={LEDGER_SECONDARY_BUTTON}
                    disabled={pruning || stats.count === 0}
                    onClick={() => void handlePruneCache()}
                  >
                    <Trash2 size={14} />
                    {pruning ? "Pruning…" : "Prune now"}
                  </Button>
                </div>
              </div>
              <SettingRow label="Cache HTML" description="Keep fetched snapshots locally for instant reopening.">
                <Switch
                  ariaLabel="Cache HTML"
                  checked={settings?.htmlCacheEnabled ?? true}
                  onChange={(checked) =>
                    void saveSettings(
                      { htmlCacheEnabled: checked },
                      checked ? "HTML cache enabled." : "HTML cache disabled."
                    )
                  }
                />
              </SettingRow>
              <SettingRow label="Auto prune" description="Evict the oldest files when the cache limit is reached.">
                <Switch
                  ariaLabel="Auto prune"
                  checked={settings?.autoPruneEnabled ?? true}
                  onChange={(checked) =>
                    void saveSettings(
                      { autoPruneEnabled: checked },
                      checked ? "Automatic pruning enabled." : "Automatic pruning disabled."
                    )
                  }
                />
              </SettingRow>
              <SettingRow label="Cache limit" description="Maximum disk space for cached HTML.">
                <NumberField
                  ariaLabel="Cache limit in megabytes"
                  value={Math.round((settings?.htmlCacheLimitBytes ?? DEFAULT_HTML_CACHE_LIMIT_BYTES) / 1024 / 1024)}
                  min={5}
                  max={4096}
                  step={5}
                  unit="MB"
                  onCommit={(value) => void saveSettings({ htmlCacheLimitBytes: value * 1024 * 1024 })}
                />
              </SettingRow>
            </Panel>

            <Panel
              id="export"
              icon={<FileText size={16} />}
              title="Export defaults"
              description="Columns included in exported CSV files."
            >
              <div className="flex flex-wrap gap-2 py-3">
                {CAPTURE_COLUMNS.map((column) => {
                  const active = exportColumns.includes(column.key);
                  return (
                    <button
                      key={column.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => void toggleExportColumn(column.key)}
                      className={`inline-flex h-11 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition sm:h-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ledger:rounded-[3px] ledger:font-sans ledger:normal-case ledger:tracking-normal ${
                        active
                          ? "border-amber-300/60 bg-amber-300/10 text-amber-200 ledger:border-zinc-50 ledger:bg-zinc-50 ledger:text-zinc-950"
                          : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 ledger:border-zinc-600 ledger:text-zinc-300 ledger:hover:border-zinc-50 ledger:hover:text-zinc-50"
                      }`}
                    >
                      {active ? <Check size={12} /> : null}
                      {column.label}
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel
              id="danger-zone"
              icon={<AlertTriangle size={16} />}
              title="Danger zone"
              tone="danger"
            >
              <SettingRow label="Clear HTML cache" description="Deletes cached HTML files. History entries stay intact.">
                <Button type="button" size="sm" variant="danger" className={LEDGER_DANGER_BUTTON} onClick={() => void handleClearCache()}>
                  <Trash2 size={14} />
                  Clear cache
                </Button>
              </SettingRow>
              <SettingRow label="Reset settings" description="Restores every setting on this page to its default.">
                <Button type="button" size="sm" variant="secondary" className={LEDGER_SECONDARY_BUTTON} onClick={() => void handleResetSettings()}>
                  <RotateCcw size={14} />
                  Reset
                </Button>
              </SettingRow>
              <SettingRow label="Clear all data" description="Deletes history, settings, and cached HTML from this device.">
                <Button type="button" size="sm" variant="danger" className={LEDGER_DANGER_BUTTON} onClick={() => void handleClearAll()}>
                  <Trash2 size={14} />
                  Clear all
                </Button>
              </SettingRow>
            </Panel>
          </div>
        </div>
      </div>

      {flash ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
          <p
            key={flash.id}
            role="status"
            className="animate-[copy-pop_220ms_ease-out] rounded-md border border-emerald-400/40 bg-zinc-950/95 px-4 py-2 text-sm font-semibold text-emerald-200 shadow-[0_18px_70px_rgba(0,0,0,0.5)] backdrop-blur ledger:rounded-[3px] ledger:border-zinc-50 ledger:shadow-[0_10px_30px_rgba(20,20,22,0.08)] ledger:backdrop-blur-none"
          >
            {flash.text}
          </p>
        </div>
      ) : null}
    </main>
  );
}

function Panel({
  id,
  icon,
  title,
  description,
  tone = "default",
  children
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  description?: string;
  tone?: "default" | "danger";
  children: React.ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <section
      id={id}
      className={`scroll-mt-5 rounded-md ${
        danger
          ? "border border-red-500/30 bg-zinc-950/80 shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl"
          : "archive-panel"
      } ledger:!border-0 ledger:!bg-transparent ledger:!shadow-none ledger:rounded-none ledger:backdrop-blur-none`}
    >
      <header className={`flex items-center gap-2 border-b px-4 py-3 ${danger ? "border-red-500/20" : "border-zinc-800"} ledger:items-baseline ledger:gap-4 ledger:px-0 ledger:pb-3.5 ledger:pt-0 ledger:border-b-[1.5px] ${danger ? "ledger:border-amber-300" : "ledger:border-zinc-50"}`}>
        <span className={`${danger ? "text-red-300" : "text-amber-300"} ledger:hidden`}>{icon}</span>
        <h2 className={`text-sm font-bold uppercase tracking-[0.14em] ${danger ? "text-red-200" : "text-zinc-100"} ledger:font-serif ledger:font-normal ledger:normal-case ledger:text-[38px] ledger:leading-none ledger:tracking-[-0.01em] ${danger ? "ledger:text-amber-300" : "ledger:text-zinc-50"}`}>
          {title}
        </h2>
        {description ? <p className="ml-auto hidden text-xs text-zinc-400 sm:block ledger:text-sm ledger:text-zinc-300">{description}</p> : null}
      </header>
      <div className={`divide-y px-4 ${danger ? "divide-red-500/10" : "divide-zinc-800/70"} ledger:px-0 ledger:divide-zinc-800`}>{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 ledger:grid ledger:grid-cols-[minmax(0,1fr)_minmax(220px,300px)] ledger:items-center ledger:gap-8 ledger:py-[18px] ledger:max-sm:grid-cols-1 ledger:max-sm:gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-100 ledger:text-[15.5px] ledger:font-bold">{label}</p>
        {description ? <p className="mt-0.5 text-xs leading-5 text-zinc-400 ledger:mt-1 ledger:text-sm ledger:leading-6 ledger:text-zinc-300">{description}</p> : null}
      </div>
      <div className="shrink-0 ledger:justify-self-end">{children}</div>
    </div>
  );
}

function SelectField({
  ariaLabel,
  value,
  options,
  onChange
}: {
  ariaLabel: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-base font-semibold sm:h-10 sm:text-sm text-zinc-100 outline-none transition hover:border-zinc-600 focus:border-amber-300 sm:w-56 ledger:rounded-[3px] ledger:border-zinc-600 ledger:font-normal ledger:shadow-none ledger:hover:border-zinc-50 ledger:focus-visible:outline-2 ledger:focus-visible:outline-offset-2 ledger:focus-visible:outline-amber-300"
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

function NumberField({
  ariaLabel,
  value,
  min,
  max,
  step,
  unit,
  disabled = false,
  onCommit
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const numeric = Number(draft);
    if (!Number.isFinite(numeric)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(numeric)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <div className="relative">
      <Input
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={`h-11 w-full pr-[4.25rem] text-right font-mono tabular-nums sm:w-40 ${
          disabled ? "cursor-not-allowed opacity-50" : ""
        }`}
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-[0.06em] text-zinc-400 ledger:font-sans ledger:normal-case ledger:tracking-normal">
        {unit}
      </span>
    </div>
  );
}

function Switch({
  ariaLabel,
  checked,
  onChange
}: {
  ariaLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200 before:absolute before:-inset-2 before:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
        checked ? "border-amber-300/70 bg-amber-300 ledger:border-amber-300 ledger:bg-amber-300" : "border-zinc-700 bg-zinc-800 ledger:border-zinc-50 ledger:bg-zinc-950"
      } ledger:shadow-none`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
          checked ? "translate-x-[23px] bg-zinc-950" : "translate-x-[3px] bg-zinc-300 ledger:bg-zinc-50"
        } ledger:shadow-none`}
      />
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-3 py-2 ledger:gap-1.5 ledger:px-3 ledger:py-3 ledger:sm:px-4">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400 ledger:font-sans ledger:normal-case ledger:text-[13px] ledger:font-bold ledger:tracking-normal ledger:text-zinc-500">{label}</span>
      <span className="truncate font-mono text-sm font-bold text-zinc-100 ledger:font-serif ledger:font-normal ledger:text-[22px] ledger:sm:text-[28px] ledger:leading-none ledger:tracking-[-0.01em]" title={value}>{value}</span>
    </div>
  );
}

function shortDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function shortDateTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function formatStorageBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}
