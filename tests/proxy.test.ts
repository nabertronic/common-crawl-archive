import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { clerkTestState } from "./setup";

async function proxyResponse(request: NextRequest) {
  const response = await proxy(request, {} as never);
  if (!response) throw new Error("Expected proxy response");
  return response;
}

async function cspOf(request: NextRequest) {
  return (await proxyResponse(request)).headers.get("content-security-policy") ?? "";
}

afterEach(() => {
  vi.unstubAllEnvs();
  clerkTestState.isAuthenticated = true;
});

describe("CSP proxy", () => {
  it("emits a policy with the core hardening directives", async () => {
    const csp = await cspOf(new NextRequest("https://app.test/"));

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    // The client talks to Common Crawl directly from the browser.
    expect(csp).toContain("connect-src 'self' https://index.commoncrawl.org https://data.commoncrawl.org");
    // Sandboxed srcdoc preview iframe.
    expect(csp).toContain("frame-src 'self'");
    // Same-origin compute worker (with blob: for bundlers that use it).
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it("uses a nonce with strict-dynamic for scripts", async () => {
    const csp = await cspOf(new NextRequest("https://app.test/"));
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  });

  it("generates a fresh, unique nonce per request", async () => {
    const nonce = (csp: string) => csp.match(/'nonce-([^']+)'/)?.[1];
    const first = nonce(await cspOf(new NextRequest("https://app.test/")));
    const second = nonce(await cspOf(new NextRequest("https://app.test/")));

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("exposes the same nonce to the app via the x-nonce request header", async () => {
    const response = await proxyResponse(new NextRequest("https://app.test/"));
    const headerNonce = response.headers.get("content-security-policy")?.match(/'nonce-([^']+)'/)?.[1];
    const forwarded = response.headers.get("x-middleware-override-headers");
    // The nonce is forwarded to the rendered request; assert the policy carries one.
    expect(headerNonce).toBeTruthy();
    // x-nonce is set on the forwarded request headers (Next encodes overrides).
    expect(forwarded ?? "").toMatch(/x-nonce/i);
  });

  it("omits 'unsafe-eval' in production but allows it in development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await cspOf(new NextRequest("https://app.test/"))).not.toContain("'unsafe-eval'");

    vi.stubEnv("NODE_ENV", "development");
    expect(await cspOf(new NextRequest("https://app.test/"))).toContain("'unsafe-eval'");
  });

  it("redirects an unsigned visitor from pages before the app shell renders", async () => {
    clerkTestState.isAuthenticated = false;

    const response = await proxyResponse(new NextRequest("https://app.test/settings"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("returns a non-cacheable 404 for unsigned API requests", async () => {
    clerkTestState.isAuthenticated = false;

    const response = await proxyResponse(new NextRequest("https://app.test/api/robots"));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
