import type { Metadata } from "next";
import { Suspense } from "react";
import { CaptureViewerApp } from "@/components/capture-viewer-app";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: `View snapshot · ${APP_NAME}`
};

export default function ViewPage() {
  return (
    <Suspense>
      <CaptureViewerApp />
    </Suspense>
  );
}
