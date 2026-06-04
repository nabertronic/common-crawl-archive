"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, History, RotateCcw, Save, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearAllLocalAppData,
  clearHtmlCache,
  DEFAULT_HTML_CACHE_LIMIT_BYTES,
  getCacheStats,
  getSettings,
  resetSettings,
  subscribeToSearchChanges,
  updateSettings,
  type AppSettings,
  type CacheStats
} from "@/lib/capture-store";

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [stats, setStats] = useState<CacheStats>({ count: 0, sizeBytes: 0 });
  const [cacheLimitMb, setCacheLimitMb] = useState(String(Math.round(DEFAULT_HTML_CACHE_LIMIT_BYTES / 1024 / 1024)));
  const [status, setStatus] = useState("");

  async function refresh() {
    const [loadedSettings, loadedStats] = await Promise.all([
      getSettings(),
      getCacheStats()
    ]);
    setSettings(loadedSettings);
    setStats(loadedStats);
    setCacheLimitMb(String(Math.round(loadedSettings.htmlCacheLimitBytes / 1024 / 1024)));
  }

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeToSearchChanges(() => void refresh());
    return unsubscribe;
  }, []);

  const dirty = useMemo(() => {
    if (!settings) return false;
    return Number(cacheLimitMb) !== Math.round(settings.htmlCacheLimitBytes / 1024 / 1024);
  }, [cacheLimitMb, settings]);

  async function saveLimit() {
    if (!settings) return;
    const nextLimitMb = Number(cacheLimitMb);
    await updateSettings({
      htmlCacheLimitBytes: Number.isFinite(nextLimitMb) ? nextLimitMb * 1024 * 1024 : settings.htmlCacheLimitBytes
    });
    setStatus("Settings saved.");
    await refresh();
  }

  async function toggleCache(enabled: boolean) {
    await updateSettings({ htmlCacheEnabled: enabled });
    setStatus(enabled ? "HTML cache enabled." : "HTML cache disabled.");
    await refresh();
  }

  async function togglePrune(enabled: boolean) {
    await updateSettings({ autoPruneEnabled: enabled });
    setStatus(enabled ? "Automatic pruning enabled." : "Automatic pruning disabled.");
    await refresh();
  }

  async function handleClearCache() {
    if (!window.confirm("Delete all cached HTML files? History entries stay intact.")) return;
    await clearHtmlCache();
    setStatus("HTML cache cleared.");
    await refresh();
  }

  async function handleResetSettings() {
    if (!window.confirm("Reset settings to their defaults?")) return;
    await resetSettings();
    setStatus("Settings reset.");
    await refresh();
  }

  async function handleClearAll() {
    if (!window.confirm("Delete all local app data, including history, settings, and cached HTML?")) return;
    await clearAllLocalAppData();
    setStatus("All local app data cleared.");
    await refresh();
  }

  return (
    <main className="min-h-screen px-4 py-5 text-zinc-100 md:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <header className="archive-panel rounded-md p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
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
                href="/history"
                aria-label="Open scan history"
                title="Open scan history"
                className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700 bg-zinc-950/70 text-zinc-200 transition hover:border-amber-300 hover:text-amber-100"
              >
                <History size={20} />
              </Link>
              <div>
                <h1 className="text-xl font-black uppercase tracking-[0.18em] text-zinc-50">Settings</h1>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Local-only storage controls</p>
              </div>
            </div>
            {status ? <p className="text-sm font-semibold text-emerald-200">{status}</p> : null}
          </div>
        </header>

        <section>
          <Panel icon={<Database size={16} />} title="HTML Cache">
            <div className="grid grid-cols-3 divide-x divide-zinc-800 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
              <Stat label="Files" value={String(stats.count)} />
              <Stat label="Size" value={formatStorageBytes(stats.sizeBytes)} />
              <Stat label="Last used" value={stats.lastAccessedAt ? shortDate(stats.lastAccessedAt) : "Never"} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex h-11 items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm font-semibold text-zinc-200">
                <span>Cache HTML</span>
                <input
                  type="checkbox"
                  checked={settings?.htmlCacheEnabled ?? true}
                  onChange={(event) => void toggleCache(event.target.checked)}
                  className="h-4 w-4 accent-amber-300"
                />
              </label>
              <label className="flex h-11 items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm font-semibold text-zinc-200">
                <span>Auto prune</span>
                <input
                  type="checkbox"
                  checked={settings?.autoPruneEnabled ?? true}
                  onChange={(event) => void togglePrune(event.target.checked)}
                  className="h-4 w-4 accent-amber-300"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Cache limit (MB)</span>
              <Input
                type="number"
                min={5}
                step={5}
                value={cacheLimitMb}
                onChange={(event) => setCacheLimitMb(event.target.value)}
              />
            </label>

            <Button type="button" disabled={!dirty} onClick={() => void saveLimit()} className="justify-center">
              <Save size={16} />
              Save limit
            </Button>

            <div className="grid gap-2 sm:grid-cols-3">
              <Button type="button" variant="danger" onClick={() => void handleClearCache()} className="justify-center">
                <Trash2 size={16} />
                Clear cache
              </Button>
              <Button type="button" variant="secondary" onClick={() => void handleResetSettings()} className="justify-center">
                <RotateCcw size={16} />
                Reset settings
              </Button>
              <Button type="button" variant="danger" onClick={() => void handleClearAll()} className="justify-center">
                <Settings size={16} />
                Clear all
              </Button>
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="archive-panel rounded-md p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-zinc-200">
        {icon}
        {title}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <span className="truncate font-mono text-sm font-bold text-zinc-100" title={value}>{value}</span>
    </div>
  );
}

function shortDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
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
