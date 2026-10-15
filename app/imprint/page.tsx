import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Legal notice · Crawlback",
  description: "Provider information and contact details for Crawlback.",
  alternates: { canonical: "/imprint" },
  openGraph: {
    title: "Legal notice · Crawlback",
    description: "Provider information and contact details for Crawlback.",
    url: "/imprint",
    siteName: "Crawlback",
    type: "website"
  },
  // Mirrors the reference site's legal notice: kept out of search indexes and
  // archives. It stays out of the sitemap and robots.txt, and footer links use nofollow.
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true }
};

const sectionClass = "py-8 sm:py-9 ledger:space-y-5";
const headingClass = "text-lg font-semibold leading-snug text-zinc-50 sm:text-xl ledger:font-serif ledger:font-normal ledger:text-[1.75rem] ledger:leading-[1.1] ledger:tracking-[-0.01em] ledger:text-balance ledger:sm:text-[40px]";
const textClass = "mt-3 max-w-2xl text-base leading-7 text-zinc-300";

export default function ImprintPage() {
  return (
    <LegalPage title="Legal notice" eyebrow="Provider information">
      <section className={sectionClass} aria-labelledby="provider-heading">
        <h2 id="provider-heading" className={headingClass}>
          Information pursuant to Section 5 DDG (Germany)
        </h2>
        <div className="mt-5">
          <p className="text-base font-semibold text-zinc-50">Crawlback</p>
          <p className="mt-1 text-base text-zinc-200">Alexander Nabert</p>
          <img
            src="/legal/address.png"
            width="111"
            height="66"
            alt="Postal address: c/o GAM, Pappelallee 64, 10437 Berlin"
            className="mt-3 block h-auto w-[111px] max-w-full ledger:opacity-85 ledger:invert"
          />
          <p className="mt-2 text-base text-zinc-200">Germany</p>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="contact-heading">
        <h2 id="contact-heading" className={headingClass}>Contact</h2>
        <p className={textClass}>
          Email: <a className="text-amber-300 underline decoration-amber-300/40 underline-offset-4 hover:text-amber-200 ledger:text-zinc-50 ledger:decoration-amber-300 ledger:decoration-[1.5px] ledger:hover:text-amber-300" href="mailto:nabert@pm.me">nabert@pm.me</a>
        </p>
      </section>
    </LegalPage>
  );
}
