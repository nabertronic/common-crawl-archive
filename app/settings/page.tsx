import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SettingsApp } from "@/components/settings-app";
import { APP_NAME } from "@/lib/app-meta";

export const metadata: Metadata = {
  title: `Settings · ${APP_NAME}`
};

export default async function SettingsPage() {
  await auth.protect();
  const user = await currentUser();
  return (
    <SettingsApp
      initialAccount={{
        email: user?.primaryEmailAddress?.emailAddress ?? null
      }}
    />
  );
}
