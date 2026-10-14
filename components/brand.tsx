import { cn } from "@/lib/utils";

type BrandLockupProps = {
  className?: string;
  wordClassName?: string;
  size?: "compact" | "hero";
};

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-mono font-extrabold tracking-[-0.04em] text-zinc-50", className)}>
      crawl<span className="text-amber-300">back</span>
    </span>
  );
}

export function BrandLockup({
  className,
  wordClassName,
  size = "compact"
}: BrandLockupProps) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <BrandWordmark className={cn(size === "hero" ? "text-5xl leading-none sm:text-7xl" : "text-xl leading-none", wordClassName)} />
    </span>
  );
}
