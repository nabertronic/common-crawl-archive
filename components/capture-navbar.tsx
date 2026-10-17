"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { BrandWordmark } from "@/components/brand";
import type { CommonCrawlCapture } from "@/lib/common-crawl";
import { densityBins, nearestCaptureIndex, parseCaptureTime, smoothDensity, timelineDomain, timeToFraction, yearTicks } from "@/lib/capture-timeline";
import { cn, formatTimestamp } from "@/lib/utils";

type NavBarProps = {
  url: string;
  timestamp: string;
  captures: CommonCrawlCapture[];
  sortedCaptures?: CommonCrawlCapture[];
  currentIndex: number;
  backHref: string | null;
  onJumpTo: (index: number) => void;
};

const MONTH_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function CaptureNavBar({ url, timestamp, captures, sortedCaptures, currentIndex, backHref, onJumpTo }: NavBarProps) {
  const sorted = useMemo(
    () => sortedCaptures ?? [...captures].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [captures, sortedCaptures]
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
    <header className="sticky top-0 z-30 w-full shrink-0 border-b border-amber-300/15 bg-zinc-950/85 backdrop-blur-xl ledger:border-zinc-800 ledger:bg-zinc-950 ledger:backdrop-blur-none">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/40 to-transparent ledger:hidden" />
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:px-6">
        <Link
          href="/"
          className="group flex h-11 shrink-0 items-center sm:h-9 rounded-md ledger:rounded-[3px] border border-zinc-700 bg-zinc-900 px-4 text-zinc-200 transition hover:border-amber-300/60 hover:bg-zinc-800 hover:text-amber-100 ledger:duration-150 ledger:motion-safe:active:scale-[0.97]"
          title="Start a new search"
        >
          <BrandWordmark className="text-[16px] leading-none tracking-[-0.03em]" />
        </Link>

        <UrlField url={url} />

        {backHref ? (
          <Link
            href={backHref}
            aria-label="Close viewer"
            title="Close viewer"
            className="grid h-11 w-11 shrink-0 place-items-center sm:h-9 sm:w-9 rounded-md ledger:rounded-[3px] border border-zinc-800 bg-zinc-900/60 text-zinc-400 transition hover:border-amber-300/60 hover:text-amber-100 ledger:duration-150 ledger:motion-safe:active:scale-[0.97] ledger:hover:text-amber-300"
          >
            <X size={15} />
          </Link>
        ) : (
          <div aria-hidden />
        )}

        {hasList ? (
          <div className="col-span-3 grid grid-cols-4 gap-2 sm:contents">
            <div aria-hidden className="hidden sm:block" />
            <div className="order-1 col-span-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 text-xs sm:order-none sm:col-span-1 font-bold uppercase tracking-[0.18em] text-zinc-500 ledger:font-mono ledger:font-normal ledger:normal-case ledger:tracking-normal">
              <span className="text-amber-200/90">{counterLabel}</span>
              {dateLabel ? <span className="text-zinc-300">{dateLabel}</span> : null}
            </div>
            <div aria-hidden className="hidden sm:block" />

            <div className="contents sm:flex sm:items-center sm:justify-end sm:gap-2 sm:self-center">
              <NavButton
                className="order-3"
                disabled={!canPrev}
                onClick={() => navigateBySorted(0)}
                title="First capture"
              >
                <ChevronsLeft size={15} />
              </NavButton>
              <NavButton
                className="order-4"
                disabled={!canPrev}
                onClick={() => navigateBySorted(prevIndex)}
                title="Previous capture (←)"
              >
                <ChevronLeft size={15} />
                <span className="text-xs font-bold uppercase tracking-[0.18em] ledger:font-sans ledger:normal-case ledger:tracking-normal">Prev</span>
              </NavButton>
            </div>

            <div className="contents sm:flex sm:items-center sm:justify-start sm:gap-2">
              <div className="relative order-2 col-span-4 min-w-0 sm:order-none sm:col-span-1 sm:min-w-[240px] sm:flex-1">
                <CaptureTimeline
                  sorted={sorted}
                  currentIndex={indexInSorted}
                  onJump={navigateBySorted}
                />
              </div>
              <NavButton
                className="order-5"
                disabled={!canNext}
                onClick={() => navigateBySorted(nextIndex)}
                title="Next capture (→)"
              >
                <span className="text-xs font-bold uppercase tracking-[0.18em] ledger:font-sans ledger:normal-case ledger:tracking-normal">Next</span>
                <ChevronRight size={15} />
              </NavButton>
              <NavButton
                className="order-6"
                disabled={!canNext}
                onClick={() => navigateBySorted(sorted.length - 1)}
                title="Last capture"
              >
                <ChevronsRight size={15} />
              </NavButton>
            </div>
            <div aria-hidden className="hidden sm:block" />
          </div>
        ) : null}
      </div>
    </header>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  title,
  className
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-1.5 rounded-md border px-2.5 text-zinc-200 transition sm:order-none sm:h-9 sm:justify-start",
        className,
        "border-zinc-700 bg-zinc-900 hover:border-amber-300/60 hover:bg-zinc-800 hover:text-amber-100",
        "disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-950 disabled:text-zinc-600 disabled:hover:border-zinc-800 disabled:hover:bg-zinc-950 disabled:hover:text-zinc-600",
        "ledger:rounded-[3px] ledger:border-zinc-50 ledger:bg-transparent ledger:text-zinc-50 ledger:hover:border-zinc-50 ledger:hover:bg-zinc-50 ledger:hover:text-zinc-950 ledger:transition-[color,background-color,border-color,transform] ledger:duration-150 ledger:motion-safe:active:scale-[0.97]",
        "ledger:disabled:border-zinc-700 ledger:disabled:bg-transparent ledger:disabled:text-zinc-500 ledger:disabled:hover:border-zinc-700 ledger:disabled:hover:bg-transparent ledger:disabled:hover:text-zinc-500"
      )}
    >
      {children}
    </button>
  );
}

function UrlField({ url }: { url: string }) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[12px] text-zinc-100 shadow-inner shadow-black/40 ledger:rounded-[3px] ledger:shadow-none"
      title={url}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
        <span className="block h-1.5 w-1.5 rounded-full bg-emerald-300" />
      </span>
      <span className="truncate text-zinc-100">{url || "—"}</span>
    </div>
  );
}

const DENSITY_BINS = 160;
const DENSITY_HEIGHT = 20;
const MAX_YEAR_LABELS = 9;

/**
 * Time-scaled scrubber: captures sit on a real time axis as a smoothed density
 * curve (taller = more captures), with year marks below and a red marker for the
 * open capture. Hover or drag previews the nearest capture; release (or click)
 * opens it, so dragging doesn't load every capture along the way.
 */
export function CaptureTimeline({
  sorted,
  currentIndex,
  onJump
}: {
  sorted: CommonCrawlCapture[];
  currentIndex: number;
  onJump: (sortedIndex: number) => void;
}) {
  const times = useMemo(() => {
    // Fall back to evenly spaced positions if a timestamp can't be parsed.
    const parsed = sorted.map((capture) => parseCaptureTime(capture.timestamp));
    return parsed.every((time) => time !== null) ? (parsed as number[]) : sorted.map((_, index) => index * 86_400_000);
  }, [sorted]);
  const domain = useMemo(() => timelineDomain(times), [times]);
  const bins = useMemo(() => (domain ? densityBins(times, domain, DENSITY_BINS) : []), [times, domain]);
  const densityPath = useMemo(() => {
    const levels = smoothDensity(bins);
    if (levels.length < 2) return null;
    const points = levels.map((level, index) => `${((index / (levels.length - 1)) * 100).toFixed(2)},${(DENSITY_HEIGHT - level * (DENSITY_HEIGHT - 1)).toFixed(2)}`);
    const line = `M${points.join("L")}`;
    return { line, area: `${line}L100,${DENSITY_HEIGHT}L0,${DENSITY_HEIGHT}Z` };
  }, [bins]);
  const ticks = useMemo(() => (domain ? yearTicks(domain, MAX_YEAR_LABELS) : []), [domain]);

  const trackRef = useRef<HTMLDivElement>(null);
  const activePointerId = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ index: number; dragging: boolean } | null>(null);

  if (!domain || sorted.length === 0) return null;

  const fractionOf = (index: number) => timeToFraction(times[index], domain);
  const indexAtPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return currentIndex;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return nearestCaptureIndex(times, domain.start + fraction * (domain.end - domain.start));
  };

  const shownIndex = preview?.index ?? -1;
  const shownCapture = shownIndex >= 0 ? sorted[shownIndex] : null;
  const current = currentIndex >= 0 ? sorted[currentIndex] : null;
  const currentYear = current ? Number(current.timestamp.slice(0, 4)) : null;
  const pageStep = Math.max(1, Math.round(sorted.length / 20));

  return (
    <div className="relative select-none">
      {shownCapture ? (
        <div
          className="pointer-events-none absolute top-[calc(100%+8px)] z-[80] w-72 max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-zinc-700/80 bg-zinc-900 px-3 py-2 text-left text-xs font-medium text-zinc-100 shadow-md shadow-black/40 ledger:rounded-[3px] ledger:border-zinc-800 ledger:bg-zinc-950 ledger:shadow-[0_12px_32px_-8px_rgba(20,20,22,0.22)]"
          style={{ left: `clamp(9rem, calc(0.75rem + ${fractionOf(shownIndex)} * (100% - 1.5rem)), calc(100% - 9rem))` }}
        >
          <CaptureTickHover capture={shownCapture} sortedIndex={shownIndex} />
        </div>
      ) : null}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Capture timeline"
        aria-valuemin={1}
        aria-valuemax={sorted.length}
        aria-valuenow={currentIndex >= 0 ? currentIndex + 1 : undefined}
        aria-valuetext={current ? `Capture ${currentIndex + 1} of ${sorted.length}: ${formatTimestamp(current.timestamp)}` : undefined}
        onKeyDown={(event) => {
          // ←/→ are handled globally by the viewer; add the remaining slider keys.
          const last = sorted.length - 1;
          const target =
            event.key === "Home" ? 0
            : event.key === "End" ? last
            : event.key === "PageUp" ? Math.max(0, currentIndex - pageStep)
            : event.key === "PageDown" ? Math.min(last, currentIndex + pageStep)
            : null;
          if (target === null) return;
          event.preventDefault();
          if (target !== currentIndex) onJump(target);
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          activePointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          setPreview({ index: indexAtPointer(event.clientX), dragging: true });
        }}
        onPointerMove={(event) => {
          if (activePointerId.current !== null && event.pointerId !== activePointerId.current) return;
          if (activePointerId.current !== null && !event.isPrimary) return;
          if (event.pointerType === "touch" && !preview?.dragging) return;
          const index = indexAtPointer(event.clientX);
          setPreview((value) => (value?.index === index ? value : { index, dragging: value?.dragging ?? false }));
        }}
        onPointerUp={(event) => {
          if (activePointerId.current !== event.pointerId || !event.isPrimary || event.button !== 0) return;
          activePointerId.current = null;
          const index = indexAtPointer(event.clientX);
          setPreview(event.pointerType === "mouse" ? { index, dragging: false } : null);
          if (index >= 0 && index !== currentIndex) onJump(index);
        }}
        onPointerCancel={(event) => {
          if (activePointerId.current !== event.pointerId) return;
          activePointerId.current = null;
          setPreview(null);
        }}
        onLostPointerCapture={(event) => {
          if (activePointerId.current !== event.pointerId) return;
          activePointerId.current = null;
          setPreview(null);
        }}
        onPointerLeave={() => setPreview((value) => (value?.dragging ? value : null))}
        className="group relative h-14 cursor-pointer touch-none rounded-md border border-zinc-800 bg-zinc-950 px-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-amber-300 ledger:rounded-[3px] ledger:hover:border-zinc-700"
      >
        <div ref={trackRef} className="absolute inset-x-3 top-0 h-full">
          {/* Density curve over a hairline baseline. */}
          {densityPath ? (
            <svg
              aria-hidden
              viewBox={`0 0 100 ${DENSITY_HEIGHT}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-x-0 top-1.5 h-5 w-full overflow-visible text-zinc-300 ledger:text-zinc-200"
            >
              <path d={densityPath.area} fill="currentColor" fillOpacity={0.1} />
              <path d={densityPath.line} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
          ) : null}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-[1.625rem] h-px bg-zinc-700" />

          {/* Year marks. */}
          {ticks.map(({ year, fraction }) => (
            <span
              key={year}
              aria-hidden
              className="pointer-events-none absolute top-[1.6875rem] flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${fraction * 100}%` }}
            >
              <span className="h-1 w-px bg-zinc-600" />
              <span className={cn("font-mono text-[10px] leading-4 tabular-nums text-zinc-500", currentYear === year && "text-zinc-200")}>
                {year}
              </span>
            </span>
          ))}

          {/* Hover / drag preview. */}
          {preview ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1.5 h-[1.375rem] w-px -translate-x-1/2 bg-zinc-200 opacity-50"
              style={{ left: `${fractionOf(preview.index) * 100}%` }}
            />
          ) : null}

          {/* Open capture. */}
          {currentIndex >= 0 ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1.5 flex h-[1.375rem] w-0 flex-col items-center transition-[left] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
              style={{ left: `${fractionOf(currentIndex) * 100}%` }}
            >
              <span className="size-[7px] shrink-0 rounded-full bg-amber-300" />
              <span className="w-[2px] flex-1 bg-amber-300" />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CaptureTickHover({
  capture,
  sortedIndex
}: {
  capture: CommonCrawlCapture;
  sortedIndex: number;
}) {
  const isRedirect = /^3\d\d$/.test(capture.status);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200 ledger:normal-case ledger:tracking-normal">
          Capture {sortedIndex + 1}
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400 ledger:normal-case ledger:tracking-normal">
          {capture.collectionId}
        </p>
      </div>
      <p className="break-all font-mono text-xs leading-5 text-zinc-100">{capture.url}</p>
      <div className="space-y-0.5 text-xs text-zinc-300">
        <p>
          Time: <span className="font-mono text-zinc-100">{formatTimestamp(capture.timestamp)}</span>
        </p>
        <p>
          Status: <span className={cn("font-mono", isRedirect ? "text-emerald-300" : "text-sky-300")}>{capture.status}</span>
        </p>
      </div>
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
