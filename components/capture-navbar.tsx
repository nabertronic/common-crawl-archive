"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import type { CommonCrawlCapture } from "@/lib/common-crawl";
import { APP_NAME } from "@/lib/app-meta";
import { cn, formatTimestamp } from "@/lib/utils";

type NavBarProps = {
  url: string;
  timestamp: string;
  captures: CommonCrawlCapture[];
  currentIndex: number;
  backHref: string | null;
  onJumpTo: (index: number) => void;
};

const MONTH_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function CaptureNavBar({ url, timestamp, captures, currentIndex, backHref, onJumpTo }: NavBarProps) {
  const sorted = useMemo(
    () => [...captures].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [captures]
  );

  const indexInSorted = useMemo(() => {
    if (currentIndex < 0 || !captures[currentIndex]) return -1;
    const current = captures[currentIndex];
    return sorted.findIndex(
      (c) =>
        c.timestamp === current.timestamp &&
        c.filename === current.filename &&
        c.offset === current.offset
    );
  }, [captures, currentIndex, sorted]);

  const hasList = sorted.length > 0;
  const prevIndex = hasList ? Math.max(0, indexInSorted - 1) : -1;
  const nextIndex = hasList ? Math.min(sorted.length - 1, indexInSorted + 1) : -1;
  const canPrev = hasList && indexInSorted > 0;
  const canNext = hasList && indexInSorted >= 0 && indexInSorted < sorted.length - 1;

  const navigateBySorted = (sortedIndex: number) => {
    const target = sorted[sortedIndex];
    if (!target) return;
    const originalIndex = captures.findIndex(
      (c) => c.timestamp === target.timestamp && c.filename === target.filename && c.offset === target.offset
    );
    if (originalIndex >= 0) onJumpTo(originalIndex);
  };

  const dateLabel = formatHeadlineDate(timestamp);

  const counterLabel = hasList
    ? indexInSorted >= 0
      ? `Capture ${indexInSorted + 1} of ${sorted.length}`
      : `${sorted.length} capture${sorted.length === 1 ? "" : "s"} in this scan`
    : "Standalone capture";

  return (
    <header className="sticky top-0 z-30 w-full shrink-0 border-b border-amber-300/15 bg-zinc-950/85 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/40 to-transparent" />
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 pb-2 pt-2 lg:px-6">
        <Link
          href="/"
          className="group flex h-9 shrink-0 items-center gap-2 rounded-md border border-amber-300/30 bg-zinc-900/60 px-2.5 text-zinc-200 transition hover:border-amber-300 hover:text-amber-100"
          title="Start a new search"
        >
          <span className="grid h-5 w-5 place-items-center rounded-sm bg-amber-300 text-zinc-950 transition group-hover:bg-amber-200">
            <SnapshotMark />
          </span>
          <span className="hidden text-[10px] font-black uppercase tracking-[0.22em] sm:inline">{APP_NAME}</span>
        </Link>

        <UrlField url={url} />

        {backHref ? (
          <Link
            href={backHref}
            aria-label="Close viewer"
            title="Close viewer"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-400 transition hover:border-amber-300/60 hover:text-amber-100"
          >
            <X size={15} />
          </Link>
        ) : (
          <div aria-hidden />
        )}

        {hasList ? (
          <>
            <div aria-hidden />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              <span className="text-amber-200/90">{counterLabel}</span>
              {dateLabel ? <span className="text-zinc-300">{dateLabel}</span> : null}
            </div>
            <div aria-hidden />

            <div className="flex self-center items-center justify-end gap-2">
              <NavButton
                disabled={!canPrev}
                onClick={() => navigateBySorted(0)}
                title="First capture"
              >
                <ChevronsLeft size={15} />
              </NavButton>
              <NavButton
                disabled={!canPrev}
                onClick={() => navigateBySorted(prevIndex)}
                title="Previous capture (←)"
              >
                <ChevronLeft size={15} />
                <span className="hidden text-[10px] font-bold uppercase tracking-[0.18em] sm:inline">Prev</span>
              </NavButton>
            </div>

            <div className="flex items-center justify-start gap-2">
              <div className="relative min-w-[340px] max-w-full overflow-hidden">
                <CaptureTimeline
                  sorted={sorted}
                  currentIndex={indexInSorted}
                  onJump={navigateBySorted}
                />
              </div>
              <NavButton
                disabled={!canNext}
                onClick={() => navigateBySorted(nextIndex)}
                title="Next capture (→)"
              >
                <span className="hidden text-[10px] font-bold uppercase tracking-[0.18em] sm:inline">Next</span>
                <ChevronRight size={15} />
              </NavButton>
              <NavButton
                disabled={!canNext}
                onClick={() => navigateBySorted(sorted.length - 1)}
                title="Last capture"
              >
                <ChevronsRight size={15} />
              </NavButton>
            </div>
            <div aria-hidden />
          </>
        ) : null}
      </div>
    </header>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  title
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-zinc-200 transition",
        "border-zinc-700 bg-zinc-900 hover:border-amber-300/60 hover:bg-zinc-800 hover:text-amber-100",
        "disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-950 disabled:text-zinc-600 disabled:hover:border-zinc-800 disabled:hover:bg-zinc-950 disabled:hover:text-zinc-600"
      )}
    >
      {children}
    </button>
  );
}

function UrlField({ url }: { url: string }) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[12px] text-zinc-100 shadow-inner shadow-black/40"
      title={url}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
        <span className="block h-1.5 w-1.5 rounded-full bg-emerald-300" />
      </span>
      <span className="truncate text-zinc-100">{url || "—"}</span>
    </div>
  );
}

function SnapshotMark() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h12" />
      <path d="M2 8h12" />
      <path d="M2 12h12" />
      <circle cx="11" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CaptureTimeline({
  sorted,
  currentIndex,
  onJump
}: {
  sorted: CommonCrawlCapture[];
  currentIndex: number;
  onJump: (sortedIndex: number) => void;
}) {
  const yearGroups = useMemo(() => {
    if (sorted.length === 0) return [] as { year: number; captures: { capture: CommonCrawlCapture; sortedIndex: number }[] }[];
    const minYear = Number(sorted[0].timestamp.slice(0, 4));
    const maxYear = Number(sorted[sorted.length - 1].timestamp.slice(0, 4));
    const groups: { year: number; captures: { capture: CommonCrawlCapture; sortedIndex: number }[] }[] = [];
    for (let y = minYear; y <= maxYear; y += 1) groups.push({ year: y, captures: [] });
    sorted.forEach((capture, sortedIndex) => {
      const y = Number(capture.timestamp.slice(0, 4));
      const group = groups[y - minYear];
      if (group) group.captures.push({ capture, sortedIndex });
    });
    return groups;
  }, [sorted]);

  if (yearGroups.length === 0) return null;

  const currentYear = currentIndex >= 0 && sorted[currentIndex]
    ? Number(sorted[currentIndex].timestamp.slice(0, 4))
    : null;

  const BAR_AREA_HEIGHT = 34;
  const TICK_WIDTH = 4;
  const TICK_GAP = 2;
  const MIN_COL_WIDTH = 32;

  return (
    <div className="thin-scrollbar flex h-14 min-w-0 items-end justify-start gap-1 overflow-x-auto rounded-md border border-zinc-800 bg-gradient-to-b from-zinc-950 to-zinc-900/30 px-2 pt-1">
      {yearGroups.map(({ year, captures }) => {
        const isSelected = currentYear === year;
        const yearCount = captures.length;
        const hasCount = yearCount > 0;
        const columnWidth = Math.max(MIN_COL_WIDTH, yearCount * (TICK_WIDTH + TICK_GAP) + 6);
        return (
          <div
            key={year}
            className="flex shrink-0 flex-col items-stretch"
            style={{ width: `${columnWidth}px` }}
          >
            <div
              className={cn(
                "flex items-end justify-center border-l px-[3px]",
                isSelected
                  ? "border-transparent bg-amber-300/15 shadow-[0_8px_24px_rgba(252,211,77,0.25)]"
                  : "border-zinc-800/60"
              )}
              style={{ height: `${BAR_AREA_HEIGHT}px`, gap: `${TICK_GAP}px` }}
            >
              {captures.map(({ capture, sortedIndex }) => {
                const isCurrent = sortedIndex === currentIndex;
                return (
                  <button
                    key={`${capture.timestamp}:${capture.filename}:${capture.offset}`}
                    type="button"
                    onClick={() => onJump(sortedIndex)}
                    title={formatTimestamp(capture.timestamp)}
                    aria-label={`Capture ${sortedIndex + 1}: ${formatTimestamp(capture.timestamp)}`}
                    className={cn(
                      "block rounded-sm transition-colors",
                      isCurrent
                        ? "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.55)]"
                        : isSelected
                          ? "bg-amber-200/90 hover:bg-amber-100"
                          : "bg-zinc-300 hover:bg-amber-300"
                    )}
                    style={{
                      width: `${TICK_WIDTH}px`,
                      height: isCurrent ? "100%" : isSelected ? "65%" : "50%"
                    }}
                  />
                );
              })}
            </div>
            <span
              className={cn(
                "inline-flex justify-center px-1 text-[11px] tabular-nums",
                isSelected
                  ? "bg-amber-300 font-bold text-zinc-950"
                  : hasCount
                    ? "font-semibold text-zinc-300"
                    : "text-zinc-600"
              )}
            >
              {year}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatHeadlineDate(timestamp: string): string {
  if (!/^\d{14}$/.test(timestamp)) return formatTimestamp(timestamp);
  const year = timestamp.slice(0, 4);
  const month = MONTH_SHORT[Number(timestamp.slice(4, 6)) - 1];
  const day = timestamp.slice(6, 8);
  const hour = timestamp.slice(8, 10);
  const minute = timestamp.slice(10, 12);
  return `${month} ${day}, ${year} · ${hour}:${minute} UTC`;
}
