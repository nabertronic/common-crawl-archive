import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of use · Crawlback",
  description: "Terms for using Crawlback, a free tool for finding Common Crawl web archive captures.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of use · Crawlback",
    description: "Terms for using Crawlback, a free tool for finding Common Crawl web archive captures.",
    url: "/terms",
    siteName: "Crawlback",
    type: "website"
  }
};

const sectionClass = "space-y-4 py-8 text-base leading-7 text-zinc-300 sm:py-10";
const headingClass = "text-lg font-semibold leading-snug text-zinc-50 sm:text-xl";
const linkClass = "text-amber-300 underline decoration-amber-300/40 underline-offset-4 hover:text-amber-200";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" eyebrow="Using Crawlback · Germany">
      <section className={sectionClass} aria-labelledby="terms-scope">
        <h2 id="terms-scope" className={headingClass}>What Crawlback does</h2>
        <p>Crawlback is a free, independent tool operated by Alexander Nabert. It helps you search Common Crawl’s public catalogs of archived pages and inspect matching copies in your browser. It is not operated by, sponsored by, or affiliated with the Internet Archive or Common Crawl Foundation. The operator’s details are in the <Link href="/imprint" className={linkClass}>legal notice</Link>.</p>
        <p>These terms explain the conditions for using Crawlback. They do not change rights that the law does not allow us to limit. Common Crawl and other third-party services have their own terms and policies.</p>
      </section>

      <section className={sectionClass} aria-labelledby="terms-responsible">
        <h2 id="terms-responsible" className={headingClass}>Use the tool responsibly</h2>
        <p>You are responsible for the search terms you enter and how you use the results. Use Crawlback only for lawful purposes. Respect privacy, copyright, database rights, confidentiality, and other rights that may apply to a page or its contents. An archived copy being accessible does not mean that you may republish it, contact people mentioned in it, or use it for another purpose without considering applicable law.</p>
        <p>Common Crawl’s published <a href="https://www.commoncrawl.org/terms-of-use" className={linkClass}>Terms of Use</a> apply to your access to Common Crawl data and impose additional restrictions. Its <a href="https://www.commoncrawl.org/faq" className={linkClass}>FAQ</a> explains that the collection is a sample of the web, not a complete archive, and recommends slowing down API requests when rate limits are reached. Follow Common Crawl’s current instructions and rate limits when using its services through Crawlback or directly.</p>
        <p>If you use Crawlback for journalism or research about a person or organization, check whether collecting and using personal information is lawful for your purpose. Do not use Crawlback to harass, threaten, impersonate, or unlawfully profile anyone.</p>
      </section>

      <section className={sectionClass} aria-labelledby="terms-results">
        <h2 id="terms-results" className={headingClass}>Check evidence and handle files carefully</h2>
        <p>Search results and captures come from third-party archives. They may be missing, incomplete, duplicated, misdated, altered, or incorrectly matched. Crawlback does not verify who created a page or whether its contents are true. For reporting, research, or other important decisions, verify a capture against the source, its date, and independent evidence. Crawlback is not legal, security, or professional advice.</p>
        <p>The preview blocks archived scripts, but downloaded raw HTML is a separate file. Opening it outside Crawlback may cause external network requests or expose you to unsafe content. Treat it as untrusted, and keep your own copies if you need them: browser data and exported files are not a guaranteed backup.</p>
      </section>

      <section className={sectionClass} aria-labelledby="terms-availability">
        <h2 id="terms-availability" className={headingClass}>Availability and changes</h2>
        <p>Crawlback is provided free of charge and without a promise that it will always be available, uninterrupted, secure, or compatible with every browser. Common Crawl or another provider may change, limit, or withdraw its services. We may maintain, change, restrict, or suspend Crawlback, including to address security, legal, operational, or abuse concerns.</p>
        <p>We may update these terms as the service or law changes. The date below identifies the current version. A change applies prospectively; it does not retroactively remove rights or remedies you already have.</p>
        <p className="text-sm text-zinc-400">Last updated: 14 October 2026</p>
      </section>

      <section className={sectionClass} aria-labelledby="terms-liability">
        <h2 id="terms-liability" className={headingClass}>Liability</h2>
        <p>To the extent permitted by law, the operator is liable without limitation for losses caused intentionally or by gross negligence, for injury to life, body, or health, under an express guarantee, under the German Product Liability Act, and in cases of fraud. Mandatory statutory liability remains unaffected.</p>
        <p>For slight negligence, liability is limited to a breach of a duty that is essential to the proper performance of a contract with you and on which you may normally rely. In that case, liability is limited to the loss that was foreseeable and typical when the contract was made. For other slightly negligent breaches, liability is excluded to the extent the law permits. These limits also apply to the operator’s legal representatives and agents where allowed by law.</p>
        <p>Nothing in these terms excludes a right or remedy that cannot lawfully be excluded, including consumer rights that apply to you.</p>
      </section>

      <section className={sectionClass} aria-labelledby="terms-law">
        <h2 id="terms-law" className={headingClass}>Law and contact</h2>
        <p>German law governs, subject to any mandatory consumer protection rules that require the law or courts of your country of residence to apply. If you have a question about these terms, contact <a href="mailto:nabert@pm.me" className={linkClass}>nabert@pm.me</a>.</p>
      </section>
    </LegalPage>
  );
}
