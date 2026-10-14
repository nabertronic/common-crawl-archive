"use client";

import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLockup } from "@/components/brand";
import { LandingSections } from "@/components/landing-sections";
import { TopRightMenu } from "@/components/top-right-menu";
import { hasStorageConsent, openWebsitePreferences, subscribeStorageConsent } from "@/lib/website-preferences";

const STORAGE_ROUTES = new Set(["/", "/search", "/history", "/settings", "/view"]);

/** Keeps app features that use this browser's storage from mounting before consent. */
export function StorageConsentGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [granted, setGranted] = useState(false);
  const [url, setUrl] = useState("");
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const protectedRoute = STORAGE_ROUTES.has(pathname);

  useEffect(() => {
    const sync = () => setGranted(hasStorageConsent());
    sync();
    return subscribeStorageConsent(sync);
  }, []);
  useEffect(() => {
    if (!granted || pendingUrl === null) return;
    if (pathname !== "/") { setPendingUrl(null); return; }
    const query = pendingUrl ? `?url=${encodeURIComponent(pendingUrl)}` : "";
    setPendingUrl(null);
    router.push(`/search${query}`);
  }, [granted, pendingUrl, pathname, router]);
  useEffect(() => {
    if (pathname !== "/" && pendingUrl !== null) setPendingUrl(null);
  }, [pathname, pendingUrl]);

  const blocked = () => openWebsitePreferences();
  const startSearch = (event: FormEvent) => {
    event.preventDefault();
    setPendingUrl(url.trim());
    blocked();
  };
  const requestAdvancedSearch = () => {
    setPendingUrl(url.trim());
    blocked();
  };
  if (!protectedRoute || granted) return <>{children}</>;

  // These short explanations keep deep links useful without loading app code.
  if (pathname === "/") {
    return <>
      <main id="top" className="relative min-h-[100svh] text-zinc-100">
        <div className="landing-atmosphere" aria-hidden="true">
          <div className="landing-scanlines" />
          <div className="landing-grain" />
          <div className="landing-vignette" />
        </div>
        <ConsentLandingHeroMenu />
        <div className="relative z-10 grid min-h-[100svh] w-full place-items-center px-5 pb-24 pt-20 md:px-8">
          <header className="w-full max-w-3xl p-0">
            <div className="mb-8 flex flex-col items-center gap-3 text-center">
              <h1><BrandLockup size="hero" className="justify-center gap-5" wordClassName="leading-none decode-in" /></h1>
              <p className="reveal text-balance text-center text-lg leading-snug text-zinc-300 sm:text-xl" style={{ animationDelay: "200ms" }}>Find archived versions of web pages.</p>
            </div>
            <form onSubmit={startSearch} className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-base font-bold leading-none text-amber-300">&gt;</span>
                <Input
                  aria-label="URL to search"
                  type="text"
                  inputMode="url"
                  placeholder="whitehouse.gov/administration"
                  autoComplete="off"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="terminal-input h-12 rounded-xl pl-9 font-mono"
                />
              </div>
              <Button type="submit" className="h-12 w-full shrink-0 whitespace-nowrap rounded-xl px-5 text-[0.9375rem] transition-transform hover:-translate-y-0.5 active:translate-y-0 sm:w-auto">
                <Play size={16} />Start scan
              </Button>
            </form>
            <div className="mt-2 flex flex-col items-center gap-3 text-center sm:items-end">
              <Button type="button" variant="ghost" onClick={requestAdvancedSearch} className="min-h-11 text-zinc-300 hover:text-amber-200">Advanced search</Button>
            </div>
          </header>
          <a href="#how-it-works" aria-label="Learn how Crawlback works" className="reveal-fade group absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border border-amber-300/55 bg-zinc-950/70 text-amber-200 shadow-[0_0_0_1px_rgba(250,204,21,0.12)] backdrop-blur-sm transition hover:border-amber-200 hover:bg-amber-300/10 hover:text-amber-100">
            <span className="scroll-hint block"><ChevronDown size={30} strokeWidth={2.6} /></span>
          </a>
        </div>
      </main>
      <LandingSections />
    </>;
  }
  const pageActions: Record<string, { title: string; action: string }> = {
    "/search": { title: "Search", action: "Start search" },
    "/history": { title: "Scan history", action: "View saved searches" },
    "/settings": { title: "App settings", action: "Open settings" },
    "/view": { title: "Archived page", action: "Open archived page" }
  };
  const page = pageActions[pathname] ?? { title: "Crawlback", action: "Continue" };
  return <main className="min-h-[55vh] px-5 py-10 text-zinc-100 md:px-8">
    <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
      <h1 className="text-xl font-bold">{page.title}</h1>
      <Button variant="secondary" onClick={blocked}>{page.action}</Button>
    </div>
  </main>;
}

function ConsentLandingHeroMenu() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setHidden(window.scrollY > Math.max(220, window.innerHeight * 0.42));
    };
    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  return <div className={hidden ? "landing-hero-menu is-hidden" : "landing-hero-menu"}><TopRightMenu /></div>;
}
