import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

async function proxyResponse(request: NextRequest) {
  const response = await proxy(request);
  if (!response) throw new Error("Expected proxy response");
  return response;
}

async function cspOf(request: NextRequest) {
  return (await proxyResponse(request)).headers.get("content-security-policy") ?? "";
}

afterEach(() => vi.unstubAllEnvs());

describe("public CSP proxy", () => {
  it("emits a policy with the core hardening directives", async () => {
    const csp = await cspOf(new NextRequest("https://app.test/"));

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self' https://index.commoncrawl.org https://data.commoncrawl.org");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toMatch(/clerk|posthog/i);
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

  it("forwards the nonce to the rendered request", async () => {
    const response = await proxyResponse(new NextRequest("https://app.test/"));
    expect(response.headers.get("x-middleware-override-headers") ?? "").toMatch(/x-nonce/i);
  });

  it("omits 'unsafe-eval' in production but allows it in development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await cspOf(new NextRequest("https://app.test/"))).not.toContain("'unsafe-eval'");

    vi.stubEnv("NODE_ENV", "development");
    expect(await cspOf(new NextRequest("https://app.test/"))).toContain("'unsafe-eval'");
  });

  it.each(["https://app.test/settings", "https://app.test/api/robots"])(
    "allows public requests to %s through the security proxy",
    async (url) => {
      const response = await proxyResponse(new NextRequest(url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    }
  );
});
