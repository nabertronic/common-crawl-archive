"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Tooltip({
  content,
  children,
  side = "top",
  className,
  arrowClassName
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
  arrowClassName?: string;
}) {
  // Touch has no hover: a tap shows the tooltip briefly.
  const [touchOpen, setTouchOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <span
      className="group/tooltip relative inline-flex"
      data-open={touchOpen}
      onPointerUp={(event) => {
        if (event.pointerType !== "touch") return;
        setTouchOpen(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setTouchOpen(false), 2500);
      }}
    >
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-700/80 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-100 opacity-0 shadow-md shadow-black/40 transition-opacity duration-75 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 group-data-[open=true]/tooltip:opacity-100 ledger:rounded-[3px] ledger:border-zinc-50 ledger:bg-zinc-950 ledger:shadow-none ledger:backdrop-blur-none ledger:transition-[opacity,translate] ledger:duration-150 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)] ledger:motion-safe:group-hover/tooltip:translate-y-0 ledger:motion-safe:group-focus-within/tooltip:translate-y-0 ledger:motion-safe:group-data-[open=true]/tooltip:translate-y-0",
          side === "top" ? "bottom-full mb-1.5 ledger:motion-safe:translate-y-[3px]" : "top-full mt-1.5 ledger:motion-safe:-translate-y-[3px]",
          className
        )}
      >
        {content}
        <span
          aria-hidden
          className={cn(
            "absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-zinc-700/80 bg-zinc-900 ledger:border-zinc-50 ledger:bg-zinc-950",
            side === "top"
              ? "-bottom-1 border-b border-r"
              : "-top-1 border-l border-t",
            arrowClassName
          )}
        />
      </span>
    </span>
  );
}
