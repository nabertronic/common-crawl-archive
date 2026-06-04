import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a fresh nonce. Next.js automatically
 * stamps the nonce onto its own framework/bootstrap <script> tags when it sees
 * the nonce in the request's CSP header, so no markup changes are needed.
 *
 * Notable allowances (each is required by this app, not a blanket relaxation):
 *  - script-src uses nonce + 'strict-dynamic'; 'unsafe-eval' only in dev (HMR).
 *  - style-src keeps 'unsafe-inline' because React inline style={} attributes
 *    cannot be covered by a nonce. Styles are not a script-execution vector.
 *  - connect-src allows the Common Crawl index/data hosts the client fetches
 *    directly from the browser.
 *  - frame-src 'self' permits the sandboxed srcdoc capture preview iframe.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isProd = process.env.NODE_ENV === "production";

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://index.commoncrawl.org https://data.commoncrawl.org",
    "frame-src 'self'",
    "upgrade-insecure-requests"
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Apply to all routes except API responses and static assets, which don't
    // render HTML and don't need a nonce.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "x-middleware-prefetch" }
      ]
    }
  ]
};
