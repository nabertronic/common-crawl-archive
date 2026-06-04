import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Client-side Common Crawl capture search and WARC viewer."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Consuming a request header opts the tree into dynamic rendering, which is
  // what lets Next stamp the per-request CSP nonce (set in proxy.ts) onto its
  // framework <script> tags. Without this the prerendered scripts carry no
  // nonce and 'strict-dynamic' would block all of them.
  await headers();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
