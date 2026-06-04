import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-50 shadow-inner outline-none transition placeholder:text-zinc-500 hover:border-zinc-600 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/15",
        className
      )}
      {...props}
    />
  );
  }
);
