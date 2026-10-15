import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy · Crawlback",
  description: "How Crawlback handles browser storage, archive searches, and technical access data.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy · Crawlback",
    description: "How Crawlback handles browser storage, archive searches, and technical access data.",
    url: "/privacy",
    siteName: "Crawlback",
    type: "website"
  }
};

const sectionClass = "space-y-4 py-8 text-base leading-7 text-zinc-300 sm:py-10 ledger:space-y-5 ledger:text-[17px] ledger:leading-[1.65]";
const headingClass = "text-lg font-semibold leading-snug text-zinc-50 sm:text-xl ledger:font-serif ledger:font-normal ledger:text-[1.75rem] ledger:leading-[1.1] ledger:tracking-[-0.01em] ledger:text-balance ledger:sm:text-[40px]";
const linkClass = "text-amber-300 underline decoration-amber-300/40 underline-offset-4 hover:text-amber-200 ledger:text-zinc-50 ledger:decoration-amber-300 ledger:decoration-[1.5px] ledger:hover:text-amber-300";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" eyebrow="Your searches · Your browser">
      <section className={sectionClass} aria-labelledby="privacy-overview">
        <h2 id="privacy-overview" className={headingClass}>At a glance</h2>
        <p>Crawlback helps you find archived web pages. There are no accounts, advertising, analytics scripts, or session recordings. If you allow browser storage, search history, settings, and saved captures stay in your browser; they are not synchronised to an account.</p>
        <p>Local storage does not make a search anonymous: archive queries go to Common Crawl, and visiting this website requires technical access data to be processed by our hosting provider.</p>
        <p className="text-sm text-zinc-400">Last updated: 14 October 2026</p>
      </section>

      <section className={sectionClass} aria-labelledby="privacy-controller">
        <h2 id="privacy-controller" className={headingClass}>Controller and contact</h2>
        <p>The controller for Crawlback is Alexander Nabert. The postal address is listed in the <Link href="/imprint" rel="nofollow" className={linkClass}>legal notice</Link>.</p>
        <p>For privacy questions and requests, email <a href="mailto:nabert@pm.me" className={linkClass}>nabert@pm.me</a>.</p>
      </section>

      <section className={sectionClass} aria-labelledby="privacy-hosting">
        <h2 id="privacy-hosting" className={headingClass}>Website delivery and hosting</h2>
        <p>This website is hosted by Vercel, Inc., United States. Requests can include your IP address, access time, requested URL, response status, and browser or referrer information. This data is used to deliver the site, diagnose faults, and protect it from abuse. Our legal basis is Article 6(1)(f) GDPR: our legitimate interest in operating a secure, reliable service.</p>
        <p>Requested URLs can include search or capture parameters. Avoid putting confidential information into links you share. The app also temporarily groups API requests by IP address to enforce one-minute request limits; these counters are kept in server memory.</p>
        <p>Hosting data may be processed outside the EEA, including in the United States. Vercel describes its processing roles and international transfer safeguards in its <a href="https://vercel.com/legal/privacy-notice" className={linkClass}>privacy notice</a> and <a href="https://vercel.com/legal/dpa" className={linkClass}>data processing terms</a>. Log retention varies by service, plan, and configuration; see Vercel’s <a href="https://vercel.com/docs/logs/runtime" className={linkClass}>runtime log documentation</a>. The app does not maintain a separate hosted database of your search history.</p>
      </section>

      <section className={sectionClass} aria-labelledby="privacy-searches">
        <h2 id="privacy-searches" className={headingClass}>What happens during a search</h2>
        <ul className="list-disc space-y-3 pl-5 marker:text-zinc-600 ledger:marker:text-amber-300">
          <li><strong className="font-semibold text-zinc-100">Archive queries.</strong> Your browser contacts Common Crawl’s index and archive-data servers directly. They receive your IP address, technical request information, and the searched URL, host, or domain or requested archive record. Their processing is covered by <a href="https://www.commoncrawl.org/privacy-policy" className={linkClass}>Common Crawl’s privacy policy</a>.</li>
          <li><strong className="font-semibold text-zinc-100">Robots.txt checks.</strong> If enabled, your target URL is sent to Crawlback’s server to check the target website’s robots.txt. That website receives a request from our server, rather than your browser’s IP address. You can disable these checks in <Link href="/settings#scan-settings" className={linkClass}>App settings</Link>, before starting a scan.</li>
          <li><strong className="font-semibold text-zinc-100">Opt-out registry.</strong> Our server retrieves the public Common Crawl opt-out list from a Google-hosted spreadsheet. Matching your target against that list happens in your browser; the registry request does not send your search target to Google.</li>
          <li><strong className="font-semibold text-zinc-100">Archived pages.</strong> Captures are shown in a sandboxed preview that blocks archived scripts. Downloaded raw HTML can make external requests if you open it separately; read the warning shown before HTML exports.</li>
        </ul>
        <p>These requests provide the archive search you ask for. Where personal data is processed, our basis is Article 6(1)(f) GDPR, our legitimate interest in providing this public research tool. External services apply their own retention rules.</p>
      </section>

      <section className={sectionClass} aria-labelledby="privacy-storage">
        <h2 id="privacy-storage" className={headingClass}>Cookies and local browser storage</h2>
        <p>Crawlback’s own code does not set cookies. It uses browser storage to operate the features you use:</p>
        <dl className="space-y-5 border-l border-amber-300/30 pl-5 ledger:border-zinc-600">
          <div><dt className="font-semibold text-zinc-100">History, settings, and saved captures</dt><dd>IndexedDB holds your scan history, results, coverage, settings, and optionally cached HTML. A local identifier separates data inside this browser; it is not a login or a tracking identifier sent to us.</dd></div>
          <div><dt className="font-semibold text-zinc-100">Search and request caches</dt><dd>Local storage holds source lists, robots checks, archive-query results, and scan coordination state. The background-scan service worker also caches Common Crawl index responses in the browser.</dd></div>
          <div><dt className="font-semibold text-zinc-100">Storage choice</dt><dd>After you select “Allow browser storage,” a small versioned entry in local storage records that choice so the app can remember it. This record contains the consent version and grant status, not your search history. “No thanks” is remembered only in memory for the current page session.</dd></div>
        </dl>
        <p>Before you allow storage, Crawlback reads only the small consent record to check your choice. It does not read app history or settings. App storage features stay disabled until you explicitly choose “Allow browser storage.” This consent covers browser storage for the app features described above. For storing or accessing information on your device, the legal basis is your consent under Section 25(1) TDDDG. To the extent the associated processing involves personal data, the basis is Article 6(1)(a) GDPR. The app does not rely on the exception in Section 25(2)(2) TDDDG for these features.</p>
        <p>History and preferences have no automatic time-based deletion. Source-list and opt-out data is normally refreshed after 24 hours, robots results after 48 hours, and archive-query results after seven days. These are freshness periods, not guaranteed deletion periods: stale entries and service-worker caches can remain until replaced or cleared. Cached HTML can be evicted when automatic pruning is enabled and the configured size limit is reached.</p>
      </section>

      <section className={sectionClass} aria-labelledby="privacy-controls">
        <h2 id="privacy-controls" className={headingClass}>Your controls</h2>
        <p>Use <Link href="/settings#storage" className={linkClass}>App settings</Link> to control saved HTML and clear its cache. “Clear all” in the danger zone resets the app’s IndexedDB history, settings, and captures. It does not remove every local-storage entry or the service-worker cache.</p>
        <p>Choose “Website settings” in the footer and turn browser storage off to withdraw consent. This removes the consent record, stops app features from accessing browser storage, unregisters the app’s service workers, and deletes Crawlback Cache Storage caches. It does not delete your saved IndexedDB history, captures, settings, or other app local-storage data from the device. You can use the browser’s site-data controls to remove remaining data, including local storage and IndexedDB. Exported files on your computer are separate and must be deleted there. You can allow storage again at any time.</p>
      </section>

      <section className={sectionClass} aria-labelledby="privacy-contact">
        <h2 id="privacy-contact" className={headingClass}>When you contact us</h2>
        <p>If you email us, your address and message are processed to handle your request. The legal basis is Article 6(1)(f) GDPR for correspondence, or Article 6(1)(b) for steps relating to a contract. Correspondence is retained only as needed to resolve the matter or meet applicable legal obligations.</p>
      </section>

      <section className={sectionClass} aria-labelledby="privacy-rights">
        <h2 id="privacy-rights" className={headingClass}>Your rights</h2>
        <p>Subject to the GDPR’s conditions, you may request access, correction, deletion, restriction of processing, and data portability. You may object to processing based on legitimate interests. If processing is based on consent, you may withdraw it with effect for the future. Contact us using the email above.</p>
        <p>You can complain to a data protection authority, including the <a href="https://www.datenschutz-berlin.de/" className={linkClass}>Berlin Commissioner for Data Protection and Freedom of Information</a>. We cannot remotely access or erase data stored only in your browser; the controls described above let you manage it directly.</p>
        <p>There is no profiling or automated decision-making with legal or similarly significant effects. Providing technical request data is necessary to deliver the website; you do not need to provide account details.</p>
      </section>
    </LegalPage>
  );
}
