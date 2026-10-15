import type { ReactNode } from "react";
import Link from "next/link";

type LegalPageProps = {
  title: string;
  eyebrow: string;
  children: ReactNode;
};

export function LegalPage({ title, eyebrow, children }: LegalPageProps) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-[max(1.25rem,env(safe-area-inset-left))] py-8 text-zinc-100 sm:px-8 sm:py-16 ledger:max-w-[68ch]">
      <Link
        href="/"
        className="-ml-1 inline-flex min-h-11 items-center gap-2 px-1 text-sm text-zinc-300 transition-colors hover:text-amber-300 ledger:underline ledger:decoration-[var(--ledger-rule)] ledger:underline-offset-4 ledger:transition-[color,text-decoration-color] ledger:duration-200 ledger:ease-[cubic-bezier(0.2,0.8,0.2,1)] ledger:hover:decoration-[var(--ledger-stamp)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
      >
        <span aria-hidden="true">←</span>
        Back to Crawlback
      </Link>

      <header className="mt-8 border-b border-zinc-800 pb-8 sm:mt-14 sm:pb-10 ledger:border-b-[1.5px] ledger:border-zinc-50">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-300/80 ledger:hidden">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-[-0.025em] text-zinc-50 sm:text-5xl ledger:font-serif ledger:font-normal ledger:text-[clamp(2.5rem,15vw,3.5rem)] ledger:leading-[0.95] ledger:tracking-[-0.02em] ledger:text-balance ledger:break-words ledger:sm:text-[84px]">
          {title}
        </h1>
      </header>

      <div className="max-w-[68ch] break-words divide-y divide-zinc-800/80 ledger:divide-zinc-800">{children}</div>

    </main>
  );
}
