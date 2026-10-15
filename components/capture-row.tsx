"use client";

import { memo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronsUpDown, CornerDownRight, PencilLine } from "lucide-react";
import { type CommonCrawlCapture, type ResultsBackContext } from "@/lib/common-crawl";
import { createViewerHref } from "@/lib/navigation-state";
import { captureKey } from "@/lib/scan-results";
import { prefetchCaptureRecord } from "@/lib/warc-prefetch";
import { describeHttpStatus, formatBytes, formatTimestamp } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export type SortDir = "asc" | "desc";
export type SortKey = "status" | "timestamp" | "url" | "collection" | "size";
export type SortOption = `${SortKey}-${SortDir}`;

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  status: "asc",
  timestamp: "desc",
  url: "asc",
  collection: "desc",
  size: "desc"
};

/** Explains the changed-content marker (pencil icon); set on the badge's title and as its screen-reader text. */
export const CHANGED_HINT = "Content changed since the previous capture of this URL";

const GRID_COLS =
  "lg:grid lg:grid-cols-[72px_160px_minmax(0,1fr)_140px_80px_148px] lg:items-center lg:gap-3";

export function CaptureRowHeader({
  sort,
  onSortChange
}: {
  sort: SortOption;
  onSortChange: (next: SortOption) => void;
}) {
  return (
    <div
      className={`hidden ${GRID_COLS} border-b border-zinc-800 bg-zinc-950/60 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-zinc-100 lg:grid ledger:border-b-zinc-50 ledger:bg-transparent ledger:font-sans ledger:normal-case ledger:text-[0.8125rem] ledger:tracking-normal ledger:text-zinc-500`}
    >
      <SortHeader sortKey="status" sort={sort} onSortChange={onSortChange}>Status</SortHeader>
      <SortHeader sortKey="timestamp" sort={sort} onSortChange={onSortChange}>Date (UTC)</SortHeader>
      <SortHeader sortKey="url" sort={sort} onSortChange={onSortChange}>URL</SortHeader>
      <SortHeader sortKey="collection" sort={sort} onSortChange={onSortChange}>Collection</SortHeader>
      <SortHeader sortKey="size" sort={sort} onSortChange={onSortChange} align="right">Size</SortHeader>
      <span className="text-right text-zinc-500">Action</span>
    </div>
  );
}

function SortHeader({
  sortKey,
  sort,
  onSortChange,
  align = "left",
  children
}: {
  sortKey: SortKey;
  sort: SortOption;
  onSortChange: (next: SortOption) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [activeKey, activeDir] = sort.split("-") as [SortKey, SortDir];
  const isActive = activeKey === sortKey;
  const handleClick = () => {
    if (isActive) {
      const flipped: SortDir = activeDir === "asc" ? "desc" : "asc";
      onSortChange(`${sortKey}-${flipped}` as SortOption);
    } else {
      onSortChange(`${sortKey}-${DEFAULT_DIR[sortKey]}` as SortOption);
    }
  };
  const Icon = !isActive ? ChevronsUpDown : activeDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-sort={isActive ? (activeDir === "asc" ? "ascending" : "descending") : "none"}
      className={`inline-flex items-center gap-1.5 rounded-sm outline-none hover:text-amber-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ledger:rounded-none ledger:transition-colors ledger:duration-150 ledger:hover:text-amber-300 ${
        align === "right" ? "justify-end" : "justify-start"
      } ${isActive ? "text-amber-200" : "text-zinc-100 ledger:text-zinc-500"}`}
    >
      <span>{children}</span>
      <Icon size={12} className={isActive ? "text-amber-300" : "text-zinc-500"} aria-hidden />
    </button>
  );
}

type CaptureRowProps = {
  capture: CommonCrawlCapture;
  backContext: ResultsBackContext;
  scanId?: string;
  /** Content digest differs from the previous capture of this URL (see lib/capture-changes.ts). */
  changed?: boolean;
};

function CaptureRowImpl({ capture, backContext, scanId, changed = false }: CaptureRowProps) {
  const viewerUrl = createViewerHref(capture, { scanId, legacyBackContext: backContext });
  const isRedirect = /^3\d\d$/.test(capture.status);
  const statusTone = capture.status === "200" ? "green" : isRedirect ? "amber" : "neutral";
  const isHtml = capture.mime === "text/html";
  const [dateText, timeText] = splitDateTime(formatTimestampCompact(capture.timestamp));
  const [hintOpen, setHintOpen] = useState(false);
  const urlParts = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)(.*)$/i.exec(capture.url);

  // Warm the capture cache on a brief hover/focus so opening the viewer is
  // instant. Debounced so a quick pass over the list doesn't fire a request.
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPrefetch = () => {
    if (!isHtml || hoverTimerRef.current) return;
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      prefetchCaptureRecord(capture);
    }, 150);
  };
  const cancelPrefetch = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  return (
    <article
      onMouseEnter={startPrefetch}
      onMouseLeave={cancelPrefetch}
      onFocus={startPrefetch}
      onBlur={cancelPrefetch}
      className={`group px-4 py-3 text-sm hover:bg-zinc-900/60 [content-visibility:auto] [contain-intrinsic-size:auto_3.25rem] ${GRID_COLS} ledger:rounded-none ledger:transition-colors ledger:duration-150 ledger:ease-out ledger:hover:bg-zinc-950`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 lg:mb-0">
        <Tooltip content={describeHttpStatus(capture.status)}>
          <Badge
            tone={statusTone}
            className={isRedirect ? "justify-center ledger:font-mono ledger:!border-[#9a6200] ledger:text-[#9a6200]" : "justify-center ledger:font-mono"}
          >
            {capture.status}
          </Badge>
        </Tooltip>
        <span className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-400 lg:hidden">
          {formatTimestampCompact(capture.timestamp)}
        </span>
        {changed ? (
          <button
            type="button"
            aria-expanded={hintOpen}
            aria-label={CHANGED_HINT}
            title={CHANGED_HINT}
            onClick={() => setHintOpen((open) => !open)}
            className="-my-2 inline-grid min-h-11 min-w-11 place-items-center rounded-sm text-amber-200 lg:hidden ledger:text-amber-300"
          >
            <PencilLine size={14} aria-hidden />
          </button>
        ) : null}
        <span className="min-w-0 truncate font-mono text-xs text-zinc-500 lg:hidden">{capture.collectionId}</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-zinc-400 lg:hidden">
          {formatBytes(capture.length)}
        </span>
      </div>

      <div className="hidden font-mono text-xs tabular-nums text-zinc-400 lg:block ledger:text-[13px] ledger:font-bold ledger:text-zinc-50">
        <span>{dateText}</span>
        {changed ? (
          <span
            title={CHANGED_HINT}
            className="ml-2 hidden items-center ledger:inline-flex gap-1 whitespace-nowrap align-middle font-sans text-[0.6875rem] font-semibold leading-4 text-amber-200 ledger:cursor-help ledger:text-amber-300"
          >
            <PencilLine size={13} aria-hidden className="shrink-0" />
            <span className="sr-only">{CHANGED_HINT}</span>
          </span>
        ) : null}
        {timeText !== null ? (
          <>
            {" "}
            <span className="ledger:block ledger:text-[12px] ledger:font-normal ledger:text-zinc-500">{timeText}</span>
          </>
        ) : null}
      </div>

      {changed && hintOpen ? (
        <p className="mb-2 text-xs text-zinc-400 lg:hidden">{CHANGED_HINT}</p>
      ) : null}

      <div className="min-w-0">
        <p
          className="break-all font-medium text-zinc-100 lg:truncate lg:break-normal ledger:font-mono ledger:text-[13.5px] ledger:font-normal ledger:text-zinc-300"
          title={capture.url}
        >
          {urlParts ? (
            <>
              <span className="ledger:text-zinc-50">{urlParts[1]}</span>
              {urlParts[2]}
            </>
          ) : (
            capture.url
          )}
        </p>
        {capture.redirect ? (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-200/90">
            <p className="flex min-w-0 items-center gap-1 lg:truncate" title={capture.redirect}>
              <CornerDownRight size={11} className="shrink-0 text-amber-300/70" />
              <span className="break-all lg:truncate lg:break-normal">{capture.redirect}</span>
            </p>
          </div>
        ) : null}
        {!isHtml ? (
          <p className="mt-0.5 text-xs uppercase tracking-[0.12em] text-zinc-500 ledger:font-mono ledger:normal-case ledger:tracking-normal">
            {capture.mime}
          </p>
        ) : null}
      </div>

      <div
        className="hidden truncate font-mono text-xs text-zinc-400 lg:block ledger:text-[12.5px] ledger:text-zinc-500"
        title={capture.collectionId}
      >
        {capture.collectionId}
      </div>

      <div className="hidden text-right font-mono text-xs tabular-nums text-zinc-400 lg:block">
        {formatBytes(capture.length)}
      </div>

      <div className="mt-3 flex justify-end lg:mt-0">
        <LinkButton
          href={viewerUrl}
          target="_blank"
          rel="noreferrer"
          size="sm"
          className="w-full whitespace-nowrap sm:w-auto lg:w-full lg:justify-center ledger:border-zinc-50 ledger:bg-transparent ledger:text-zinc-50 ledger:group-hover:bg-zinc-50 ledger:group-hover:text-zinc-950 ledger:motion-safe:active:scale-[0.97] ledger:duration-100"
        >
          <ArrowUpRight size={14} className="ledger:motion-safe:transition-transform ledger:motion-safe:duration-200 ledger:motion-safe:ease-[cubic-bezier(0.2,0.8,0.2,1)] ledger:motion-safe:group-hover:translate-x-0.5" />
          View
        </LinkButton>
      </div>
    </article>
  );
}

// Memoized so streaming scan-progress re-renders of the parent don't re-render
// every visible row. The capture object may be rebuilt during result merges, so
// compare by capture identity key plus the fields the row actually renders;
// backContext is memoized upstream and scanId is stable.
export const CaptureRow = memo(CaptureRowImpl, (prev, next) => {
  return (
    prev.scanId === next.scanId &&
    prev.backContext === next.backContext &&
    prev.changed === next.changed &&
    captureKey(prev.capture) === captureKey(next.capture) &&
    prev.capture.status === next.capture.status &&
    prev.capture.mime === next.capture.mime &&
    prev.capture.redirect === next.capture.redirect &&
    prev.capture.length === next.capture.length &&
    prev.capture.url === next.capture.url
  );
});

function formatTimestampCompact(timestamp: string): string {
  if (!/^\d{14}$/.test(timestamp)) return formatTimestamp(timestamp);
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)} ${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}`;
}

/** Splits "YYYY-MM-DD HH:MM" into date and time; time is null when absent. */
function splitDateTime(text: string): [string, string | null] {
  const index = text.indexOf(" ");
  if (index === -1) return [text, null];
  return [text.slice(0, index), text.slice(index + 1)];
}
