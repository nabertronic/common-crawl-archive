import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

declare global {
  interface Window {
    __crawlbackPosthogToolbar?: string;
  }
}

function currentCspNonce() {
  return document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
}

if (projectToken) {
  posthog.init(projectToken, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-05-30",
    // Crawlback searches can contain sensitive target URLs. We capture only
    // explicit, query-free events below instead of recording clicks or form
    // content automatically.
    autocapture: false,
    // Project settings enable the heatmap UI, but setting this explicitly in
    // the client makes sure the SDK also collects the aggregated position data.
    // This is independent of session replay and does not record typed content.
    enable_heatmaps: true,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    person_profiles: "identified_only",
    // The admin-only PostHog toolbar loads its own scripts and stylesheet.
    // Apply the request's existing Next.js nonce so our CSP continues to
    // protect every script while allowing that explicit, authorized launch.
    prepare_external_dependency_script: (script) => {
      const cspNonce = currentCspNonce();
      if (cspNonce) script.nonce = cspNonce;
      return script;
    },
    prepare_external_dependency_stylesheet: (stylesheet) => {
      const cspNonce = currentCspNonce();
      if (cspNonce) stylesheet.nonce = cspNonce;
      return stylesheet;
    }
  });

  // Preserve toolbar access in App Router applications: the server-rendered
  // script captures the launch hash before the router is able to rewrite it.
  const toolbarJSON = window.__crawlbackPosthogToolbar;
  if (toolbarJSON) {
    delete window.__crawlbackPosthogToolbar;
    try {
      posthog.loadToolbar(JSON.parse(toolbarJSON));
    } catch {
      // A malformed URL fragment must never interrupt access to the app.
    }
  }
}
