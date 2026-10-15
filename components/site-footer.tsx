"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { BrandWordmark } from "@/components/brand";
import { GITHUB_REPOSITORY_URL } from "@/lib/app-meta";
import { openWebsitePreferences } from "@/lib/website-preferences";

const linkClass = "ledger-underline inline-flex min-h-11 items-center rounded-sm text-sm text-zinc-300 transition hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300";

/**
 * Guarantees a new route starts at the top. The footer lives in the root layout and so
 * survives navigation; as the only persistent node near the viewport it can otherwise act as
 * the browser's scroll anchor and drag the new page down when its height changes. Hash
 * navigations (#faq) are left to the browser/Next so they keep smooth-scrolling.
 */
function ScrollToTopOnNavigate() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (window.location.hash) return;
    const html = document.documentElement;
    const top = () => {
      const behavior = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      window.scrollTo(0, 0);
      html.style.scrollBehavior = behavior;
    };
    top();
    // Re-assert after fonts/images/layout settle so late shifts cannot leave the page mid-way.
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (window.scrollY > 0 && !window.location.hash) top();
    }));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);
  return null;
}

export function SiteFooter() {
  return (
    <footer className="[overflow-anchor:none] relative z-10 mx-auto w-full max-w-7xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 md:px-8">
      <ScrollToTopOnNavigate />
      <div className="flex flex-col gap-4 border-t border-zinc-800 pt-6 sm:flex-row sm:items-center sm:justify-between ledger:border-t-zinc-50">
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
