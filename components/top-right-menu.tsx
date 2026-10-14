"use client";

import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { History, Menu, Search, Settings } from "lucide-react";
import Link from "next/link";

type MenuItem = {
  href: string;
  label: string;
  icon: "history" | "search" | "settings";
};

const ICONS: Record<MenuItem["icon"], ComponentType<{ size?: number }>> = {
  history: History,
  search: Search,
  settings: Settings
};

const DEFAULT_ITEMS: MenuItem[] = [
  { href: "/history", label: "History", icon: "history" },
  { href: "/settings", label: "Settings", icon: "settings" }
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
    "flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 focus:outline-none focus-visible:bg-zinc-800";
  const containerClass =
    mode === "fixed"
      ? "fixed right-4 top-4 z-[80] md:right-8 md:top-6"
      : "relative z-[80] ml-auto";


  return (
    <div ref={containerRef} className={containerClass}>
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700 bg-zinc-950/70 text-zinc-200 transition hover:border-amber-300 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {open ? (
        <nav
          id={menuId}
          aria-label="App navigation"
          className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-md border border-zinc-700 bg-zinc-950/95 shadow-lg shadow-black/40 backdrop-blur"
        >
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <Link key={item.href} href={item.href} className={itemClass} onClick={() => setOpen(false)}>
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}

        </nav>
      ) : null}
    </div>
  );
}
