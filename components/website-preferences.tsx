"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  acknowledgeWebsitePreferences,
  hasWebsitePreferencesAcknowledgement,
  OPEN_WEBSITE_PREFERENCES_EVENT
} from "@/lib/website-preferences";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function WebsitePreferences() {
  const [ready, setReady] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    setAcknowledged(hasWebsitePreferencesAcknowledgement());
    setReady(true);
  }, []);

  useEffect(() => {
    const open = () => {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_WEBSITE_PREFERENCES_EVENT, open);
    return () => window.removeEventListener(OPEN_WEBSITE_PREFERENCES_EVENT, open);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const dialog = dialogRef.current;
    const initial = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSettings();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, closeSettings]);

  useEffect(() => {
    if (!settingsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [settingsOpen]);

  const continueAndAcknowledge = () => {
    acknowledgeWebsitePreferences();
    setAcknowledged(true);
    if (settingsOpen) closeSettings();
  };

  if (!ready) return null;

  return (
    <>
      {!acknowledged && !settingsOpen && (
        <aside
          aria-labelledby="website-storage-title"
          className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-h-[calc(100dvh-1.5rem)] max-w-3xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/95 p-5 text-zinc-100 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur-md sm:inset-x-6 sm:bottom-6 sm:max-h-[calc(100dvh-3rem)] sm:p-6"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">A note about this browser</p>
              <h2 id="website-storage-title" className="text-lg font-semibold tracking-tight">Cookies &amp; local storage</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                We do not set cookies. Necessary browser storage keeps your settings, search history, saved captures, and browser cache on this device. We do not use analytics or advertising cookies.
              </p>
              <p className="mt-2 text-xs text-zinc-400">
                <a className="underline decoration-zinc-600 underline-offset-4 hover:text-amber-200" href="/privacy" onClick={closeSettings}>Privacy</a>
                <span aria-hidden="true"> · </span>
                <a className="underline decoration-zinc-600 underline-offset-4 hover:text-amber-200" href="/settings#storage" onClick={closeSettings}>Manage stored data</a>
              </p>
            </div>
            <Button onClick={continueAndAcknowledge} className="shrink-0 px-5">Continue</Button>
          </div>
        </aside>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSettings();
        }}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="website-preferences-title"
            aria-describedby="website-preferences-description"
            tabIndex={-1}
            className="w-full max-h-[calc(100dvh-1.5rem)] max-w-xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-[0_24px_90px_rgba(0,0,0,0.65)] sm:max-h-[calc(100dvh-3rem)] sm:p-7"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">Website settings</p>
            <h2 id="website-preferences-title" className="mt-2 text-xl font-semibold tracking-tight">Your data, on this device</h2>
            <p id="website-preferences-description" className="mt-3 text-sm leading-6 text-zinc-300">
              We do not set cookies. Crawlback uses necessary browser storage for your settings, search history, saved captures, and browser cache. You can manage app history and saved captures in App settings. Use your browser controls to clear all site data.
            </p>
            <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
              <p className="text-sm font-semibold text-zinc-100">Analytics and advertising</p>
              <p className="mt-1 text-sm leading-5 text-zinc-400">We do not use analytics or advertising cookies, or any other cookies.</p>
            </div>
            <p className="mt-4 text-xs text-zinc-400">
              <a className="underline decoration-zinc-600 underline-offset-4 hover:text-amber-200" href="/privacy" onClick={closeSettings}>Privacy</a>
              <span aria-hidden="true"> · </span>
              <a className="underline decoration-zinc-600 underline-offset-4 hover:text-amber-200" href="/settings#storage" onClick={closeSettings}>Manage stored data</a>
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeSettings}>Close settings</Button>
              {!acknowledged && <Button onClick={continueAndAcknowledge}>Continue</Button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
