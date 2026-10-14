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
  }
};

const sectionClass = "py-8 sm:py-9";
const headingClass = "text-lg font-semibold leading-snug text-zinc-50 sm:text-xl";
const textClass = "mt-3 max-w-2xl text-base leading-7 text-zinc-300";

export default function ImprintPage() {
  return (
    <LegalPage title="Legal notice" eyebrow="Imprint · Germany">
      <section className={sectionClass} aria-labelledby="provider-heading">
        <h2 id="provider-heading" className={headingClass}>
          Information pursuant to Section 5 DDG
        </h2>
        <div className="mt-5">
          <p className="text-base font-semibold text-zinc-50">Crawlback</p>
          <p className="mt-1 text-base text-zinc-200">Alexander Nabert</p>
          <img
            src="/legal/address.png"
            width="111"
            height="66"
            alt="Postal address: c/o GAM, Pappelallee 64, 10437 Berlin"
            className="mt-3 block h-auto w-[111px] max-w-full"
          />
          <p className="mt-2 text-base text-zinc-200">Germany</p>
        </div>
      </section>

      <section className={sectionClass} aria-labelledby="contact-heading">
        <h2 id="contact-heading" className={headingClass}>Contact</h2>
        <p className={textClass}>
          Email: <a className="text-amber-300 underline decoration-amber-300/40 underline-offset-4 hover:text-amber-200" href="mailto:nabert@pm.me">nabert@pm.me</a>
        </p>
      </section>
    </LegalPage>
  );
}
