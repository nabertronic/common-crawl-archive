"use client";

import type { RefObject } from "react";

export function DateControl({
  label,
  value,
  onChange,
  inputRef,
  min,
  max,
  disabled
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 ledger:font-sans ledger:normal-case ledger:tracking-normal ledger:text-[0.8125rem] ledger:text-zinc-400">{label}</span>
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full sm:h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-base sm:text-sm text-zinc-100 outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50 ledger:rounded-[3px] ledger:border-zinc-50 ledger:bg-zinc-950 ledger:shadow-none ledger:transition-[border-color,box-shadow] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)] ledger:focus:ring-2 ledger:focus:ring-amber-300/20"
      />
    </label>
  );
}
