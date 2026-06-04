"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type CommonCrawlCapture, type ResultsBackContext } from "@/lib/common-crawl";
import { createViewerHref } from "@/lib/navigation-state";

type DateParts = {
  year: number;
  month: number;
  day: number;
};

function parseTimestamp(timestamp: string): DateParts | null {
  if (!/^\d{8}/.test(timestamp)) return null;
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(4, 6));
  const day = Number(timestamp.slice(6, 8));
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function dayKey(parts: DateParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

const MONTH_LABELS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC"
];

const MONTH_NAMES_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function firstDayOfMonth(year: number, month: number) {
  // Sunday-based index, matching the archive.org calendar layout.
  return new Date(year, month - 1, 1).getDay();
}

function formatDateLabel(parts: DateParts) {
  return `${MONTH_NAMES_LONG[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function formatCaptureTime(timestamp: string): string {
  if (!/^\d{14}/.test(timestamp)) return timestamp;
  return `${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}`;
}

function parseDayKey(key: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function CalendarView({
  captures,
  backContext,
  scanId
}: {
  captures: CommonCrawlCapture[];
  backContext: ResultsBackContext;
  scanId?: string;
}) {
  const { byDay, byYear, byMonth, years, firstDate, lastDate } = useMemo(() => {
    const byDayMap = new Map<string, CommonCrawlCapture[]>();
    const byYearMap = new Map<number, number>();
    const byMonthMap = new Map<string, number>();
    let firstTimestamp = "";
    let lastTimestamp = "";

    for (const capture of captures) {
      const parts = parseTimestamp(capture.timestamp);
      if (!parts) continue;
      const key = dayKey(parts);
      const existing = byDayMap.get(key);
      if (existing) existing.push(capture);
      else byDayMap.set(key, [capture]);
      byYearMap.set(parts.year, (byYearMap.get(parts.year) ?? 0) + 1);
      const monthKey = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
      byMonthMap.set(monthKey, (byMonthMap.get(monthKey) ?? 0) + 1);
      if (/^\d{14}/.test(capture.timestamp)) {
        if (!firstTimestamp || capture.timestamp < firstTimestamp) firstTimestamp = capture.timestamp;
        if (!lastTimestamp || capture.timestamp > lastTimestamp) lastTimestamp = capture.timestamp;
      }
    }

    const firstParts = firstTimestamp ? parseTimestamp(firstTimestamp) : null;
    const lastParts = lastTimestamp ? parseTimestamp(lastTimestamp) : null;

    const yearList = Array.from(byYearMap.keys()).sort((a, b) => a - b);

    return {
      byDay: byDayMap,
      byYear: byYearMap,
      byMonth: byMonthMap,
      years: yearList,
      firstDate: firstParts,
      lastDate: lastParts
    };
  }, [captures]);

  const defaultYear = lastDate?.year ?? years[years.length - 1] ?? new Date().getUTCFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    if (!years.includes(selectedYear) && years.length > 0) {
      setSelectedYear(defaultYear);
    }
  }, [years, selectedYear, defaultYear]);

  useEffect(() => {
    if (selectedDay && !selectedDay.startsWith(`${selectedYear}-`)) {
      setSelectedDay(null);
    }
  }, [selectedYear, selectedDay]);

  const firstBlueViewerUrl = (parts: DateParts): string | null => {
    const dayCaptures = byDay.get(dayKey(parts));
    if (!dayCaptures || dayCaptures.length === 0) return null;
    const sorted = [...dayCaptures].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const target = sorted.find((c) => !/^3\d\d$/.test(c.status)) ?? sorted[0];
    return createViewerHref(target, { scanId, legacyBackContext: backContext });
  };

  const yearStripRange = useMemo(() => {
    const earliest = firstDate?.year ?? years[0] ?? new Date().getUTCFullYear();
    const latest = lastDate?.year ?? years[years.length - 1] ?? new Date().getUTCFullYear();
    // Pad the strip so single-year results still get context.
    const from = Math.min(earliest, latest);
    const to = Math.max(earliest, latest);
    const span: number[] = [];
    for (let y = from; y <= to; y += 1) span.push(y);
    if (span.length === 0) span.push(new Date().getUTCFullYear());
    return span;
  }, [firstDate, lastDate, years]);

  const maxMonthCount = useMemo(() => {
    let max = 0;
    for (const count of byMonth.values()) if (count > max) max = count;
    return max;
  }, [byMonth]);

  const hasRedirects = useMemo(
    () => captures.some((capture) => /^3\d\d$/.test(capture.status)),
    [captures]
  );

  return (
    <div className="relative p-4">
      <p className="text-center text-sm text-zinc-300">
        Saved <span className="font-bold text-zinc-100">{captures.length} times</span>
        {firstDate && lastDate ? (
          <>
            {" "}between{" "}
            <DateLink parts={firstDate} href={firstBlueViewerUrl(firstDate)} />
            {" "}and{" "}
            <DateLink parts={lastDate} href={firstBlueViewerUrl(lastDate)} />
            .
          </>
        ) : (
          "."
        )}
      </p>

      <YearStrip
        years={yearStripRange}
        countsByYear={byYear}
        countsByMonth={byMonth}
        maxMonthCount={maxMonthCount}
        selected={selectedYear}
        onSelect={setSelectedYear}
      />

      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => (
          <MonthGrid
            key={month}
            year={selectedYear}
            month={month}
            byDay={byDay}
            selectedDay={selectedDay}
            backContext={backContext}
            scanId={scanId}
            onSelectDay={(key) => setSelectedDay((current) => (current === key ? null : key))}
            onClose={() => setSelectedDay(null)}
          />
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-zinc-500">
        This calendar view maps the number of times each capture URL appears in the search results,{" "}
        <span className="italic">not</span> how many times the page was actually updated.
        {hasRedirects ? (
          <>
            {" "}
            <span className="font-semibold text-emerald-400">Green indicates redirects (3xx).</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

function DateLink({ parts, href }: { parts: DateParts; href: string | null }) {
  const label = formatDateLabel(parts);
  const className =
    "font-semibold text-amber-300 underline-offset-2 transition hover:text-amber-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300";
  if (!href) return <span className={className}>{label}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {label}
    </a>
  );
}

function YearStrip({
  years,
  countsByYear,
  countsByMonth,
  maxMonthCount,
  selected,
  onSelect
}: {
  years: number[];
  countsByYear: Map<number, number>;
  countsByMonth: Map<string, number>;
  maxMonthCount: number;
  selected: number;
  onSelect: (year: number) => void;
}) {
  const selectedIndex = years.indexOf(selected);
  const canPrev = selectedIndex > 0;
  const canNext = selectedIndex >= 0 && selectedIndex < years.length - 1;
  const barAreaHeight = 64;

  return (
    <div className="mt-4 flex items-start justify-center gap-2">
      <button
        type="button"
        disabled={!canPrev}
        onClick={() => canPrev && onSelect(years[selectedIndex - 1])}
        aria-label="Previous year"
        style={{ marginTop: `${(barAreaHeight - 32) / 2}px` }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:border-amber-300 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-zinc-800 disabled:hover:text-zinc-300"
      >
        <ChevronLeft size={14} />
      </button>
      <div className="flex min-w-0 shrink items-end overflow-x-auto thin-scrollbar">
        {years.map((year) => {
          const count = countsByYear.get(year) ?? 0;
          const isSelected = year === selected;
          return (
            <button
              key={year}
              type="button"
              onClick={() => onSelect(year)}
              aria-label={`${year}: ${count} captures`}
              className="group flex shrink-0 flex-col items-stretch"
            >
              <div
                className={
                  isSelected
                    ? "flex items-end gap-px border-l border-transparent bg-amber-300/15 px-[2px] shadow-[0_8px_24px_rgba(252,211,77,0.25)]"
                    : "flex items-end gap-px border-l border-zinc-800/60 px-[2px] transition group-hover:bg-zinc-800/40"
                }
                style={{ height: `${barAreaHeight}px` }}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
                  const monthCount = countsByMonth.get(monthKey) ?? 0;
                  const ratio = maxMonthCount > 0 ? monthCount / maxMonthCount : 0;
                  const h =
                    monthCount > 0 ? Math.max(2, Math.round(ratio * (barAreaHeight - 4))) : 0;
                  return (
                    <div
                      key={month}
                      className={
                        isSelected
                          ? "w-[3px] bg-amber-200"
                          : monthCount > 0
                            ? "w-[3px] bg-zinc-200 transition group-hover:bg-amber-300/70"
                            : "w-[3px]"
                      }
                      style={{ height: `${h}px` }}
                    />
                  );
                })}
              </div>
              <span
                className={
                  isSelected
                    ? "inline-flex justify-center bg-amber-300 px-1 text-[11px] font-bold text-zinc-950"
                    : count > 0
                      ? "inline-flex justify-center px-1 text-[11px] font-semibold text-zinc-300 transition group-hover:font-bold group-hover:text-amber-300/70"
                      : "inline-flex justify-center px-1 text-[11px] text-zinc-600 transition group-hover:font-bold group-hover:text-amber-300/70"
                }
              >
                {year}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={!canNext}
        onClick={() => canNext && onSelect(years[selectedIndex + 1])}
        aria-label="Next year"
        style={{ marginTop: `${(barAreaHeight - 32) / 2}px` }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300 transition hover:border-amber-300 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-zinc-800 disabled:hover:text-zinc-300"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function MonthGrid({
  year,
  month,
  byDay,
  selectedDay,
  backContext,
  scanId,
  onSelectDay,
  onClose
}: {
  year: number;
  month: number;
  byDay: Map<string, CommonCrawlCapture[]>;
  selectedDay: string | null;
  backContext: ResultsBackContext;
  scanId?: string;
  onSelectDay: (key: string) => void;
  onClose: () => void;
}) {
  const total = daysInMonth(year, month);
  const offset = firstDayOfMonth(year, month);
  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let d = 1; d <= total; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <p className="mb-2 text-center text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
        {MONTH_LABELS[month - 1]}
      </p>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[11px]">
        {cells.map((day, idx) => {
          if (day === null) {
            return <span key={`empty-${idx}`} className="h-6" />;
          }
          const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayCaptures = byDay.get(key);
          const count = dayCaptures?.length ?? 0;
          const isSelected = selectedDay === key;
          if (count > 0) {
            const hasRedirect = dayCaptures!.some((c) => /^3\d\d$/.test(c.status));
            const allRedirect = dayCaptures!.every((c) => /^3\d\d$/.test(c.status));
            const dotClass = isSelected
              ? "bg-amber-300 text-zinc-950 ring-amber-300"
              : allRedirect
                ? "bg-emerald-500/30 text-emerald-100 ring-emerald-400/40 hover:bg-amber-300 hover:text-zinc-950 hover:ring-amber-300"
                : hasRedirect
                  ? "bg-sky-500/25 text-sky-100 ring-sky-400/40 hover:bg-amber-300 hover:text-zinc-950 hover:ring-amber-300"
                  : "bg-sky-500/25 text-sky-100 ring-sky-400/40 hover:bg-amber-300 hover:text-zinc-950 hover:ring-amber-300";
            return (
              <DayCell
                key={key}
                day={day}
                dateKey={key}
                captures={dayCaptures!}
                isSelected={isSelected}
                dotClass={dotClass}
                backContext={backContext}
                scanId={scanId}
                onSelectDay={onSelectDay}
                onClose={onClose}
              />
            );
          }
          return (
            <span key={key} className="grid h-6 place-items-center text-zinc-600">
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  day,
  dateKey,
  captures,
  isSelected,
  dotClass,
  backContext,
  scanId,
  onSelectDay,
  onClose
}: {
  day: number;
  dateKey: string;
  captures: CommonCrawlCapture[];
  isSelected: boolean;
  dotClass: string;
  backContext: ResultsBackContext;
  scanId?: string;
  onSelectDay: (key: string) => void;
  onClose: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSelected) return;
    function handleMouseDown(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(event.target as Node)) return;
      onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isSelected, onClose]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => onSelectDay(dateKey)}
        title={`${captures.length} capture${captures.length === 1 ? "" : "s"} on ${dateKey}`}
        className={`mx-auto grid h-6 w-6 place-items-center rounded-full font-semibold ring-1 transition ${dotClass}`}
      >
        {day}
      </button>
      {isSelected ? <DayPopover dateKey={dateKey} captures={captures} backContext={backContext} scanId={scanId} /> : null}
    </div>
  );
}

function DayPopover({
  dateKey,
  captures,
  backContext,
  scanId
}: {
  dateKey: string;
  captures: CommonCrawlCapture[];
  backContext: ResultsBackContext;
  scanId?: string;
}) {
  const parts = parseDayKey(dateKey);
  const sorted = useMemo(
    () => [...captures].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [captures]
  );

  return (
    <div
      role="dialog"
      className="absolute left-1/2 top-[calc(100%+10px)] z-30 w-60 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 text-left text-zinc-100 shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
    >
      <div className="absolute left-1/2 -top-2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-zinc-700 bg-zinc-950" />
      <div className="relative px-4 py-3">
        <p className="text-sm font-extrabold uppercase tracking-wider text-zinc-50">
          {parts ? formatDateLabel(parts) : dateKey}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {sorted.length} snapshot{sorted.length === 1 ? "" : "s"}
        </p>
        <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1 thin-scrollbar">
          {sorted.map((capture) => {
            const time = formatCaptureTime(capture.timestamp);
            const isRedirect = /^3\d\d$/.test(capture.status);
            const viewerUrl = createViewerHref(capture, { scanId, legacyBackContext: backContext });
            return (
              <li
                key={`${capture.collectionId}:${capture.timestamp}:${capture.filename}:${capture.offset}`}
                className="flex items-center gap-2 text-sm leading-6"
              >
                <span className="text-zinc-600">•</span>
                <a
                  href={viewerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={
                    isRedirect
                      ? "font-mono font-bold text-emerald-300 hover:text-amber-200 hover:underline"
                      : "font-mono font-bold text-sky-300 hover:text-amber-200 hover:underline"
                  }
                  title={capture.url}
                >
                  {time}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
