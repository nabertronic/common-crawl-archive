"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent,
  type ReactNode
} from "react";
import {
  Archive,
  ChevronDown,
  Download,
  Eye,
  FileSearch,
  HardDrive,
  Radar,
  Terminal
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BrandWordmark } from "@/components/brand";
import { TopRightMenu } from "@/components/top-right-menu";
import { LandingBookmarkHint } from "@/components/landing-bookmark-hint";

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
      { threshold: 0, rootMargin: "0px 0px -8% 0px" }
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
    <div className="landing-section-heading">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
        <span className="text-amber-300">{"// "}</span>
        {label}
      </p>
      <h2 id={titleId} className="mt-2 text-2xl font-bold leading-tight text-zinc-50 sm:text-3xl">
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
    <nav
      aria-label="Landing sections"
      className={cn("landing-mini-header", visible && "is-visible")}
    >
      <a className="landing-mini-header__brand" href="#top" aria-label="Start scan">
        <BrandWordmark className="text-base leading-none" />
      </a>
      <div className="landing-mini-header__links">
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

function GlowPanel({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty("--card-spot-x", `${x.toFixed(2)}%`);
    event.currentTarget.style.setProperty("--card-spot-y", `${y.toFixed(2)}%`);
  };

  return (
    <div
      className={cn("archive-panel landing-glow-card rounded-md", className)}
      onPointerMove={handlePointerMove}
    >
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
    body: "Paste in a page or website address to start your search."
  },
  {
    number: "02",
    icon: Radar,
    title: "Scan the archive",
    body: "Crawlback looks for saved versions of that page."
  },
  {
    number: "03",
    icon: FileSearch,
    title: "View snapshots",
    body: "Open matching snapshots and save the results if you want."
  }
];

function HowItWorksSection() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-28">
      <Reveal>
        <SectionHeading label="How it works" title="Three steps to a lost page" titleId="how-it-works-title" />
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <GlowPanel key={step.number} className="p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-amber-300">{step.number}</span>
                <step.icon size={18} aria-hidden="true" className="text-zinc-400" />
              </div>
              <h3 className="mt-3 text-base font-bold text-zinc-50">{step.title}</h3>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-zinc-300">{step.body}</p>
            </GlowPanel>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function DataSourceSection() {
  return (
    <section id="data-source" aria-labelledby="data-source-title" className="scroll-mt-28">
      <Reveal>
        <SectionHeading label="Data source" title="Built on Common Crawl" titleId="data-source-title" />
        <GlowPanel className="mt-6 p-5 sm:p-6">
          <p className="text-[0.9375rem] leading-relaxed text-zinc-300">
            Common Crawl is a nonprofit that has been crawling the web since 2008 and publishes everything it
            collects as open data. Its archive spans more than 300 billion pages across 100+ crawl collections.
            Crawlback uses those crawls to find individual pages inside the archive.
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-zinc-300">
            Common Crawl is not the Wayback Machine. It doesn&apos;t archive on demand and it doesn&apos;t replay
            full pages, but it often captures pages archive.org never saved, or catches them at different points
            in time. That makes Crawlback a useful alternative for finding snapshots you won&apos;t see elsewhere.
          </p>
          <a
            href="https://commoncrawl.org"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-amber-200 underline underline-offset-2 transition hover:text-amber-100"
          >
            commoncrawl.org →
          </a>
        </GlowPanel>
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
    title: "Alternative archive",
    body: "Finds snapshots the Wayback Machine can miss, including moments it never captured."
  },
  {
    icon: HardDrive,
    title: "Local-first privacy",
    body: "Searches and requests run from your browser, and your history stays there. No server-side storage."
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
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {BENEFITS.map((benefit) => (
            <GlowPanel key={benefit.title} className="p-5">
              <div className="flex items-center gap-2">
                <benefit.icon size={18} aria-hidden="true" className="shrink-0 text-amber-300" />
                <h3 className="text-base font-bold text-zinc-50">{benefit.title}</h3>
              </div>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-300">{benefit.body}</p>
            </GlowPanel>
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
      "The Wayback Machine archives on demand and replays full pages. Crawlback searches Common Crawl, a separate archive built by broad crawls since 2008. The two overlap only partially. Common Crawl often holds captures the Wayback Machine is missing, which is exactly when Crawlback is useful."
  },
  {
    question: "What is Common Crawl?",
    answer:
      "A nonprofit that crawls the web and publishes the results as free, open data: over 300 billion pages across 100+ collections. Researchers, search engines, and language models use it. Crawlback gives it a page-level search interface."
  },
  {
    question: "Why can a scan take so long?",
    answer:
      "Some scans can take 20 minutes or more. The archive services behind Crawlback are often busy and heavily rate-limited, so Crawlback slows down on purpose to avoid getting your search blocked. The goal is to keep the scan going and get you results, even when that means waiting longer."
  },
  {
    question: "Why can't I see images and styles?",
    answer:
      "Common Crawl stores captured HTML, but reconstructing a page also needs its images, stylesheets, and scripts from the same moment, which mostly aren't in the archive. Crawlback renders the raw HTML in a sandbox instead of pretending to replay the page."
  },
  {
    question: "Is my search history uploaded anywhere?",
    answer:
      "No. Scans run from your browser, and history, coverage data, settings, and saved HTML stay in your browser. There is no server-side storage. You can wipe everything from Settings."
  },
  {
    question: "Why does a URL show as blocked or opted out?",
    answer:
      "Crawlback checks whether Common Crawl is currently blocked or opted out for that URL. Even if it is blocked now, you can still find older snapshots from times when the page was crawlable."
  },
  {
    question: "Does a scan hit the target website?",
    answer:
      "Almost never. Searches go to Common Crawl's index and data servers, not to the site you're researching. The only exception is a single robots.txt check to determine crawl permissions. For sensitive research targets, you can turn that off in Settings so the website is not contacted at all."
  },
];

function FaqItem({ item }: { item: { question: string; answer: string } }) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const answerId = useId();
  const maxHeight = open ? `${contentRef.current?.scrollHeight ?? 0}px` : "0px";

  return (
    <details
      open={open}
      className="group archive-panel landing-faq-item rounded-md"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-controls={answerId}
        className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[0.9375rem] font-semibold leading-snug text-zinc-100 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-300 sm:px-5 [&::-webkit-details-marker]:hidden"
      >
        {item.question}
        <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-zinc-400 transition-transform duration-300 group-open:rotate-180" />
      </summary>
      <div
        id={answerId}
        ref={contentRef}
        className="landing-faq-answer"
        style={{ "--answer-height": maxHeight } as CSSProperties}
      >
        <p className="px-4 pb-5 text-[0.9375rem] leading-relaxed text-zinc-300 sm:px-5">{item.answer}</p>
      </div>
    </details>
  );
}

function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-28">
      <Reveal>
        <SectionHeading label="FAQ" title="Questions" titleId="faq-title" />
        <div className="mt-6 space-y-2.5">
          {FAQ_ITEMS.map((item) => (
            <FaqItem key={item.question} item={item} />
          ))}
        </div>
      </Reveal>
    </section>
  );
}

export function LandingSections() {
  return (
    <>
      <LandingMiniHeader />
      <div className="relative z-10 mx-auto w-full max-w-3xl space-y-20 px-5 pb-10 pt-8 sm:space-y-24 md:px-8">
        <nav aria-label="Research guide" className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <Link
            href="/how-it-works#how-it-works"
            className="inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem] font-semibold text-zinc-100 underline decoration-zinc-600 underline-offset-4 transition hover:text-amber-200 hover:decoration-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          >
            How it works <span aria-hidden="true" className="text-amber-300">→</span>
          </Link>
          <Link
            href="/how-it-works#faq"
            className="inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem] font-semibold text-zinc-100 underline decoration-zinc-600 underline-offset-4 transition hover:text-amber-200 hover:decoration-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          >
            FAQ <span aria-hidden="true" className="text-amber-300">→</span>
          </Link>
        </nav>
        <HowItWorksSection />
        <BenefitsSection />
        <DataSourceSection />
        <FaqSection />
        <div className="border-t border-zinc-800 pt-6">
          <LandingBookmarkHint />
        </div>
      </div>
    </>
  );
}
