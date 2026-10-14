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
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}
