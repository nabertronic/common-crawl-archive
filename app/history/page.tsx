import type { Metadata } from "next";
import { HistoryApp } from "@/components/history-app";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: `History · ${APP_NAME}`
};

export default async function HistoryPage() {
  return <HistoryApp />;
}
