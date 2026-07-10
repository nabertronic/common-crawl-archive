import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { APP_NAME } from "@/lib/app-meta";
import { DevTools } from "@/components/dev/dev-tools";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Search 100+ Common Crawl collections — 300B+ pages archived since 2008 — to find past versions of any URL. A fallback web archive for when the Wayback Machine comes up empty. Runs entirely in your browser."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Consuming a request header opts the tree into dynamic rendering, which is
  // what lets Next stamp the per-request CSP nonce (set in proxy.ts) onto its
  // framework <script> tags. Without this the prerendered scripts carry no
  // nonce and 'strict-dynamic' would block all of them.
  await headers();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        {/* Registers the background-scan service worker (production only). */}
        <ServiceWorkerRegistrar />
        {/* Dev-only Performance overlay; its chunk is tree-shaken out of prod. */}
        <DevTools />
      </body>
    </html>
  );
}
