import { clerkMiddleware } from "@clerk/nextjs/server";
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
    // PostHog renders the in-app heatmap viewer by embedding the page. Keep
    // framing blocked everywhere else while allowing only the EU PostHog app.
    "frame-ancestors 'self' https://eu.posthog.com",
    "form-action 'self'",
    // The PostHog toolbar is launched only by an authorized PostHog admin, but
    // it loads its own UI assets when active. Permit PostHog's domains without
    // weakening the app's own script nonce policy.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://*.posthog.com${isProd ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://*.posthog.com",
    "img-src 'self' data: blob: https://*.posthog.com",
    // Compute worker is same-origin bundled code; some bundlers instantiate it
    // from a blob: URL, which worker-src must permit (it does not inherit the
    // strict-dynamic script-src, only default-src, which is 'self').
    "worker-src 'self' blob:",
    "font-src 'self' https://*.posthog.com",
    "media-src 'self' https://*.posthog.com",
    "connect-src 'self' https://index.commoncrawl.org https://data.commoncrawl.org https://clerk.linewise.app https://accounts.linewise.app https://*.posthog.com",
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

function isPublicAuthenticationPath(pathname: string) {
  return pathname === "/sign-in" || pathname.startsWith("/sign-in/");
}

/**
 * Clerk is the first gate for every document and API request. Protected pages
 * and route handlers also call auth.protect() directly: this early check keeps
 * signed-out visitors out of the app shell, while resource checks remain the
 * non-bypassable authorization boundary.
 */
export const proxy = clerkMiddleware(
  async (auth, request) => {
    const pathname = request.nextUrl.pathname;

    if (!isPublicAuthenticationPath(pathname)) {
      const session = await auth();
      if (!session.isAuthenticated) {
        // Do not confirm which application endpoints exist to signed-out callers.
        if (pathname.startsWith("/api/")) {
          return new NextResponse(null, {
            status: 404,
            headers: {
              "Cache-Control": "no-store",
              "X-Robots-Tag": "noindex, nofollow"
            }
          });
        }
        return session.redirectToSignIn({ returnBackUrl: request.url });
      }
    }

    return securityResponse(request);
  }
);

export default proxy;

export const config = {
  matcher: [
    // Skip Next.js internals and static files, but always cover app APIs.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)"
  ]
};
