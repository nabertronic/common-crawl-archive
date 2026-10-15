import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-base text-zinc-50 sm:text-sm shadow-inner outline-none transition placeholder:text-zinc-500 hover:border-zinc-600 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/15 ledger:rounded-[3px] ledger:border-zinc-600 ledger:shadow-none ledger:transition-[border-color,box-shadow] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)] ledger:hover:border-zinc-50 ledger:focus:ring-2 ledger:focus:ring-amber-300/20",
        className
      )}
      {...props}
    />
  );
  }
);
