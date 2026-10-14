import type { NextConfig } from "next";

// Static hardening headers applied to every response. The full
// Content-Security-Policy (with a per-request nonce) is set in proxy.ts (the
// Next.js middleware/proxy entrypoint); these are the controls that don't need a
// nonce.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // Isolates the browsing context group from cross-origin popups/openers.
  // COEP is deliberately NOT set: it would block the cross-origin Common Crawl
  // fetches that the app depends on.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" }
];

const nextConfig: NextConfig = {
  images: {
    unoptimized: true
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      },
      {
        // Legal notice pages are kept out of search indexes and archives.
        source: "/:path(imprint|impressum)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" }]
      }
    ];
  }
};

export default nextConfig;
