"use client";

import { useEffect } from "react";
import { registerScanServiceWorker } from "@/lib/background-scan";
import { disableStorageWorkers, hasStorageConsent, subscribeStorageConsent } from "@/lib/website-preferences";

/**
 * Registers the background-scan service worker. Production-only on purpose: a
 * caching service worker on the dev origin would serve stale assets during
 * development, so `next dev` stays untouched. Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const sync = () => {
      if (!hasStorageConsent()) { disableStorageWorkers(); return; }
      void registerScanServiceWorker().then((registration) => {
        if (!hasStorageConsent()) { disableStorageWorkers(); return; }
        const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
        worker?.postMessage({ type: "consent:grant" });
        navigator.serviceWorker.controller?.postMessage({ type: "consent:grant" });
      });
    };
    sync();
    return subscribeStorageConsent(sync);
  }, []);

  return null;
}

export default ServiceWorkerRegistrar;
