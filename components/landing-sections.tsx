"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Archive,
  ChevronDown,
  Download,
  Eye,
  FileSearch,
  HardDrive,
  Layers,
  Radar,
  ShieldCheck,
  Terminal
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BrandWordmark } from "@/components/brand";

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("scroll-reveal", visible && "is-visible", className)}>
      {children}
    </div>
  );
}

function SectionHeading({ label, title, titleId }: { label: string; title: string; titleId: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">
        <span className="text-amber-300">{"// "}</span>
        {label}
      </p>
      <h2 id={titleId} className="mt-2 text-xl font-bold text-zinc-100 sm:text-2xl">
        {title}
      </h2>
    </div>
  );
}

type StepCard = {
  number: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
};

const HOW_IT_WORKS_STEPS: StepCard[] = [
  {
    number: "01",
    icon: Terminal,
    title: "Enter a URL",
    body: "Paste a page, host, or domain. Crawlback normalizes it and checks robots.txt and the opt-out registry before scanning."
  },
  {
    number: "02",
    icon: Radar,
    title: "Scan the archive",
    body: "Every public Common Crawl collection is queried through the CDX index — the last 12 months, the full archive since 2008, or a custom range."
  },
  {
    number: "03",
    icon: FileSearch,
    title: "View snapshots",
    body: "Matching captures load straight from the WARC files into a sandboxed local viewer. Export results as CSV or download the HTML as a ZIP."
  }
];

function HowItWorksSection() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-16">
      <Reveal>
        <SectionHeading label="How it works" title="Three steps to a lost page" titleId="how-it-works-title" />
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <div key={step.number} className="archive-panel rounded-md p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-amber-300">{step.number}</span>
                <step.icon size={18} className="text-zinc-500" />
              </div>
              <h3 className="mt-3 text-sm font-bold text-zinc-100">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{step.body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function DataSourceSection() {
  return (
    <section id="data-source" aria-labelledby="data-source-title" className="scroll-mt-16">
      <Reveal>
        <SectionHeading label="Data source" title="Built on Common Crawl" titleId="data-source-title" />
        <div className="archive-panel mt-5 rounded-md p-5">
          <p className="text-sm leading-6 text-zinc-400">
            Common Crawl is a nonprofit that has been crawling the web since 2008 and publishes everything it
            collects as open data. Its archive spans more than 300 billion pages across 100+ crawl collections.
            Crawlback queries the public CDX index at index.commoncrawl.org and reads captures directly from the
            WARC files at data.commoncrawl.org.
          </p>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Common Crawl is not the Wayback Machine. It doesn&apos;t archive on demand and it doesn&apos;t replay
            full pages — but it has often seen pages the Wayback Machine never captured. When a wayback lookup
            comes up empty, Crawlback is the second place to check.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.22em] text-zinc-500">
            <span>
              <span className="text-zinc-300">300B+</span> pages
            </span>
            <span className="text-amber-300/70">·</span>
            <span>
              <span className="text-zinc-300">100+</span> crawls
            </span>
            <span className="text-amber-300/70">·</span>
            <span>
              since <span className="text-zinc-300">2008</span>
            </span>
          </div>
          <a
            href="https://commoncrawl.org"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-sm font-semibold text-amber-200 underline underline-offset-2 transition hover:text-amber-100"
          >
            commoncrawl.org →
          </a>
        </div>
      </Reveal>
    </section>
  );
}

type BenefitCard = {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
};

const BENEFITS: BenefitCard[] = [
  {
    icon: Archive,
    title: "Fallback archive",
    body: "Recovers pages the Wayback Machine never captured. A second chance for dead links."
  },
  {
    icon: Layers,
    title: "Full-archive coverage",
    body: "Scans every public collection since 2008 in one pass — not just the most recent crawl."
  },
  {
    icon: HardDrive,
    title: "Local-first privacy",
    body: "Scan history, coverage, and cached HTML live in your browser's IndexedDB. No accounts, no server-side storage."
  },
  {
    icon: ShieldCheck,
    title: "Respects exclusions",
    body: "Checks the target's robots.txt for CCBot and the Common Crawl opt-out registry, and tells you when a site has opted out."
  },
  {
    icon: Eye,
    title: "Sandboxed viewing",
    body: "Archived HTML renders in a sandbox. No archived scripts execute, nothing phones home."
  },
  {
    icon: Download,
    title: "Portable results",
    body: "Export capture lists as CSV or download the raw HTML as a ZIP."
  }
];

function BenefitsSection() {
  return (
    <section id="why-crawlback" aria-labelledby="why-crawlback-title" className="scroll-mt-16">
      <Reveal>
        <SectionHeading
          label="Why Crawlback"
          title="A fallback archive that stays out of your way"
          titleId="why-crawlback-title"
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {BENEFITS.map((benefit) => (
            <div key={benefit.title} className="archive-panel rounded-md p-4">
              <div className="flex items-center gap-2">
                <benefit.icon size={16} className="shrink-0 text-amber-300" />
                <h3 className="text-sm font-bold text-zinc-100">{benefit.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{benefit.body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "How is this different from the Wayback Machine?",
    answer:
      "The Wayback Machine archives on demand and replays full pages. Crawlback searches Common Crawl, a separate archive built by broad crawls since 2008. The two overlap only partially — Common Crawl often holds captures the Wayback Machine is missing, which is exactly when Crawlback is useful."
  },
  {
    question: "What is Common Crawl?",
    answer:
      "A nonprofit that crawls the web and publishes the results as free, open data: over 300 billion pages across 100+ collections. Researchers, search engines, and language models are built on it. Crawlback gives it a page-level search interface."
  },
  {
    question: "Why can't I see images and styles?",
    answer:
      "Common Crawl stores captured HTML, but reconstructing a page also needs its images, stylesheets, and scripts from the same moment — which mostly aren't in the archive. Crawlback renders the raw HTML in a sandbox instead of pretending to replay the page."
  },
  {
    question: "Is my search history uploaded anywhere?",
    answer:
      "No. Scans run from your browser, and history, coverage data, settings, and cached HTML are stored locally in IndexedDB. There are no accounts and no server-side storage. You can wipe everything from Settings."
  },
  {
    question: "Why does a URL show as blocked or opted out?",
    answer:
      "Crawlback checks the site's robots.txt for Common Crawl's CCBot and the Common Crawl Foundation opt-out registry. If a site blocks the crawler or has opted out, Crawlback surfaces that instead of silently returning nothing — though older crawls may still contain captures from before the block."
  },
  {
    question: "Does a scan hit the target website?",
    answer:
      "Almost never. Searches go to Common Crawl's index and data servers, not to the site you're researching. The only exception is a single robots.txt check, fetched through the app server to determine crawl permissions."
  }
];

function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16">
      <Reveal>
        <SectionHeading label="FAQ" title="Questions" titleId="faq-title" />
        <div className="mt-5 space-y-3">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group archive-panel rounded-md">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold text-zinc-200 transition hover:text-zinc-50 [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown size={16} className="shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-4 pb-4 text-sm leading-6 text-zinc-400">{item.answer}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

const FOOTER_EXTERNAL_LINKS = [
  { href: "https://commoncrawl.org", label: "Common Crawl" },
  { href: "https://index.commoncrawl.org", label: "CDX index" },
  {
    href: "https://commoncrawl.org/blog/common-crawl-foundation-opt-out-registry",
    label: "Opt-out registry"
  }
];

const FOOTER_INTERNAL_LINKS = [
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" }
];

function LandingFooter() {
  const linkClass = "text-zinc-500 transition hover:text-amber-200";
  return (
    <footer className="border-t border-zinc-800 pb-6 pt-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <BrandWordmark className="text-base leading-none" />
        <p className="text-xs text-zinc-500">A fallback archive for the open web.</p>
      </div>
      <nav
        aria-label="Footer"
        className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs uppercase tracking-[0.14em]"
      >
        {FOOTER_EXTERNAL_LINKS.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className={linkClass}>
            {link.label}
          </a>
        ))}
        {FOOTER_INTERNAL_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className={linkClass}>
            {link.label}
          </Link>
        ))}
      </nav>
      <p className="mt-5 text-[11px] leading-5 text-zinc-600">
        Crawlback renders archived HTML only — no asset reconstruction, no JavaScript replay. Not affiliated with
        the Common Crawl Foundation.
      </p>
    </footer>
  );
}

export function LandingSections() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl space-y-20 px-4 pb-10 pt-8 md:px-8">
      <HowItWorksSection />
      <DataSourceSection />
      <BenefitsSection />
      <FaqSection />
      <LandingFooter />
    </div>
  );
}
