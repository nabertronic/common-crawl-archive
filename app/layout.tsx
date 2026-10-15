import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/app-meta";
import { DevTools } from "@/components/dev/dev-tools";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { SiteFooter } from "@/components/site-footer";
import { WebsitePreferences } from "@/components/website-preferences";
import { StorageConsentGate } from "@/components/storage-consent-gate";

// Atkinson Hyperlegible was drawn by the Braille Institute for low-vision
// readers: unambiguous letterforms (Il1, O0) matter when reading URLs and dates.
const sans = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-sans-family", display: "swap" });
const mono = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--font-mono-family", display: "swap" });
// Display serif for headlines and large numbers).
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif-family", display: "swap" });

export const viewport: Viewport = {
  themeColor: "#f3f1ec",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export const metadata: Metadata = {
  title: APP_NAME,
  metadataBase: new URL("https://crawlback.cc"),
  description: "Search public web archives to investigate old pages and find useful sources for reporting and research."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Consuming a request header opts the tree into dynamic rendering, which is
  // what lets Next stamp the per-request CSP nonce (set in proxy.ts) onto its
  // framework <script> tags. Without this the prerendered scripts carry no
  // nonce and 'strict-dynamic' would block all of them.
  await headers();
  return (
    // data-scroll-behavior tells Next that <html> uses CSS smooth scrolling, so it
    // disables that smoothing during route transitions (new pages start at the top).
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`} data-theme="ledger" style={{ colorScheme: "light" }} data-scroll-behavior="smooth">
      <body>
        <StorageConsentGate>{children}</StorageConsentGate>
        <SiteFooter />
        <WebsitePreferences />
        {/* Registers the background-scan service worker (production only). */}
        <ServiceWorkerRegistrar />
        {/* Dev-only Performance overlay; its chunk is tree-shaken out of prod. */}
        <DevTools />
      </body>
    </html>
  );
}
