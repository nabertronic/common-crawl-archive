"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type HtmlPrivacyWarningDialogProps = {
  open: boolean;
  actionLabel: string;
  protectedDownload?: boolean;
  onCancel: () => void;
  onContinue: (options: { dontShowAgain: boolean }) => void;
};

export function HtmlPrivacyWarningDialog({
  open,
  actionLabel,
  protectedDownload = false,
  onCancel,
  onContinue
}: HtmlPrivacyWarningDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dontShowAgainRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          ).filter((element) => !element.hasAttribute("aria-hidden"))
        : [];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-zinc-950/75 p-0 backdrop-blur-sm sm:place-items-center sm:p-4 ledger:bg-[rgba(20,20,22,0.6)] ledger:backdrop-blur-none ledger:animate-[menu-fade_200ms_ease-out_both]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="html-privacy-warning-title"
        aria-describedby="html-privacy-warning-description"
        className="max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-xl border sm:max-w-md sm:rounded-md border border-amber-300/25 bg-zinc-950 shadow-2xl shadow-black/50 ledger:!rounded-none ledger:!border-zinc-50 ledger:!bg-zinc-950 ledger:!shadow-[0_10px_30px_rgba(20,20,22,0.08)] ledger:backdrop-blur-none ledger:motion-safe:animate-[ledger-menu-in_200ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
      >
        <div className="border-b border-zinc-800 bg-amber-300/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md ledger:rounded-[3px] border border-amber-300/35 bg-amber-300/15 text-amber-200">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h2 id="html-privacy-warning-title" className="text-sm font-bold text-zinc-100 ledger:font-serif ledger:!text-[26px] ledger:!font-normal ledger:tracking-[-0.01em]">
                Privacy warning for raw HTML
              </h2>
              <p className="mt-1 text-xs leading-5 text-amber-100/85">
                Copied or downloaded HTML can reference live images, scripts, fonts, and other assets.
              </p>
            </div>
          </div>
        </div>

        <div id="html-privacy-warning-description" className="space-y-3 px-5 py-4 text-sm leading-6 text-zinc-300">
          <p>
            {protectedDownload
              ? "The downloaded file carries a content policy that blocks scripts and remote requests when you open it locally, so its external assets are not requested. Copied HTML has no such policy."
              : "If you open that HTML in a browser, its scripts may run and remote assets may be requested from their current hosts. Those hosts can see your IP address and request details."}
          </p>
          <p className="text-xs leading-5 text-zinc-500">
            For private review, open exported HTML offline or in an isolated browser profile.
          </p>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md ledger:rounded-[3px] border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-700 ledger:transition-colors ledger:duration-150 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)]">
            <input ref={dontShowAgainRef} type="checkbox" className="h-5 w-5 accent-amber-300 sm:h-3.5 sm:w-3.5" />
            <span>Don't show this again</span>
          </label>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 bg-zinc-950/90 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} type="button" variant="ghost" size="sm" onClick={onCancel} className="justify-center">
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => onContinue({ dontShowAgain: dontShowAgainRef.current?.checked ?? false })}
            className="justify-center"
          >
            {actionLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
