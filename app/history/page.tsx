import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { HistoryApp } from "@/components/history-app";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: `History · ${APP_NAME}`
};

export default async function HistoryPage() {
  await auth.protect();
  return <HistoryApp />;
}
