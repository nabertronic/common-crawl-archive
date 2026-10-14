"use client";

import Link from "next/link";
import { BrandWordmark } from "@/components/brand";
import { openWebsitePreferences } from "@/lib/website-preferences";

const linkClass = "rounded-sm text-xs text-zinc-400 transition hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto w-full max-w-3xl px-5 pb-8 pt-6 sm:px-8">
      <div className="flex flex-col gap-5 border-t border-zinc-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" aria-label="Crawlback home" className="w-fit rounded-sm text-zinc-500 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">
          <BrandWordmark className="text-base leading-none" />
        </Link>
        <nav aria-label="Website information" className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link href="/privacy" className={linkClass}>Privacy</Link>
          <Link href="/imprint" className={linkClass}>Legal notice</Link>
          <button type="button" onClick={openWebsitePreferences} className={linkClass}>Website settings</button>
        </nav>
      </div>
    </footer>
  );
}
