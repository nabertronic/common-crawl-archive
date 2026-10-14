"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Bookmark } from "lucide-react";

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

// Server snapshot is null, so server HTML and the first client render match;
// the real hint is applied right after hydration without a mismatch.
export function LandingBookmarkHint() {
  const pathname = usePathname();
  const hint = useSyncExternalStore(noopSubscribe, getClientHint, () => null);

  if (pathname !== "/" || hint === null) return null;

  return (
    <p className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-x-2 gap-y-2 px-2 text-center text-[1.0625rem] leading-relaxed text-zinc-200">
      <Bookmark size={16} aria-hidden="true" className="shrink-0 text-amber-300" />
      {hint.kind === "keys" ? (
        <>
          <span>Press</span>{" "}
          <span className="inline-flex items-center gap-0.5">
            {hint.keys.map((key) => (
              <kbd
                key={key}
                className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-md border border-amber-300/35 border-b-2 bg-zinc-900 px-1.5 font-mono text-[0.8125rem] font-semibold leading-none text-amber-200 shadow-[0_0_14px_rgba(250,204,21,0.12)]"
              >
                {key}
              </kbd>
            ))}
          </span>{" "}
          <span>to bookmark Crawlback for your next broken link.</span>
        </>
      ) : (
        <span>{hint.text}</span>
      )}
    </p>
  );
}
