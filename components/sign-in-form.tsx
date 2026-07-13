"use client";

import { useSignIn } from "@clerk/nextjs";
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useRef, useState } from "react";

const verificationCodeLength = 6;

function getSafeReturnUrl() {
  const redirectUrl = new URLSearchParams(window.location.search).get("redirect_url");
  if (!redirectUrl) return "/";

  try {
    const destination = new URL(redirectUrl, window.location.origin);
    return destination.origin === window.location.origin
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : "/";
  } catch {
    return "/";
  }
}

/**
 * The form is rendered by Next.js immediately. Clerk only enhances submission
 * once its client has connected, so users never wait on a remote auth widget
 * before they can see the sign-in screen.
 */
export function SignInForm() {
  const { signIn, fetchStatus } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState<string[]>(() => Array(verificationCodeLength).fill(""));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const isSubmitting = fetchStatus === "fetching";
  const needsClientTrust = signIn?.status === "needs_client_trust";

  async function finalizeSignIn() {
    if (!signIn || signIn.status !== "complete") return;

    // Clerk switches the sign-in status to complete before the navigation has
    // started. Keep this explicit terminal state mounted during that handoff so
    // the password form cannot flash back into view.
    setIsFinalizing(true);
    try {
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const destination = decorateUrl(getSafeReturnUrl());
          window.location.assign(destination);
        }
      });
    } catch {
      setIsFinalizing(false);
      setErrorMessage("We could not complete the sign-in. Please try again.");
    }
  }

  async function sendClientTrustCode() {
    if (!signIn) return false;

    const emailCodeFactor = signIn.supportedSecondFactors.find((factor) => factor.strategy === "email_code");
    if (!emailCodeFactor) {
      setErrorMessage("This account does not have email verification available. Please contact your administrator.");
      return false;
    }

    const { error } = await signIn.mfa.sendEmailCode();
    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return false;
    }

    return true;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn || isSubmitting) return;

    setErrorMessage(null);
    const { error } = await signIn.password({
      identifier: email.trim(),
      password
    });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signIn.status === "needs_client_trust") {
      await sendClientTrustCode();
      return;
    }

    if (signIn.status !== "complete") {
      setErrorMessage("Additional verification is required to finish signing in.");
      return;
    }

    await finalizeSignIn();
  }

  async function handleVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn || isSubmitting) return;

    setErrorMessage(null);
    const { error } = await signIn.mfa.verifyEmailCode({ code: verificationCode.join("") });

    if (error) {
      setErrorMessage(error.longMessage ?? error.message);
      return;
    }

    if (signIn.status !== "complete") {
      setErrorMessage("The verification code could not be confirmed. Please try again.");
      return;
    }

    await finalizeSignIn();
  }

  function startOver() {
    signIn?.reset();
    setErrorMessage(null);
    setPassword("");
    setVerificationCode(Array(verificationCodeLength).fill(""));
    setIsFinalizing(false);
  }

  function fillVerificationCode(value: string, startIndex = 0) {
    const digits = value.replace(/\D/g, "").slice(0, verificationCodeLength - startIndex).split("");
    if (digits.length === 0) return;

    setVerificationCode((currentCode) => {
      const nextCode = [...currentCode];
      digits.forEach((digit, offset) => {
        nextCode[startIndex + offset] = digit;
      });
      return nextCode;
    });

    const nextEmptyIndex = Math.min(startIndex + digits.length, verificationCodeLength - 1);
    codeInputRefs.current[nextEmptyIndex]?.focus();
  }

  function handleCodeChange(index: number, value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      fillVerificationCode(digits, index);
      return;
    }

    setVerificationCode((currentCode) => currentCode.map((digit, digitIndex) => (digitIndex === index ? digits : digit)));
    if (digits && index < verificationCodeLength - 1) {
      codeInputRefs.current[index + 1]?.focus();
    }
  }

  function handleCodeKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !verificationCode[index] && index > 0) {
      event.preventDefault();
      setVerificationCode((currentCode) => currentCode.map((digit, digitIndex) => (digitIndex === index - 1 ? "" : digit)));
      codeInputRefs.current[index - 1]?.focus();
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      codeInputRefs.current[index - 1]?.focus();
    }

    if (event.key === "ArrowRight" && index < verificationCodeLength - 1) {
      event.preventDefault();
      codeInputRefs.current[index + 1]?.focus();
    }
  }

  function handleCodePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    fillVerificationCode(event.clipboardData.getData("text"));
  }

  if (isFinalizing) {
    return (
      <main className="grid min-h-screen place-items-center px-4 py-8">
        <section aria-live="polite" className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/90 p-7 text-center shadow-2xl shadow-black/30 backdrop-blur">
          <div aria-hidden="true" className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-300" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-50">Signing you in</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Your account has been verified. Opening Crawlback…</p>
        </section>
      </main>
    );
  }

  if (needsClientTrust) {
    return (
      <main className="grid min-h-screen place-items-center px-4 py-8">
        <section className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/90 p-7 shadow-2xl shadow-black/30 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">Crawlback</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">Verify your account</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            We sent a verification code to your email address to confirm this new device.
          </p>

          <form className="mt-7 space-y-5" onSubmit={handleVerification}>
            <div>
              <span className="mb-2 block text-sm font-medium text-zinc-200" id="verification-code-label">
                Verification code
              </span>
              <div aria-labelledby="verification-code-label" className="grid grid-cols-6 gap-2 sm:gap-3" onPaste={handleCodePaste}>
                {verificationCode.map((digit, index) => (
                  <input
                    aria-label={`Verification code digit ${index + 1} of ${verificationCodeLength}`}
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    autoFocus={index === 0}
                    className="h-12 min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 text-center text-xl font-semibold tabular-nums text-zinc-50 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20 sm:h-14 sm:text-2xl"
                    inputMode="numeric"
                    key={index}
                    maxLength={1}
                    name={`code-${index + 1}`}
                    onChange={(event) => handleCodeChange(index, event.target.value)}
                    onKeyDown={(event) => handleCodeKeyDown(index, event)}
                    pattern="[0-9]*"
                    ref={(element) => {
                      codeInputRefs.current[index] = element;
                    }}
                    required
                    type="text"
                    value={digit}
                  />
                ))}
              </div>
            </div>

            {errorMessage ? (
              <p aria-live="polite" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <button
              className="w-full rounded-lg bg-amber-300 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Verifying…" : "Verify and continue"}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between gap-4 text-sm">
            <button className="text-zinc-400 underline-offset-4 hover:text-zinc-100 hover:underline" disabled={isSubmitting} onClick={() => void sendClientTrustCode()} type="button">
              Send a new code
            </button>
            <button className="text-zinc-400 underline-offset-4 hover:text-zinc-100 hover:underline" disabled={isSubmitting} onClick={startOver} type="button">
              Use a different account
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <section className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/90 p-7 shadow-2xl shadow-black/30 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">Crawlback</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">Use the email address and password provided by your administrator.</p>

        <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200" htmlFor="email">
              Email address
            </label>
            <input
              autoComplete="email"
              className="block w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200" htmlFor="password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="block w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
              id="password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>

          {errorMessage ? (
            <p aria-live="polite" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button
            className="w-full rounded-lg bg-amber-300 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!signIn || isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Signing in…" : "Continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
