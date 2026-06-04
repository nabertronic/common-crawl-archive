import { Suspense } from "react";
import { ArchiveSearchApp } from "@/components/archive-search-app";

export default function SearchPage() {
  return (
    <Suspense>
      <ArchiveSearchApp autoStart />
    </Suspense>
  );
}
