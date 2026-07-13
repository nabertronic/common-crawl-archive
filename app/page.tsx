import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { ArchiveSearchApp } from "@/components/archive-search-app";

export default async function Home() {
  await auth.protect();
  return (
    <Suspense>
      <ArchiveSearchApp />
    </Suspense>
  );
}
