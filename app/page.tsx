import { Suspense } from "react";
import { ArchiveSearchApp } from "@/components/archive-search-app";

export default function Home() {
  return (
    <Suspense>
      <ArchiveSearchApp />
    </Suspense>
  );
}
