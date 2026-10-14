"use client";

import Link from "next/link";
import { BrandWordmark } from "@/components/brand";
import { GITHUB_REPOSITORY_URL } from "@/lib/app-meta";
import { openWebsitePreferences } from "@/lib/website-preferences";

const linkClass = "inline-flex min-h-11 items-center rounded-sm text-sm text-zinc-300 transition hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 md:px-8">
      <div className="flex flex-col gap-4 border-t border-zinc-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" aria-label="Crawlback home" className="inline-flex min-h-11 w-fit items-center rounded-sm text-zinc-400 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">
          <BrandWordmark className="text-base leading-none" />
        </Link>
        <nav aria-label="Website information" className="grid grid-cols-2 gap-x-6 sm:flex sm:flex-wrap sm:items-center sm:gap-x-5">
          <Link href="/#how-it-works" className={linkClass}>How it works</Link>
          <Link href="/#faq" className={linkClass}>FAQ</Link>
          <Link href="/privacy" className={linkClass}>Privacy</Link>
          <Link href="/terms" className={linkClass}>Terms</Link>
          <Link href="/imprint" rel="nofollow" className={linkClass}>Legal notice</Link>
          <button type="button" onClick={openWebsitePreferences} className={linkClass}>Website settings</button>
          <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
