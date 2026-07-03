"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type HtmlPrivacyWarningDialogProps = {
  open: boolean;
  actionLabel: string;
  onCancel: () => void;
  onContinue: (options: { dontShowAgain: boolean }) => void;
};

export function HtmlPrivacyWarningDialog({
  open,
  actionLabel,
  onCancel,
  onContinue
}: HtmlPrivacyWarningDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dontShowAgainRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/75 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="html-privacy-warning-title"
        aria-describedby="html-privacy-warning-description"
        className="w-full max-w-md overflow-hidden rounded-md border border-amber-300/25 bg-zinc-950 shadow-2xl shadow-black/50"
      >
        <div className="border-b border-zinc-800 bg-amber-300/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border border-amber-300/35 bg-amber-300/15 text-amber-200">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h2 id="html-privacy-warning-title" className="text-sm font-bold text-zinc-100">
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
            If you open that HTML in a browser, those external assets may be requested from their current hosts. Those
            hosts can see your IP address and request details.
          </p>
          <p className="text-xs leading-5 text-zinc-500">
            For private review, open exported HTML offline or in an isolated browser profile.
          </p>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-700">
            <input ref={dontShowAgainRef} type="checkbox" className="h-3.5 w-3.5 accent-amber-300" />
            <span>Don't show this again</span>
          </label>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 bg-zinc-950/90 px-5 py-4 sm:flex-row sm:justify-end">
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
