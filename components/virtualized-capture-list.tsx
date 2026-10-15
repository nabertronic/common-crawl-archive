"use client";

import { useRef } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { CaptureRow } from "@/components/capture-row";
import { captureKey } from "@/lib/scan-results";
import type { CommonCrawlCapture, ResultsBackContext } from "@/lib/common-crawl";

/**
 * Renders the full result set but only mounts the rows near the viewport, using
 * window-scroll virtualization with dynamic row measurement (rows vary in height
 * because URLs wrap). This keeps the DOM small for very large result sets while
 * preserving normal page scrolling — no inner scroll container, no pagination.
 */
export function VirtualizedCaptureList({
  captures,
  backContext,
  scanId,
  changedKeys
}: {
  captures: CommonCrawlCapture[];
  backContext: ResultsBackContext;
  scanId?: string;
  /** captureKeys whose content changed since the previous capture of the URL. */
  changedKeys?: Set<string>;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useWindowVirtualizer({
    count: captures.length,
    estimateSize: () => 64,
    overscan: 8,
    // Offset of this list within the document, so window scroll maps to rows.
    scrollMargin: listRef.current?.offsetTop ?? 0
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={listRef} style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}>
      {virtualItems.map((virtualRow) => {
        const capture = captures[virtualRow.index];
        return (
          <div
            key={captureKey(capture)}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className={virtualRow.index === 0 ? undefined : "border-t border-zinc-800/70"}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`
            }}
          >
            <CaptureRow
              capture={capture}
              backContext={backContext}
              scanId={scanId}
              changed={changedKeys?.has(captureKey(capture)) ?? false}
            />
          </div>
        );
      })}
    </div>
  );
}

export default VirtualizedCaptureList;
