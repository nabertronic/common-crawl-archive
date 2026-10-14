import { Suspense } from "react";
import { ArchiveSearchApp } from "@/components/archive-search-app";

export default async function Home() {
  return (
    <Suspense>
      <ArchiveSearchApp />
    </Suspense>
  );
}
