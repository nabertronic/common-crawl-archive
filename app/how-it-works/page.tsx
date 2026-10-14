import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works: Common Crawl archive search for journalists · Crawlback",
  description:
    "A practical guide for journalists using Crawlback and Common Crawl to investigate deleted or changed web pages, review captures, and verify evidence.",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    title: "How Crawlback works for journalists",
    description:
      "Search Common Crawl for deleted or changed pages, understand what a capture shows, and verify archive evidence.",
    type: "article"
  }
};

const sectionClass = "scroll-mt-8 border-t border-zinc-800 py-9 sm:py-11";
const headingClass = "font-mono text-xs font-bold uppercase tracking-[0.18em] text-amber-300";
const paragraphClass = "mt-4 max-w-2xl text-base leading-7 text-zinc-300";
const linkClass = "text-amber-300 underline decoration-amber-300/40 underline-offset-4 hover:text-amber-200";

const faqs = [
  {
    question: "What is Common Crawl?",
    answer: (
      <>
        Common Crawl is an independent nonprofit that collects samples of publicly available web pages and
        publishes its archive data for research. Its crawls happen over time; it does not save every page or
        capture every change. Crawlback searches its index for records matching the address you enter. Learn
        more at <a href="https://www.commoncrawl.org/" className={linkClass}>Common Crawl</a> or search its
        index directly at <a href="https://index.commoncrawl.org/" className={linkClass}>index.commoncrawl.org</a>.
      </>
    )
  },
  {
    question: "What does OSINT mean here?",
    answer:
      "OSINT means open-source intelligence: research and analysis using information available to the public. An archived page can be one useful source among many. It does not by itself establish who published a page or whether its claims were true."
  },
  {
    question: "Can Common Crawl find a page missing from the Wayback Machine?",
    answer:
      "Sometimes. Common Crawl is a separate archive, with different crawl schedules and coverage, so it may contain a capture another archive does not have. It may also have no matching capture. There is no guarantee a page or a particular version was collected."
  },
  {
    question: "How does a search reach Common Crawl?",
    answer:
      "The search request goes from your browser directly to Common Crawl's public index or archive service. An API is simply a defined way for software to ask a service for data and receive a response. Crawlback's server does not relay your archive search. Supporting checks use the server: it requests the target website's robots.txt and gets Common Crawl's public list of excluded sites. Your browser checks whether the target is on that list."
  },
  {
    question: "Why is the preview incomplete?",
    answer:
      "The archive may contain captured HTML without the images, stylesheets, fonts, or other files needed to recreate the original page. Crawlback shows a limited HTML preview and does not run archived scripts. It is a way to inspect captured content, not a faithful replay of the live page."
  },
  {
    question: "How should I verify a capture before publishing?",
    answer:
      "Keep the exact page URL and the capture date with your notes. The capture date is when Common Crawl saved the page, not when the page was first published. Compare the page with other captures and independent sources, and check whether the archived content supports the claim you plan to make. A capture does not prove authorship, completeness, or accuracy."
  },
  {
    question: "Why did a search receive a 503 or slow down?",
    answer: (
      <>
        Common Crawl can limit requests, and people on the same network may share a public IP address and its
        limit. A different public IP can receive a different limit; this is not a reliable fix. Follow the
        <a href="https://www.commoncrawl.org/faq" className={linkClass}> Common Crawl FAQ</a>: if you get an
        HTTP 503 response, slow down. If Common Crawl temporarily blocks your IP address, wait 24 hours before
        trying again. Avoid concurrent requests from the same IP, and do not cycle through IP addresses or use
        proxy networks to get around limits.
      </>
    )
  }
] as const;

export default function HowItWorksPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 pb-14 pt-10 text-zinc-100 sm:px-8 sm:pt-16">
      <Link href="/" className="-ml-1 inline-flex min-h-11 items-center px-1 text-sm text-zinc-300 transition hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">
        ← Back to Crawlback
      </Link>

      <header className="mt-8 border-b border-zinc-800 pb-9 sm:mt-14 sm:pb-11">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-300/80">Field guide · Web archives</p>
        <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-[1.05] tracking-[-0.025em] text-zinc-50 sm:text-5xl">
          Finding and checking archived web pages
        </h1>
        <p className={paragraphClass}>
          Use Crawlback to look for earlier versions of pages that have disappeared or changed. This guide
          explains what the archive can show, how searches work, and how to treat a capture as evidence.
        </p>
        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm">
          <a href="#how-it-works" className={linkClass}>How it works</a>
          <a href="#faq" className={linkClass}>FAQ</a>
        </nav>
      </header>

      <section id="how-it-works" aria-labelledby="guide-heading" className={sectionClass}>
        <p className={headingClass}>01 · How it works</p>
        <h2 id="guide-heading" className="mt-3 text-2xl font-bold leading-tight text-zinc-50">From a URL to a dated capture</h2>
        <ol className="mt-6 space-y-5">
          <li className="flex gap-4">
            <span className="pt-0.5 font-mono text-sm font-bold text-amber-300">01</span>
            <p className="text-base leading-7 text-zinc-300"><strong className="text-zinc-100">Enter the address.</strong> Paste the page URL you want to investigate. You can search for a page or broaden the search to a site.</p>
          </li>
          <li className="flex gap-4">
            <span className="pt-0.5 font-mono text-sm font-bold text-amber-300">02</span>
            <p className="text-base leading-7 text-zinc-300"><strong className="text-zinc-100">Review the matches.</strong> Crawlback checks Common Crawl’s indexes and shows matching captures with their dates. The capture date is when the crawler saved the page, not necessarily when the page was published. Search coverage can vary, and an empty result does not establish that a page never existed.</p>
          </li>
          <li className="flex gap-4">
            <span className="pt-0.5 font-mono text-sm font-bold text-amber-300">03</span>
            <p className="text-base leading-7 text-zinc-300"><strong className="text-zinc-100">Inspect and verify.</strong> Open a capture, note its URL and date, and compare its content against other records and sources before using it in a story.</p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="request-heading" className={sectionClass}>
        <p className={headingClass}>02 · Where requests go</p>
        <h2 id="request-heading" className="mt-3 text-2xl font-bold leading-tight text-zinc-50">Archive searches go from your browser</h2>
        <p className={paragraphClass}>
          When you search, your computer requests archive records directly from Common Crawl’s public services.
          Crawlback’s server does not relay those archive queries. An API is a simple doorway that lets one
          program ask another service for information in a defined format.
        </p>
        <p className={paragraphClass}>
          Two supporting checks use Crawlback’s server. For a robots.txt check, Crawlback’s server uses the
          target URL to request the website’s robots.txt, which contains that website’s instructions to crawlers.
          Crawlback’s server also gets the
          public list of sites excluded from Common Crawl, then your browser checks whether the target is on
          that list. See the <Link href="/privacy" className={linkClass}>Privacy page</Link> for request details.
        </p>
      </section>

      <section aria-labelledby="evidence-heading" className={sectionClass}>
        <p className={headingClass}>03 · Reading a capture</p>
        <h2 id="evidence-heading" className="mt-3 text-2xl font-bold leading-tight text-zinc-50">A record of captured content, with gaps</h2>
        <p className={paragraphClass}>
          Common Crawl collects samples of the web. A result may help you investigate a deleted, changed, or
          hard-to-find page, including one absent from another archive, but coverage is never guaranteed.
        </p>
        <p className={paragraphClass}>
          Previews can be incomplete because the archived HTML may not come with the original images, styles,
          scripts, or current assets. Treat the preview as captured material, not as a working reconstruction.
          Record the capture date and exact URL, then cross-check the content and where the capture came from before publication.
        </p>
        <div className="mt-6 border-l border-amber-300/50 pl-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-amber-300">Example · Local government notice</p>
          <p className="mt-2 max-w-2xl text-base leading-7 text-zinc-300">
            Suppose a city removes a notice about a road closure. Search the notice’s URL, open an earlier
            capture, and note the date Common Crawl saved it. Compare the wording with the city’s later notice
            and another independent record before reporting what changed. The saved date does not tell you
            when the city first published the notice.
          </p>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-heading" className={sectionClass}>
        <p className={headingClass}>04 · FAQ</p>
        <h2 id="faq-heading" className="mt-3 text-2xl font-bold leading-tight text-zinc-50">Questions from researchers</h2>
        <div className="mt-6 divide-y divide-zinc-800 border-y border-zinc-800">
          {faqs.map((faq) => (
            <details key={faq.question} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-base font-semibold leading-snug text-zinc-100 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 [&::-webkit-details-marker]:hidden">
                {faq.question}
                <span aria-hidden="true" className="shrink-0 font-mono text-xl text-amber-300 transition-transform duration-300 group-open:rotate-45">+</span>
              </summary>
              <p className="max-w-2xl pb-1 pt-3 text-base leading-7 text-zinc-300">{faq.answer}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-sm leading-6 text-zinc-400">
          For Common Crawl’s current request guidance, consult its <a href="https://www.commoncrawl.org/faq" className={linkClass}>official FAQ</a> and <a href="https://www.commoncrawl.org/terms-of-use" className={linkClass}>Terms of Use</a>.
        </p>
      </section>
    </main>
  );
}
