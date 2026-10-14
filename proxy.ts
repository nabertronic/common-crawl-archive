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
function securityResponse(request: NextRequest) {
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
    // Compute worker is same-origin bundled code; some bundlers instantiate it
    // from a blob: URL, which worker-src must permit (it does not inherit the
    // strict-dynamic script-src, only default-src, which is 'self').
    "worker-src 'self' blob:",
    "font-src 'self'",
    "media-src 'self'",
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

/** Public request proxy that applies the nonce CSP to documents and APIs. */
export function proxy(request: NextRequest) {
  return securityResponse(request);
}

export default proxy;

export const config = {
  matcher: [
    // Skip Next.js internals and static files, but always cover app APIs.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)"
  ]
};
