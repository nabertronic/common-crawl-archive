import type { Metadata } from "next";
import { SettingsApp } from "@/components/settings-app";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: `Settings · ${APP_NAME}`
};

export default function SettingsPage() {
  return <SettingsApp />;
}
