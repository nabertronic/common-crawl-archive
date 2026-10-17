"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLockup } from "@/components/brand";
import { LandingSections } from "@/components/landing-sections";
import { TopRightMenu } from "@/components/top-right-menu";
import { HeroStamp } from "@/components/ledger/hero-stamp";
import { grantStorageConsent, hasStorageConsent, openWebsitePreferences, subscribeStorageConsent } from "@/lib/website-preferences";

import { isPastPageEntry } from "@/lib/pastpage-entry";
import { isTemporaryScanId } from "@/lib/temporary-scan-store";

const STORAGE_ROUTES = new Set(["/", "/search", "/history", "/settings", "/view"]);

/** Gates storage-backed features; PastPage can scan with visit-local state. */
export function StorageConsentGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pastPageEntry = isPastPageEntry(pathname, searchParams);
  const temporaryScanRoute = isTemporaryScanId(searchParams.get("scan"));
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
  if (!protectedRoute || granted || pastPageEntry || (pathname === "/view" && temporaryScanRoute) || (pathname === "/search" && temporaryScanRoute)) return <>{children}</>;

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
        <div className="relative z-10 grid min-h-[100svh] w-full justify-items-center content-start px-5 pb-24 pt-[max(5rem,22svh)] md:px-8 ledger:items-start ledger:content-start ledger:md:px-0">
          <HeroStamp />
          <header className="w-full max-w-3xl p-0 ledger:max-w-6xl ledger:md:px-10">
            <div className="mb-8 flex flex-col items-center gap-3 text-center ledger:mb-10 ledger:items-start ledger:gap-5 ledger:text-left">
              <h1><BrandLockup size="hero" className="justify-center gap-5" wordClassName="leading-none decode-in ledger:text-2xl" /></h1>
              <p className="reveal ledger-hero-title text-balance text-center text-lg leading-snug text-zinc-300 sm:text-xl ledger:max-w-[18ch] ledger:text-left ledger:font-serif ledger:font-normal ledger:text-5xl ledger:leading-[0.95] ledger:tracking-[-0.02em] ledger:text-zinc-50 ledger:sm:text-7xl" style={{ animationDelay: "200ms" }}>Find <em className="ledger-hero-mark not-italic ledger:italic">archived</em> copies of pages the web forgot.</p>
            </div>
            <form onSubmit={startSearch} className="ledger-hero-form flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-base font-bold leading-none text-amber-300 ledger:hidden">&gt;</span>
                <Input
                  aria-label="URL to search"
                  type="text"
                  inputMode="url"
                  placeholder="whitehouse.gov/administration"
                  autoComplete="off"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="terminal-input h-12 rounded-xl pl-9 font-mono ledger:h-14 ledger:rounded-[3px] ledger:px-4 ledger:text-xl"
                />
              </div>
              <Button type="submit" className="ledger-start-button group h-12 w-full shrink-0 whitespace-nowrap rounded-xl px-5 text-[0.9375rem] transition-transform hover:-translate-y-0.5 active:translate-y-0 sm:w-auto ledger:h-14 ledger:hover:translate-y-0 ledger:text-base">
                <Play size={16} className="ledger:hidden" />Start scan
                <span aria-hidden className="ledger-start-arrow hidden ledger:inline-block">→</span>
              </Button>
            </form>
            <div className="ledger-hero-form mt-2 flex flex-col items-center gap-3 text-center sm:items-end ledger:mt-4 ledger:items-start ledger:text-left">
              <Button type="button" variant="ghost" onClick={requestAdvancedSearch} className="min-h-11 text-zinc-300 hover:text-amber-200 ledger:font-sans ledger:normal-case ledger:tracking-normal">Advanced search</Button>
            </div>
          </header>
          <a href="#how-it-works" aria-label="Learn how Crawlback works" className="reveal-fade group absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 flex h-12 w-12 sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))] sm:h-14 sm:w-14 -translate-x-1/2 items-center justify-center rounded-full border border-amber-300/55 bg-zinc-950/70 text-amber-200 shadow-[0_0_0_1px_rgba(250,204,21,0.12)] backdrop-blur-sm transition hover:border-amber-200 hover:bg-amber-300/10 hover:text-amber-100">
            <span className="scroll-hint block"><ChevronDown size={30} strokeWidth={2.6} /></span>
          </a>
        </div>
      </main>
      <LandingSections />
    </>;
  }
  if (pathname === "/settings") return <SettingsStoragePlaceholder />;
  const pageActions: Record<string, { title: string; action: string }> = {
    "/search": { title: "Search", action: "Start search" },
    "/history": { title: "Scan history", action: "View saved searches" },
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

const LOCKED_SETTINGS = ["Scan settings", "Results defaults", "Viewer", "Export defaults", "Danger zone"];

/** Settings need saved preferences, so without consent the page explains the choice and lists what unlocks. */
function SettingsStoragePlaceholder() {
  const [storageError, setStorageError] = useState("");
  const allowStorage = () => {
    setStorageError("");
    if (!grantStorageConsent()) setStorageError("Your browser did not allow storage. Check your browser settings and try again.");
  };

  return <main className="min-h-[55vh] px-5 py-10 text-zinc-100 md:px-8">
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="archive-panel rounded-md p-5">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300 ledger:hidden">Your browser, your choice</p>
        <h1 className="mt-2 text-xl font-bold">App settings</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-300">Your app settings are saved in this browser. The app will not save or load your data here until you allow browser storage.</p>
      </header>
      <section id="storage" aria-labelledby="storage-choice-title" className="archive-panel scroll-mt-5 rounded-md p-5">
        <h2 id="storage-choice-title" className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-100 ledger:normal-case ledger:tracking-normal">Browser storage</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-300">Status: <span className="font-semibold text-zinc-100">off</span>. If you allow it, Crawlback saves your search history, scan results, cached pages, and settings on this device.</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">You can turn storage off later in Website settings. That stops app features from using it but does not delete saved data.</p>
        {storageError && <p role="alert" className="mt-3 text-sm text-red-300">{storageError}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button onClick={allowStorage}>Allow browser storage</Button>
          <a className="text-xs text-zinc-400 underline decoration-zinc-600 underline-offset-4 hover:text-amber-200" href="/privacy">Privacy</a>
        </div>
      </section>
      <section aria-labelledby="locked-settings-title" className="archive-panel rounded-md p-5">
        <h2 id="locked-settings-title" className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-100 ledger:normal-case ledger:tracking-normal">Available after you allow storage</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {LOCKED_SETTINGS.map((label) => (
            <li key={label} aria-disabled="true" className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-500">{label}</li>
          ))}
        </ul>
      </section>
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
