import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-45 ledger:rounded-[3px] ledger:shadow-none ledger:font-bold ledger:transition-[background-color,color,border-color,transform] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)] ledger:motion-safe:active:scale-[0.97] ledger:active:duration-75",
  {
    variants: {
      variant: {
        primary:
          "border-amber-300 bg-amber-300 text-zinc-950 shadow-[0_8px_24px_rgba(252,211,77,0.25)] hover:bg-amber-200 focus-visible:outline-amber-300 disabled:border-amber-300/25 disabled:bg-amber-300/15 disabled:text-amber-100/80 disabled:shadow-none disabled:opacity-100 ledger:border-zinc-50 ledger:bg-zinc-50 ledger:text-zinc-950 ledger:shadow-none ledger:hover:bg-amber-300 ledger:hover:border-amber-300 ledger:disabled:border-zinc-700 ledger:disabled:bg-zinc-900 ledger:disabled:text-zinc-500",
        secondary:
          "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800 focus-visible:outline-zinc-500 ledger:border-zinc-50 ledger:bg-transparent ledger:text-zinc-50 ledger:hover:border-zinc-50 ledger:hover:bg-zinc-50 ledger:hover:text-zinc-950",
        ghost:
          "border-transparent bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-white focus-visible:outline-zinc-500 ledger:text-zinc-50 ledger:hover:bg-zinc-900 ledger:hover:text-zinc-50",
        danger:
          "border-red-500/40 bg-red-500/15 text-red-100 hover:bg-red-500/25 focus-visible:outline-red-400 ledger:border-amber-300 ledger:bg-transparent ledger:text-amber-300 ledger:hover:bg-amber-300 ledger:hover:text-zinc-950"
      },
      size: {
        sm: "h-11 px-3 sm:h-9 text-[0.8125rem]",
        md: "h-11 px-4 sm:h-10",
        lg: "h-12 px-5"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";

export function LinkButton({
  className,
  variant,
  size,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof buttonVariants>) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
