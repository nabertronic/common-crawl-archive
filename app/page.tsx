import { Suspense } from "react";
import type { Metadata } from "next";
import { ArchiveSearchApp } from "@/components/archive-search-app";

export const metadata: Metadata = {
  title: "Crawlback · Common Crawl archive search for OSINT research",
  description:
    "Search Common Crawl for archived web pages and investigate deleted or changed content. A browser-based archive search tool for journalists and OSINT research.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Crawlback · Common Crawl archive search",
    description:
      "Find and review dated Common Crawl captures of deleted or changed web pages for investigative research.",
    type: "website"
  }
};

export default async function Home() {
  return (
    <Suspense>
      <ArchiveSearchApp />
    </Suspense>
  );
}
