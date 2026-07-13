import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => {
  const lookup = vi.fn(async (hostname: string) => {
    if (hostname === "example.com") return [{ address: "93.184.216.34", family: 4 }];
    if (hostname === "internal.example") return [{ address: "169.254.169.254", family: 4 }];
    return [{ address: "8.8.8.8", family: 4 }];
  });
  return { lookup, default: { lookup } };
});

// Fake node:https so the route's pinned transport never opens a real socket.
const httpsRequestMock = vi.fn();
vi.mock("node:https", () => {
  const request = (...args: unknown[]) => httpsRequestMock(...args);
  return { request, default: { request } };
});

import { POST } from "@/app/api/robots/route";
import { resetRobotsRateLimitForTests } from "@/lib/robots-rate-limit";

type Listener = (...args: unknown[]) => void;

function requestFor(url?: string, headers: Record<string, string> = {}) {
  return new Request("https://app.example/api/robots", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: url ? JSON.stringify({ url }) : undefined
  });
}

function fakeResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  httpsRequestMock.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
    const resListeners: Record<string, Listener[]> = {};
    const res = {
      statusCode: status,
      headers,
      on(event: string, cb: Listener) {
        (resListeners[event] ??= []).push(cb);
        return res;
      }
    };
    const req = {
      on() {
        return req;
      },
      end() {
        callback(res);
        queueMicrotask(() => {
          resListeners.data?.forEach((cb) => cb(Buffer.from(body)));
          resListeners.end?.forEach((cb) => cb());
        });
      },
      destroy() {}
    };
    return req;
  });
}

describe("robots API route", () => {
  beforeEach(() => {
    resetRobotsRateLimitForTests();
    httpsRequestMock.mockReset();
  });

  it("returns the evaluated CCBot robots status", async () => {
    fakeResponse("User-agent: CCBot\nDisallow: /private\n");

    const response = await POST(requestFor("https://example.com/private/page"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "blocked",
      robotsUrl: "https://example.com/robots.txt",
      targetPath: "/private/page",
      matchedRule: {
        directive: "disallow",
        path: "/private"
      }
    });
  });

  it("reports a missing URL body value as unavailable", async () => {
    const response = await POST(requestFor());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      status: "unavailable",
      error: "Missing url in JSON request body."
    });
  });

  it("refuses to fetch hosts that resolve to a private or reserved address", async () => {
    httpsRequestMock.mockReset();

    const response = await POST(requestFor("https://internal.example/admin"));
    const body = await response.json();

    expect(httpsRequestMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "unavailable" });
    expect(body.error).toMatch(/private or reserved/i);
  });

  it("rejects non-http(s) schemes without issuing a request", async () => {
    httpsRequestMock.mockReset();

    const response = await POST(requestFor("file:///etc/passwd"));
    const body = await response.json();

    expect(httpsRequestMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: "unavailable" });
  });

  it("rate limits repeated robots checks by client", async () => {
    fakeResponse("User-agent: CCBot\nAllow: /\n");
    const request = () => requestFor("https://example.com/", { "x-forwarded-for": "203.0.113.10" });

    for (let index = 0; index < 30; index += 1) {
      expect((await POST(request())).status).toBe(200);
    }
    const limited = await POST(request());
    const body = await limited.json();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(body).toMatchObject({
      status: "unavailable",
      error: "Too many robots checks. Try again shortly."
    });
  });
});
