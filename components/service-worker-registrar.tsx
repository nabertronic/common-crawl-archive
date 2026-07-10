"use client";

import { useEffect } from "react";
import { registerScanServiceWorker } from "@/lib/background-scan";

/**
 * Registers the background-scan service worker. Production-only on purpose: a
 * caching service worker on the dev origin would serve stale assets during
 * development, so `next dev` stays untouched. Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    void registerScanServiceWorker();
  }, []);

  return null;
}

export default ServiceWorkerRegistrar;
