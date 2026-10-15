"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  declineStorageConsent,
  grantStorageConsent,
  hasStorageConsent,
  hasStorageConsentDecision,
  OPEN_WEBSITE_PREFERENCES_EVENT,
  revokeStorageConsent,
  subscribeStorageConsent
} from "@/lib/website-preferences";

const LEDGER_PRIMARY_BUTTON = "ledger:rounded-[3px] ledger:border-zinc-50 ledger:bg-zinc-50 ledger:text-zinc-950 ledger:shadow-none ledger:hover:border-amber-300 ledger:hover:bg-amber-300";
const LEDGER_SECONDARY_BUTTON = "ledger:rounded-[3px] ledger:border-zinc-50 ledger:bg-transparent ledger:text-zinc-50 ledger:shadow-none ledger:hover:bg-zinc-50 ledger:hover:text-zinc-950";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function WebsitePreferences() {
  const [ready, setReady] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  // Following a link out of the dialog must not restore focus: focus() scrolls the old trigger
  // (e.g. the footer button) into view and would pull the destination page away from its top.
  const leaveForPage = useCallback(() => {
    returnFocusRef.current = null;
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    setAcknowledged(hasStorageConsent());
    setBannerVisible(!hasStorageConsentDecision());
    setReady(true);
    return subscribeStorageConsent(() => {
      setAcknowledged(hasStorageConsent());
      setBannerVisible(!hasStorageConsentDecision());
    });
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

  const allowStorage = () => {
    setStorageError("");
    if (!grantStorageConsent()) {
      setStorageError("Your browser did not allow storage. Check your browser settings and try again.");
      return;
    }
    setAcknowledged(hasStorageConsent());
    setBannerVisible(false);
    if (settingsOpen) closeSettings();
  };
  const decline = () => { declineStorageConsent(); setAcknowledged(false); setBannerVisible(false); };
  const revoke = () => { revokeStorageConsent(); setAcknowledged(false); closeSettings(); };

  if (!ready) return null;

  return (
    <>
      {!acknowledged && bannerVisible && !settingsOpen && (
        <aside
          aria-labelledby="website-storage-title"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[80] mx-auto max-h-[calc(100dvh-1.5rem)] max-w-3xl overflow-y-auto overscroll-contain rounded-xl border border-zinc-700 bg-zinc-950/95 p-5 text-zinc-100 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur-md sm:inset-x-6 sm:bottom-6 sm:max-h-[calc(100dvh-3rem)] sm:p-6 ledger:rounded-none ledger:border ledger:border-zinc-50 ledger:bg-zinc-950 ledger:shadow-[0_10px_30px_rgba(20,20,22,0.08)] ledger:backdrop-blur-none ledger:motion-safe:animate-[ledger-menu-in_200ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-300 ledger:hidden">Your browser, your choice</p>
              <h2 id="website-storage-title" className="text-lg font-semibold tracking-tight ledger:font-serif ledger:font-normal ledger:text-[30px] ledger:leading-[1.1] ledger:tracking-[-0.01em]">Allow browser storage?</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                This app needs storage in your browser to search, save results, and remember settings. Your data stays on this device. You can change your choice later in Website settings.
              </p>
              <p className="mt-2 text-xs text-zinc-400 ledger:flex ledger:flex-wrap ledger:gap-x-5 ledger:text-sm ledger:[&_a]:inline-flex ledger:[&_a]:min-h-11 ledger:[&_a]:items-center">
                <a className="underline decoration-zinc-600 underline-offset-4 hover:text-amber-200 ledger:decoration-amber-300 ledger:transition-[color,text-decoration-color] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)]" href="/privacy" onClick={leaveForPage}>Privacy</a>
                <span aria-hidden="true" className="ledger:hidden"> · </span>
                <a className="underline decoration-zinc-600 underline-offset-4 hover:text-amber-200 ledger:decoration-amber-300 ledger:transition-[color,text-decoration-color] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)]" href="/settings#storage" onClick={leaveForPage}>Manage stored data</a>
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row ledger:[&_button]:min-h-12 ledger:[&_button]:w-full ledger:sm:[&_button]:w-auto">
              <Button variant="secondary" className={LEDGER_SECONDARY_BUTTON} onClick={decline}>No thanks</Button>
              <Button onClick={allowStorage} className={`px-5 ${LEDGER_PRIMARY_BUTTON}`}>Allow browser storage</Button>
            </div>
            {storageError && <p role="alert" className="mt-3 text-sm text-red-300">{storageError}</p>}
          </div>
        </aside>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-6 ledger:backdrop-blur-none ledger:animate-[menu-fade_200ms_ease-out_both]" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSettings();
        }}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="website-preferences-title"
            aria-describedby="website-preferences-description"
            tabIndex={-1}
            className="w-full max-h-[calc(100dvh-1.5rem)] max-w-xl overflow-y-auto overscroll-contain rounded-xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-[0_24px_90px_rgba(0,0,0,0.65)] sm:max-h-[calc(100dvh-3rem)] sm:p-7 ledger:rounded-none ledger:border ledger:border-zinc-50 ledger:bg-zinc-950 ledger:shadow-[0_10px_30px_rgba(20,20,22,0.08)] ledger:motion-safe:animate-[ledger-menu-in_200ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
          >
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300 ledger:hidden">Website settings</p>
            <h2 id="website-preferences-title" className="mt-2 text-xl font-semibold tracking-tight ledger:font-serif ledger:font-normal ledger:text-[34px] ledger:leading-[1.1] ledger:tracking-[-0.01em]">Browser storage</h2>
            <p id="website-preferences-description" className="mt-3 text-sm leading-6 text-zinc-300">
              Crawlback uses storage in this browser for searches, saved pages, and settings. This information stays on this device. Turning storage off stops app features from using it, but does not delete saved data. You can allow it again whenever you need those features.
            </p>
            {storageError && <p role="alert" className="mt-3 text-sm text-red-300">{storageError}</p>}
            <p className="mt-4 text-xs text-zinc-400 ledger:flex ledger:flex-wrap ledger:gap-x-5 ledger:text-sm ledger:[&_a]:inline-flex ledger:[&_a]:min-h-11 ledger:[&_a]:items-center">
              <a className="underline decoration-zinc-600 underline-offset-4 hover:text-amber-200 ledger:decoration-amber-300 ledger:transition-[color,text-decoration-color] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)]" href="/privacy" onClick={leaveForPage}>Privacy</a>
              <span aria-hidden="true" className="ledger:hidden"> · </span>
              <a className="underline decoration-zinc-600 underline-offset-4 hover:text-amber-200 ledger:decoration-amber-300 ledger:transition-[color,text-decoration-color] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)]" href="/settings#storage" onClick={leaveForPage}>Manage stored data</a>
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end ledger:[&_button]:min-h-12 ledger:[&_button]:w-full ledger:sm:[&_button]:w-auto">
              <Button variant="secondary" className={LEDGER_SECONDARY_BUTTON} onClick={closeSettings}>Close settings</Button>
              {!acknowledged ? <Button className={LEDGER_PRIMARY_BUTTON} onClick={allowStorage}>Allow browser storage</Button> : <Button className={LEDGER_SECONDARY_BUTTON} onClick={revoke}>Turn storage off</Button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
