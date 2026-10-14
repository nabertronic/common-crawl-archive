import type { Metadata } from "next";
import { Suspense } from "react";
import { ArchiveSearchApp } from "@/components/archive-search-app";
import { APP_NAME } from "@/lib/app-meta";

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const urlParam = params?.url;
  const target = (Array.isArray(urlParam) ? urlParam[0] : urlParam)?.trim();

  return {
    robots: { index: false, follow: false },
    title: target ? `${target} · ${APP_NAME}` : `Search · ${APP_NAME}`
  };
}

export default async function SearchPage() {
  return (
    <Suspense>
      <ArchiveSearchApp autoStart />
    </Suspense>
  );
}
