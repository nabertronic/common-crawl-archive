"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { Bookmark } from "lucide-react";

function bookmarkInstructions() {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(agent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "Open your browser’s Share menu, then choose Add Bookmark. In Safari, you can also choose Add to Home Screen.";
  }
  if (/Android/i.test(agent)) {
    return "Open your browser’s menu and choose the star or Bookmark option to save Crawlback.";
  }
  return /Mac/i.test(navigator.platform || agent)
    ? "Press ⌘D to bookmark Crawlback for your next broken link."
    : "Press Ctrl+D to bookmark Crawlback for your next broken link.";
}

export function LandingBookmarkHint() {
  const pathname = usePathname();
  const [instructions, setInstructions] = useState<string | null>(null);
  const id = useId();

  if (pathname !== "/") return null;

  return (
    <div className="mt-3 text-sm">
      <button
        type="button"
        aria-expanded={instructions !== null}
        aria-controls={id}
        onClick={() => setInstructions(instructions === null ? bookmarkInstructions() : null)}
        className="inline-flex items-center gap-2 rounded-sm text-zinc-400 transition hover:text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
      >
        <Bookmark size={14} aria-hidden="true" />
        Bookmark Crawlback for your next broken link
      </button>
      <div id={id} hidden={instructions === null} className="mt-2 max-w-2xl border-l border-amber-300/40 pl-3 text-sm leading-6 text-zinc-300">
        {instructions}
      </div>
    </div>
  );
}
