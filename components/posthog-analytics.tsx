"use client";

import { useAuth } from "@clerk/nextjs";
import posthog from "posthog-js";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const isPostHogConfigured = Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);

/**
 * Identifies only authenticated beta users and emits route-only page views.
 * Query strings are deliberately excluded because Crawlback URLs can be
 * sensitive search targets.
 */
export function PostHogAnalytics() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn, userId } = useAuth();

  useEffect(() => {
    if (!isPostHogConfigured || !isLoaded) return;

    if (!isSignedIn || !userId) {
      posthog.reset();
      return;
    }

    posthog.identify(userId);
    posthog.capture("$pageview", {
      $current_url: `${window.location.origin}${pathname}`,
      page_path: pathname
    });
  }, [isLoaded, isSignedIn, pathname, userId]);

  return null;
}
