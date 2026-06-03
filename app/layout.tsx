import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Client-side Common Crawl capture search and WARC viewer."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
