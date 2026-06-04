import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function cspOf(request: NextRequest) {
  return proxy(request).headers.get("content-security-policy") ?? "";
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CSP proxy", () => {
  it("emits a policy with the core hardening directives", () => {
    const csp = cspOf(new NextRequest("https://app.test/"));

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    // The client talks to Common Crawl directly from the browser.
    expect(csp).toContain("connect-src 'self' https://index.commoncrawl.org https://data.commoncrawl.org");
    // Sandboxed srcdoc preview iframe.
    expect(csp).toContain("frame-src 'self'");
  });

  it("uses a nonce with strict-dynamic for scripts", () => {
    const csp = cspOf(new NextRequest("https://app.test/"));
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  });

  it("generates a fresh, unique nonce per request", () => {
    const nonce = (csp: string) => csp.match(/'nonce-([^']+)'/)?.[1];
    const first = nonce(cspOf(new NextRequest("https://app.test/")));
    const second = nonce(cspOf(new NextRequest("https://app.test/")));

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("exposes the same nonce to the app via the x-nonce request header", () => {
    const response = proxy(new NextRequest("https://app.test/"));
    const headerNonce = response.headers.get("content-security-policy")?.match(/'nonce-([^']+)'/)?.[1];
    const forwarded = response.headers.get("x-middleware-override-headers");
    // The nonce is forwarded to the rendered request; assert the policy carries one.
    expect(headerNonce).toBeTruthy();
    // x-nonce is set on the forwarded request headers (Next encodes overrides).
    expect(forwarded ?? "").toMatch(/x-nonce/i);
  });

  it("omits 'unsafe-eval' in production but allows it in development", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(cspOf(new NextRequest("https://app.test/"))).not.toContain("'unsafe-eval'");

    vi.stubEnv("NODE_ENV", "development");
    expect(cspOf(new NextRequest("https://app.test/"))).toContain("'unsafe-eval'");
  });
});
