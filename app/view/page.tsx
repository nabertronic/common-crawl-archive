import type { Metadata } from "next";
import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { CaptureViewerApp } from "@/components/capture-viewer-app";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: `View snapshot · ${APP_NAME}`
};

export default async function ViewPage() {
  await auth.protect();
  return (
    <Suspense>
      <CaptureViewerApp />
    </Suspense>
  );
}
