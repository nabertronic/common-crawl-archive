import { describe, expect, it, vi } from "vitest";

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

import { GET } from "@/app/api/robots/route";

type Listener = (...args: unknown[]) => void;

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
  it("returns the evaluated CCBot robots status", async () => {
    fakeResponse("User-agent: CCBot\nDisallow: /private\n");

    const response = await GET(new Request("https://app.example/api/robots?url=https%3A%2F%2Fexample.com%2Fprivate%2Fpage"));
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

  it("reports missing URL parameters as unavailable", async () => {
    const response = await GET(new Request("https://app.example/api/robots"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      status: "unavailable",
      error: "Missing url query parameter."
    });
  });

  it("refuses to fetch hosts that resolve to a private or reserved address", async () => {
    httpsRequestMock.mockReset();

    const response = await GET(new Request("https://app.example/api/robots?url=https%3A%2F%2Finternal.example%2Fadmin"));
    const body = await response.json();

    expect(httpsRequestMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "unavailable" });
    expect(body.error).toMatch(/private or reserved/i);
  });

  it("rejects non-http(s) schemes without issuing a request", async () => {
    httpsRequestMock.mockReset();

    const response = await GET(new Request("https://app.example/api/robots?url=file%3A%2F%2F%2Fetc%2Fpasswd"));
    const body = await response.json();

    expect(httpsRequestMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: "unavailable" });
  });
});
