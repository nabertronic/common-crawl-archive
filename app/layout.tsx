import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { headers } from "next/headers";
import "./globals.css";
import { APP_NAME } from "@/lib/app-meta";
import { DevTools } from "@/components/dev/dev-tools";
import { PostHogAnalytics } from "@/components/posthog-analytics";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Private beta access for Crawlback.",
  robots: {
    index: false,
    follow: false
  }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Consuming a request header opts the tree into dynamic rendering, which is
  // what lets Next stamp the per-request CSP nonce (set in proxy.ts) onto its
  // framework <script> tags. Without this the prerendered scripts carry no
  // nonce and 'strict-dynamic' would block all of them.
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://clerk.linewise.app" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="//clerk.linewise.app" />
        {/* Next's router can remove the Toolbar launch hash before posthog-js
            initializes. Preserve it first, then the client module consumes it. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var toolbarJSON=new URLSearchParams(window.location.hash.substring(1)).get('__posthog');if(toolbarJSON){window.__crawlbackPosthogToolbar=toolbarJSON;}})();"
          }}
        />
      </head>
      <body>
        <ClerkProvider>
          {children}
          <PostHogAnalytics />
          {/* Registers the background-scan service worker (production only). */}
          <ServiceWorkerRegistrar />
          {/* Dev-only Performance overlay; its chunk is tree-shaken out of prod. */}
          <DevTools />
        </ClerkProvider>
      </body>
    </html>
  );
}
