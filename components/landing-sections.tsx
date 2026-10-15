"use client";

import { useId, useEffect, useRef, useState, type ComponentType, type PointerEvent, type ReactNode } from "react";
import { Archive, ChevronDown, Download, Eye, FileSearch, HardDrive, Radar, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandWordmark } from "@/components/brand";
import { TopRightMenu } from "@/components/top-right-menu";
import { LandingBookmarkHint } from "@/components/landing-bookmark-hint";
import { GITHUB_REPOSITORY_URL } from "@/lib/app-meta";

const REVEAL_MARGIN_RATIO = 0.08;
const REVEAL_FAILSAFE_MS = 2500;

/**
 * Scroll reveal. SSR/first paint is fully visible; the hidden initial state
 * (`scroll-reveal` class) is only armed after mount, and only for sections
 * that are still below the fold. Sections already in or above the viewport
 * (scroll restoration, hash jumps, bfcache) are shown immediately, and a
 * failsafe guarantees nothing stays hidden.
 */
function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const belowFold = () => node.getBoundingClientRect().top >= window.innerHeight * (1 - REVEAL_MARGIN_RATIO);
    if (typeof IntersectionObserver === "undefined" || !belowFold()) {
      setVisible(true);
      return;
    }
    setArmed(true);
    const reveal = () => setVisible(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.boundingClientRect.top < 0)) reveal();
      },
      { threshold: 0, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(node);
    // Jumped past the section (hash/scroll restoration): the observer reports it as not intersecting.
    const onScroll = () => {
      if (!belowFold()) reveal();
    };
    const onPageShow = () => onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("hashchange", onScroll);
    const failsafe = window.setTimeout(reveal, REVEAL_FAILSAFE_MS);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("hashchange", onScroll);
      window.clearTimeout(failsafe);
    };
  }, []);

  return (
    <div ref={ref} className={cn(armed && "scroll-reveal", visible && "is-visible", className)}>
      {children}
    </div>
  );
}

function SectionHeading({ label, title, titleId, className }: { label: string; title: string; titleId: string; className?: string }) {
  return (
    <div className={cn("landing-section-heading ledger:pb-5", className)}>
      <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-zinc-400 ledger:hidden">
        <span className="text-amber-300">{"// "}</span>
        {label}
      </p>
      <h2 id={titleId} className="mt-2 text-2xl font-bold leading-tight text-zinc-50 sm:text-3xl ledger:mt-0 ledger:font-serif ledger:text-[clamp(1.875rem,9vw,2.25rem)] ledger:font-normal ledger:leading-[1.02] ledger:tracking-[-0.02em] ledger:text-balance ledger:sm:text-[3.25rem]">
        {title}
      </h2>
    </div>
  );
}

const LANDING_NAV_ITEMS = [
  { href: "#top", label: "Start scan", id: "top" },
  { href: "#how-it-works", label: "How it works", id: "how-it-works" },
  { href: "#why-crawlback", label: "Why Crawlback", id: "why-crawlback" },
  { href: "#data-source", label: "Data source", id: "data-source" },
  { href: "#faq", label: "FAQ", id: "faq" }
] as const;

function LandingMiniHeader() {
  const [visible, setVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<(typeof LANDING_NAV_ITEMS)[number]["id"]>("top");
  const linksRef = useRef<HTMLDivElement>(null);

  // On phones the link strip scrolls horizontally; keep the active link in view (horizontal only,
  // so the page itself never jumps).
  useEffect(() => {
    const strip = linksRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !active) return;
    const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollTo?.({ left: Math.max(0, left), behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [activeSection]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setVisible(window.scrollY > Math.max(220, window.innerHeight * 0.42));

      const readingLine = Math.round(window.innerHeight * 0.42);
      let current: (typeof LANDING_NAV_ITEMS)[number]["id"] = "top";
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const item of LANDING_NAV_ITEMS.slice(1)) {
        const section = document.getElementById(item.id);
        if (!section) continue;
        const rect = section.getBoundingClientRect();
        const isVisible = rect.bottom > 90 && rect.top < window.innerHeight;
        if (!isVisible) continue;

        if (rect.top <= readingLine && rect.bottom >= readingLine) {
          current = item.id;
          break;
        }

        const sectionCenter = rect.top + rect.height / 2;
        const distance = Math.abs(sectionCenter - readingLine);
        if (distance < closestDistance) {
          closestDistance = distance;
          current = item.id;
        }
      }
      setActiveSection(current);
    };
    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  return (
    <nav aria-label="Landing sections" className={cn("landing-mini-header", visible && "is-visible")}>
      <a className="landing-mini-header__brand" href="#top" aria-label="Start scan">
        <BrandWordmark className="text-base leading-none" />
      </a>
      <div ref={linksRef} className="landing-mini-header__links">
        {LANDING_NAV_ITEMS.map((item) => (
          <a
            key={item.id}
            href={item.href}
            aria-current={activeSection === item.id ? "true" : undefined}
            className={cn(activeSection === item.id && "is-active")}
          >
            {item.label}
          </a>
        ))}
      </div>
      <div className="landing-mini-header__menu">
        <TopRightMenu mode="inline" />
      </div>
    </nav>
  );
}

function GlowPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty("--card-spot-x", `${x.toFixed(2)}%`);
    event.currentTarget.style.setProperty("--card-spot-y", `${y.toFixed(2)}%`);
  };

  return (
    // Ledger border and background use !important because theme-ledger.css styles .archive-panel outside any layer.
    <div className={cn("archive-panel landing-glow-card rounded-md ledger:rounded-none ledger:!border-0 ledger:!bg-transparent", className)} onPointerMove={handlePointerMove}>
      {children}
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
    body: "Paste a page address to search for that page, or a site address to search more broadly."
  },
  {
    number: "02",
    icon: Radar,
    title: "Scan the archive",
    body: "Crawlback checks Common Crawl's index for saved versions, with their capture dates."
  },
  {
    number: "03",
    icon: FileSearch,
    title: "View snapshots",
    body: "Open a snapshot to read the page as it was captured, then export what you need."
  }
];

function HowItWorksSection() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-28">
      <Reveal>
        <SectionHeading label="How it works" title="Three steps to a lost page" titleId="how-it-works-title" />
        <ol className="ledger-stagger mt-6 grid list-none gap-3 p-0 sm:grid-cols-3 ledger:mt-10 ledger:gap-0 ledger:sm:grid-cols-3">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <li
              key={step.number}
              className="ledger-item ledger:border-b ledger:border-zinc-800 ledger:py-6 ledger:first:pt-2 ledger:sm:border-b-0 ledger:sm:border-r ledger:sm:py-0 ledger:sm:px-10 ledger:sm:first:pl-0 ledger:sm:last:border-r-0 ledger:sm:last:pr-0"
            >
              <GlowPanel className="h-full p-5 ledger:!p-0">
                <div className="flex items-center justify-between ledger:hidden">
                  <span className="font-mono text-sm font-bold text-amber-300">{step.number}</span>
                  <step.icon size={18} aria-hidden="true" className="text-zinc-400" />
                </div>
                <span className="ledger-nudge hidden ledger:mb-4 ledger:block ledger:font-mono ledger:text-[0.8125rem] ledger:font-bold ledger:tabular-nums ledger:text-amber-300">{step.number}</span>
                <h3 className="ledger-shift mt-3 text-base font-bold text-zinc-50 ledger:mt-0 ledger:font-serif ledger:font-normal ledger:text-[1.75rem] ledger:leading-[1.1]">{step.title}</h3>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-zinc-300 ledger:mt-3 ledger:max-w-[34ch] ledger:text-base ledger:leading-relaxed">{step.body}</p>
              </GlowPanel>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}

function DataSourceSection() {
  return (
    <section id="data-source" aria-labelledby="data-source-title" className="scroll-mt-28">
      <Reveal>
        <SectionHeading label="Data source" title="Built on Common Crawl" titleId="data-source-title" />
        <GlowPanel className="mt-6 p-5 sm:p-6 ledger:mt-8 ledger:!p-0">
          <p className="text-[0.9375rem] leading-relaxed text-zinc-300 ledger:font-serif ledger:text-[1.375rem] ledger:leading-[1.3] ledger:text-zinc-50 ledger:sm:text-[1.75rem] ledger:sm:leading-[1.25]">
            Common Crawl is an independent nonprofit that has been crawling the web since 2008 and publishes
            everything it collects as open data. Its archive spans more than 300 billion pages across 100+ crawl
            collections. It collects samples of the web, so it does not save every page or capture every change.
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-zinc-300 ledger:mt-[18px] ledger:text-base ledger:text-zinc-300">
            Crawlback uses those crawls to find individual pages inside the archive. Results are captured HTML,
            not live replays of the page.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 ledger:mt-6 ledger:gap-x-[22px]">
            <a
              href="https://commoncrawl.org"
              target="_blank"
              rel="noreferrer"
              className="ledger-arrow-link inline-flex min-h-11 items-center text-sm font-semibold text-amber-200 underline underline-offset-2 transition hover:text-amber-100 ledger:font-bold ledger:text-zinc-50 ledger:underline-offset-4 ledger:hover:text-amber-300"
            >
              commoncrawl.org <span className="ledger-arrow">→</span>
            </a>
            <a
              href="https://www.commoncrawl.org/faq"
              target="_blank"
              rel="noreferrer"
              className="ledger-arrow-link inline-flex min-h-11 items-center text-sm font-semibold text-amber-200 underline underline-offset-2 transition hover:text-amber-100 ledger:font-bold ledger:text-zinc-50 ledger:underline-offset-4 ledger:hover:text-amber-300"
            >
              Common Crawl FAQ <span className="ledger-arrow">→</span>
            </a>
          </div>
        </GlowPanel>
      </Reveal>
    </section>
  );
}

type BenefitCard = {
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
};

const BENEFITS: BenefitCard[] = [
  {
    icon: Archive,
    title: "Alternative archive",
    body: "Finds snapshots the Wayback Machine can miss, including moments it never captured."
  },
  {
    icon: HardDrive,
    title: "Local-first privacy",
    body: "Searches run from your browser, and your history stays there with no server-side storage. You can wipe everything from Settings."
  },
  {
    icon: Eye,
    title: "Secure viewing",
    body: "Archived HTML renders in a sandbox. No archived scripts execute, nothing phones home."
  },
  {
    icon: Download,
    title: "Portable results",
    body: "Export capture lists as CSV or download the raw HTML as a ZIP file to keep."
  }
];

function BenefitsSection() {
  return (
    <section id="why-crawlback" aria-labelledby="why-crawlback-title" className="scroll-mt-28">
      <Reveal>
        <SectionHeading
          label="Why Crawlback"
          title="A web archive that stays out of your way"
          titleId="why-crawlback-title"
        />
        <ul className="ledger-stagger mt-6 grid list-none gap-3 p-0 sm:grid-cols-2 ledger:mt-2 ledger:gap-0 ledger:gap-x-12 ledger:sm:grid-cols-2">
          {BENEFITS.map((benefit) => (
            <li key={benefit.title} className="ledger-item ledger:border-b ledger:border-zinc-800 ledger:py-6 ledger:sm:py-8">
              <GlowPanel className="h-full p-5 ledger:!p-0">
                <div className="flex items-center gap-2 ledger:flex-col ledger:items-start ledger:gap-4">
                  <benefit.icon size={18} aria-hidden="true" className="shrink-0 text-amber-300 ledger:hidden" />
                  <benefit.icon size={20} strokeWidth={1.5} aria-hidden="true" className="ledger-nudge hidden text-amber-300 ledger:block" />
                  <h3 className="ledger-shift text-base font-bold text-zinc-50 ledger:font-serif ledger:text-[1.625rem] ledger:font-normal ledger:leading-[1.1] ledger:sm:text-[1.875rem]">{benefit.title}</h3>
                </div>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-300 ledger:mt-3 ledger:max-w-[44ch] ledger:text-base ledger:leading-relaxed">{benefit.body}</p>
              </GlowPanel>
            </li>
          ))}
        </ul>
        <LandingBookmarkHint />
      </Reveal>
    </section>
  );
}

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "How is this different from the Wayback Machine?",
    answer:
      "The Wayback Machine archives on demand and replays full pages. Crawlback searches Common Crawl, a separate archive built by broad crawls since 2008. The two overlap only partially. Common Crawl often holds captures the Wayback Machine is missing, which is exactly when Crawlback is useful."
  },
  {
    question: "Why can a scan take so long?",
    answer:
      "Common Crawl limits request rates, and everyone on the same network can share one public IP address and its limit. Crawlback slows down on purpose to avoid getting your search blocked, so some scans take 20 minutes or more. If you get an HTTP 503 response, slow down. If Common Crawl temporarily blocks your IP address, wait 24 hours before trying again. Avoid parallel requests. Common Crawl's public index API is often overloaded, so if you get many errors, simply try again later."
  },
  {
    question: "Why is the preview incomplete?",
    answer:
      "The preview is incomplete for security and privacy reasons. Common Crawl mostly stores the captured HTML, not the images, stylesheets, and scripts that were loaded with it at that moment. Crawlback shows the captured HTML in a sandbox: archived scripts never run, so a capture cannot execute code. The preview also does not load external resources from the original site or third-party servers, so opening a capture does not contact those servers or reveal your visit or IP address to them."
  },
  {
    question: "How should I verify a capture before publishing?",
    answer:
      "Keep the exact URL and the capture date. The capture date is when Common Crawl saved the page, not when it was first published. Compare the capture with other captures and independent sources. A capture alone does not prove who wrote a page or that its claims are true."
  },
  {
    question: "Why does a URL show as blocked or opted out?",
    answer:
      "Crawlback checks whether Common Crawl is currently blocked or opted out for that URL. Even if it is blocked now, you can still find older snapshots from times when the page was crawlable."
  },
  {
    question: "Does a scan hit the target website?",
    answer:
      "Almost never. Your browser sends archive searches straight to Common Crawl's public index and data servers, not to the site you're researching. Crawlback's server makes one request to the target, a robots.txt check. For sensitive research targets, you can turn that off in Settings so the website is not contacted at all."
  }
];

const FAQ_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer }
  }))
}).replace(/</g, "\\u003c");

function FaqItem({ item }: { item: { question: string; answer: string } }) {
  const [open, setOpen] = useState(false);
  const buttonId = useId();
  const panelId = useId();

  return (
    <div className="archive-panel landing-faq-item rounded-md ledger:rounded-none ledger:!border-x-0 ledger:!border-t-0 ledger:!border-b ledger:!border-zinc-800 ledger:!bg-transparent">
      <h3 className="m-0">
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="group landing-faq-trigger flex w-full min-h-14 cursor-pointer items-center justify-between gap-3 rounded-md px-4 py-3.5 text-left text-[0.9375rem] font-semibold leading-snug text-zinc-100 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-300 sm:px-5 ledger:rounded-none ledger:px-0 ledger:py-5 ledger:font-serif ledger:text-[1.3125rem] ledger:font-normal ledger:leading-[1.2] ledger:sm:px-0 ledger:sm:text-[1.625rem] ledger:hover:text-amber-300"
        >
          <span>{item.question}</span>
          <ChevronDown size={18} aria-hidden="true" className="landing-faq-chevron shrink-0 text-zinc-400 ledger:hidden" />
          <span
            aria-hidden="true"
            className="ledger-faq-plus hidden shrink-0 font-serif text-[1.75rem] leading-none text-amber-300 transition-transform duration-200 ledger:inline-block ledger:group-aria-expanded:rotate-45"
          >
            +
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        data-open={open ? "true" : "false"}
        className="landing-faq-panel"
      >
        <div className="landing-faq-panel__inner">
          <p className="px-4 pb-5 text-[0.9375rem] leading-relaxed text-zinc-300 sm:px-5 ledger:px-0 ledger:sm:px-0 ledger:pb-6 ledger:max-w-[68ch] ledger:text-base ledger:pr-8 ledger:sm:pr-0">{item.answer}</p>
        </div>
      </div>
    </div>
  );
}

function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-28">
      <Reveal>
        <div className="ledger:md:grid ledger:md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] ledger:md:gap-12">
          <SectionHeading
            label="FAQ"
            title="Frequently asked questions"
            titleId="faq-title"
            className="ledger:md:sticky ledger:md:top-28 ledger:md:self-start ledger:md:border-b-0 ledger:md:pb-0"
          />
          <div className="ledger-stagger mt-6 space-y-2.5 ledger:mt-0 ledger:space-y-0 ledger:border-t-[1.5px] ledger:border-zinc-50">
            {FAQ_ITEMS.map((item) => (
              <FaqItem key={item.question} item={item} />
            ))}
          </div>
        </div>
      </Reveal>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
    </section>
  );
}

export function LandingSections() {
  return (
    <>
      <LandingMiniHeader />
      <div className="relative z-10 mx-auto w-full max-w-3xl space-y-20 px-5 pb-10 pt-8 sm:space-y-24 md:px-8 ledger:max-w-6xl ledger:space-y-16 ledger:sm:space-y-28 ledger:md:space-y-36 ledger:md:px-10">
        <HowItWorksSection />
        <BenefitsSection />
        <DataSourceSection />
        <FaqSection />
        <p className="text-center text-[0.9375rem] leading-relaxed text-zinc-300">
          Crawlback is open source.{" "}
          <a
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ledger-arrow-link inline-flex min-h-11 items-center font-semibold text-amber-200 underline underline-offset-2 transition hover:text-amber-100 ledger:font-bold ledger:text-zinc-50 ledger:underline-offset-4 ledger:hover:text-amber-300"
          >
            Read the code on GitHub <span className="ledger-arrow">→</span>
          </a>
        </p>
      </div>
    </>
  );
}
