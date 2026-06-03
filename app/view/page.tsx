import { Suspense } from "react";
import { CaptureViewerApp } from "@/components/capture-viewer-app";

export default function ViewPage() {
  return (
    <Suspense>
      <CaptureViewerApp />
    </Suspense>
  );
}
