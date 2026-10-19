"use client";

import { useSyncExternalStore } from "react";
import { Bookmark, Puzzle } from "lucide-react";
import { usePastPageStore } from "@/lib/pastpage";
import { cn } from "@/lib/utils";

export type BookmarkHint =
  | { kind: "keys"; keys: readonly string[] }
  | { kind: "touch"; text: string };

type NavigatorLike = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
};

const IOS_TEXT =
  "Tap the Share button, then choose Add to Bookmarks or Add to Home Screen to save Crawlback for your next broken link.";
const ANDROID_TEXT =
  "Open your browser menu and tap the star or Bookmark option to save Crawlback for your next broken link.";

// Pure function so the platform rules can be tested without a browser.
export function detectBookmarkHint(nav: NavigatorLike): BookmarkHint {
  const ua = nav.userAgent;
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";

  // iPadOS reports itself as "MacIntel", so touch points are the only tell.
  if (/iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1)) {
    return { kind: "touch", text: IOS_TEXT };
  }
  if (/Android/i.test(ua)) {
    return { kind: "touch", text: ANDROID_TEXT };
  }
  return /mac/i.test(platform || ua) ? { kind: "keys", keys: ["⌘", "D"] } : { kind: "keys", keys: ["Ctrl", "D"] };
}

const noopSubscribe = () => () => {};

// Snapshots must be referentially stable, and the platform never changes, so detect once.
let clientHint: BookmarkHint | null = null;
function getClientHint(): BookmarkHint {
  clientHint ??= detectBookmarkHint(navigator);
  return clientHint;
}

const CELL_CLASS = "flex flex-col gap-3 p-5 sm:p-6 ledger:p-6 ledger:sm:p-8";
const TITLE_CLASS = "m-0 text-base font-bold text-zinc-50 ledger:font-serif ledger:text-[1.5rem] ledger:font-normal ledger:leading-[1.1]";
const BODY_CLASS = "m-0 text-[0.9375rem] leading-relaxed text-zinc-300 ledger:text-base";

// One framed panel with two cells so the bookmark tip and PastPage read as a single block.
// Server HTML renders the desktop copy (the hint's server snapshot is null, so markup
// matches); the bookmark cell reserves room for the longer touch text so hydration does
// not push the page down.
export function LandingBookmarkHint() {
  const hint = useSyncExternalStore(noopSubscribe, getClientHint, () => null);
  const store = usePastPageStore();

  return (
    <div className="mt-6 grid rounded-md ledger:mt-8 border border-zinc-800 bg-zinc-950/40 sm:grid-cols-2 ledger:rounded-none ledger:border-[1.5px] ledger:border-zinc-50 ledger:bg-transparent">
      <div className={CELL_CLASS}>
        <div className="flex items-center gap-2.5">
          <Bookmark size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-amber-300" />
          <h3 className={TITLE_CLASS}>Bookmark Crawlback</h3>
        </div>
        <p className={cn(BODY_CLASS, "min-h-[4.5rem] sm:min-h-0")}>
          {hint?.kind === "touch" ? hint.text : "Keep it one click away for your next broken link."}
        </p>
        {hint?.kind === "touch" ? null : (
          <p className="m-0 mt-auto flex min-h-7 items-center gap-2 text-[0.9375rem] text-zinc-300 ledger:text-base">
            {hint?.kind === "keys" ? (
              <>
                <span className="inline-flex items-center gap-1">
                  {hint.keys.map((key) => (
                    <kbd
                      key={key}
                      className="ledger-key inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border border-amber-300/35 border-b-2 bg-zinc-900 px-1.5 font-mono text-[0.8125rem] font-semibold leading-none text-amber-200 shadow-[0_0_14px_rgba(250,204,21,0.12)] ledger:rounded-[3px] ledger:border-zinc-50 ledger:bg-zinc-950 ledger:text-zinc-50 ledger:shadow-none"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
                <span>to bookmark</span>
              </>
            ) : null}
          </p>
        )}
      </div>
      <div className={cn(CELL_CLASS, "border-t border-zinc-800 sm:border-l sm:border-t-0 ledger:border-zinc-50 ledger:border-t-[1.5px] ledger:sm:border-l-[1.5px] ledger:sm:border-t-0")}>
        <div className="flex items-center gap-2.5">
          <Puzzle size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-amber-300" />
          <h3 className={TITLE_CLASS}>Search every archive</h3>
        </div>
        <p className={BODY_CLASS}>Check Crawlback, the Wayback Machine, and more at once.</p>
        <a
          href={store.href}
          target="_blank"
          rel="noopener noreferrer"
          className="ledger-arrow-link mt-auto inline-flex min-h-7 w-fit items-center font-semibold text-amber-200 underline underline-offset-2 transition hover:text-amber-100 ledger:font-bold ledger:text-zinc-50 ledger:underline-offset-4 ledger:hover:text-amber-300"
        >
          Get the PastPage {store.label} <span className="ledger-arrow">→</span>
        </a>
      </div>
    </div>
  );
}
