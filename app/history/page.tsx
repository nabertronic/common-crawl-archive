import type { Metadata } from "next";
import { HistoryApp } from "@/components/history-app";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: `History · ${APP_NAME}`
};

export default function HistoryPage() {
  return <HistoryApp />;
}
