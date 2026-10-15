import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "green" | "amber" | "red" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] ledger:rounded-[2px] ledger:border-current ledger:bg-transparent ledger:font-sans ledger:normal-case ledger:font-bold ledger:tracking-normal ledger:transition-[color,background-color,border-color] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        tone === "green" && "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
        tone === "amber" && "border-amber-300/40 bg-amber-300/10 text-amber-200",
        tone === "red" && "border-red-400/40 bg-red-400/10 text-red-200",
        tone === "neutral" && "border-zinc-700 bg-zinc-900 text-zinc-300",
        className
      )}
      {...props}
    />
  );
}
