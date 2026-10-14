import type { ReactNode } from "react";
import Link from "next/link";

type LegalPageProps = {
  title: string;
  eyebrow: string;
  children: ReactNode;
};

export function LegalPage({ title, eyebrow, children }: LegalPageProps) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 text-zinc-100 sm:px-8 sm:py-16">
      <Link
        href="/"
        className="-ml-1 inline-flex min-h-11 items-center gap-2 px-1 text-sm text-zinc-300 transition-colors hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
      >
        <span aria-hidden="true">←</span>
        Back to Crawlback
      </Link>

      <header className="mt-8 border-b border-zinc-800 pb-8 sm:mt-14 sm:pb-10">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-300/80">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-[-0.025em] text-zinc-50 sm:text-5xl">
          {title}
        </h1>
      </header>

      <div className="max-w-[68ch] divide-y divide-zinc-800/80">{children}</div>

    </main>
  );
}
