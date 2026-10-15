"use client";

import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { History, Menu, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type MenuItem = {
  href: string;
  label: string;
  icon: "history" | "search" | "settings";
  description?: string;
};

const ICONS: Record<MenuItem["icon"], ComponentType<{ size?: number; className?: string }>> = {
  history: History,
  search: Search,
  settings: Settings
};

const DEFAULT_ITEMS: MenuItem[] = [
  { href: "/history", label: "History", icon: "history", description: "Past scans on this device" },
  { href: "/settings", label: "Settings", icon: "settings", description: "Storage, privacy and data" }
];

export function TopRightMenu({
  mode = "fixed",
  items = DEFAULT_ITEMS
}: {
  mode?: "fixed" | "inline";
  items?: MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const itemClass =
    "relative flex min-h-11 items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.07] focus:outline-none focus-visible:bg-white/[0.07] ledger:group ledger:min-h-[3.25rem] ledger:gap-3 ledger:rounded-[3px] ledger:px-3.5 ledger:py-3 ledger:font-sans ledger:font-normal ledger:text-[var(--ledger-ink)] ledger:border-b ledger:border-[var(--ledger-rule)] ledger:last:border-b-0 ledger:transition-[background-color,color] ledger:duration-150 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)] ledger:hover:bg-[var(--ledger-paper)] ledger:focus-visible:bg-[var(--ledger-paper)] ledger:after:shrink-0 ledger:after:text-[var(--ledger-ink-2)] ledger:after:transition-[transform,color] ledger:after:duration-200 ledger:after:ease-[cubic-bezier(0.2,0.8,0.2,1)] ledger:after:content-['→'] ledger:after:inline-block ledger:group-hover:after:translate-x-[3px] ledger:group-hover:after:text-[var(--ledger-stamp)] ledger:group-focus-visible:after:translate-x-[3px] ledger:group-focus-visible:after:text-[var(--ledger-stamp)]";
  const containerClass =
    mode === "fixed"
      ? "fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-[80] md:right-8 md:top-6"
      : "relative z-[80] ml-auto";

  return (
    <div ref={containerRef} className={containerClass}>
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-11 w-11 place-items-center rounded-xl border border-zinc-700 bg-zinc-950/70 backdrop-blur text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ledger:flex ledger:!h-11 ledger:!w-auto ledger:items-center ledger:gap-2.5 ledger:rounded-[3px] ledger:border-0 ledger:bg-transparent ledger:px-3 ledger:backdrop-blur-none ledger:text-[var(--ledger-ink)] ledger:hover:border-0 ledger:hover:text-[var(--ledger-stamp)] ledger:focus-visible:ring-[var(--ledger-stamp)] ledger:focus-visible:ring-offset-[var(--ledger-paper)] ledger:motion-safe:active:scale-[0.97] ledger:transition-[color,scale] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <Menu size={20} aria-hidden="true" className="ledger:hidden" />
        <span className="hidden ledger:inline-flex ledger:items-center ledger:gap-2.5">
          <span className="font-sans text-sm font-semibold">{open ? "Close" : "Menu"}</span>
          <span aria-hidden="true" className="relative block h-[6.5px] w-[18px]">
            <span
              className={`absolute inset-x-0 top-0 h-[1.5px] bg-current transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${open ? "translate-y-[2.5px] rotate-45" : ""}`}
            />
            <span
              className={`absolute inset-x-0 bottom-0 h-[1.5px] bg-current transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${open ? "-translate-y-[2.5px] -rotate-45" : ""}`}
            />
          </span>
        </span>
      </button>
      {open ? (
        <nav
          id={menuId}
          aria-label="App navigation"
          className="menu-popover absolute right-0 z-50 mt-2 origin-top-right w-48 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/80 p-1 shadow-2xl shadow-black/60 [&>a]:rounded-lg ledger:w-72 ledger:max-w-[calc(100vw-2rem)] ledger:max-h-[calc(100dvh-6rem)] ledger:overflow-y-auto ledger:overscroll-contain ledger:rounded-[4px] ledger:border-[var(--ledger-rule)] ledger:p-2 ledger:[&>a]:rounded-[3px]"
        >
          {items.map((item, index) => {
            const Icon = ICONS[item.icon];
            const current = pathname === item.href || (pathname?.startsWith(`${item.href}/`) ?? false);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${itemClass} ledger:motion-safe:animate-[ledger-menu-in_200ms_cubic-bezier(0.2,0.8,0.2,1)_both]`}
                style={{ animationDelay: `${index * 40 + 40}ms` }}
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {current ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-3 left-0 hidden w-0.5 bg-[var(--ledger-stamp)] ledger:block"
                  />
                ) : null}
                <Icon size={16} className="ledger:hidden" aria-hidden="true" />
                <span className="ledger:min-w-0 ledger:flex-1">
                  <span className="ledger:block ledger:font-serif ledger:text-[1.375rem] ledger:leading-tight ledger:transition-colors ledger:group-hover:text-[var(--ledger-stamp)] ledger:group-focus-visible:text-[var(--ledger-stamp)]">
                    {item.label}
                  </span>
                  {item.description ? (
                    <span className="hidden ledger:block ledger:mt-0.5 ledger:text-[0.8125rem] ledger:text-[var(--ledger-ink-3)]">
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
