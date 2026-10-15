"use client";

import { cn } from "@/lib/utils";

export type ScanCellState = "queued" | "empty" | "hit" | "failed" | "scanning";

type ScanProgressGridProps = {
  collectionIds: readonly string[];
  checkedIds: ReadonlySet<string>;
  failedIds: ReadonlySet<string>;
  capturedIds: ReadonlySet<string>;
  scanningIds: readonly string[];
};

const LEGEND: { state: Exclude<ScanCellState, "scanning">; label: string }[] = [
  { state: "empty", label: "scanned" },
  { state: "hit", label: "has captures" },
  { state: "failed", label: "failed" },
  { state: "queued", label: "queued" }
];

/** Precedence: an active collection shows as scanning even if it failed before. */
export function classifyScanCell(
  id: string,
  input: Pick<ScanProgressGridProps, "checkedIds" | "failedIds" | "capturedIds" | "scanningIds">
): ScanCellState {
  if (input.scanningIds.includes(id)) return "scanning";
  if (input.failedIds.has(id)) return "failed";
  if (input.checkedIds.has(id)) return input.capturedIds.has(id) ? "hit" : "empty";
  return "queued";
}

const CELL_BASE = "size-3 shrink-0 rounded-[1px] border";

const CELL_CLASS: Record<ScanCellState, string> = {
  queued: "border-zinc-600",
  empty: "border-zinc-50 bg-zinc-50",
  hit: "border-amber-300 bg-amber-300",
  failed: "border-amber-300",
  scanning: "border-amber-300 motion-safe:animate-pulse"
};

const HATCH_STYLE = {
  backgroundImage: "repeating-linear-gradient(45deg, var(--ledger-stamp) 0 2px, transparent 2px 4px)"
} as const;

function cellStyle(state: ScanCellState) {
  return state === "failed" ? HATCH_STYLE : undefined;
}

export function ScanProgressGrid({ collectionIds, checkedIds, failedIds, capturedIds, scanningIds }: ScanProgressGridProps) {
  if (collectionIds.length === 0) return null;

  const states = collectionIds.map((id) => classifyScanCell(id, { checkedIds, failedIds, capturedIds, scanningIds }));
  const count = (wanted: ScanCellState) => states.filter((state) => state === wanted).length;
  const scanned = count("empty") + count("hit");
  const withCaptures = count("hit");
  const failed = count("failed");
  const summary = `${scanned} of ${collectionIds.length} collections scanned, ${withCaptures} with captures, ${failed} failed`;

  return (
    <div className="hidden ledger:mt-3 ledger:block">
      <div
        role="img"
        aria-label={summary}
        className="flex max-w-[34rem] flex-wrap gap-[3px]"
      >
        {collectionIds.map((id, index) => {
          const state = states[index];
          return (
            <span
              key={id}
              aria-hidden="true"
              data-state={state}
              className={cn(CELL_BASE, CELL_CLASS[state], "ledger:transition-[background-color,border-color] ledger:duration-300 ledger:ease-out")}
              style={cellStyle(state)}
            />
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 font-sans text-[0.8125rem] text-zinc-500">
        {LEGEND.map((item) => (
          <span key={item.state} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden="true"
              className={cn("inline-block size-[9px] border", CELL_CLASS[item.state])}
              style={cellStyle(item.state)}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
