import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  default: {
    readFile: (...args: unknown[]) => readFileMock(...args)
  }
}));

import { GET, resetOptOutRegistryRouteForTests } from "@/app/api/opt-out-registry/route";

describe("opt-out registry API route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    readFileMock.mockReset();
    resetOptOutRegistryRouteForTests();
  });

  it("returns the live registry when the upstream CSV is reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          [
            "Publisher/Requester,Date of notice,List of domains/URLs",
            "LAST UPDATED: 2026 Jun 23,,",
            "Example,2026-06-01,example.com"
          ].join("\n"),
          { status: 200 }
        )
      )
    );

    const response = await GET(new Request("https://app.example/api/opt-out-registry"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Opt-Out-Registry-Source")).toBe("live");
    expect(body).toMatchObject({
      sourceUpdatedAt: "2026 Jun 23",
      entries: [
        {
          normalized: "example.com",
          scope: "domain"
        }
      ]
    });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("falls back to the bundled snapshot when the upstream CSV is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    readFileMock.mockResolvedValue(
      [
        "Publisher/Requester,Date of notice,List of domains/URLs",
        "LAST UPDATED: 2026 Jun 20,,",
        "Example,2026-06-01,example.com"
      ].join("\n")
    );

    const response = await GET(new Request("https://app.example/api/opt-out-registry"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Opt-Out-Registry-Source")).toBe("snapshot");
    expect(body).toMatchObject({
      sourceUpdatedAt: "2026 Jun 20",
      entries: [
        {
          normalized: "example.com",
          scope: "domain"
        }
      ]
    });
  });

  it("reuses a short-lived live response", async () => {
    const fetchMock = vi.fn(async () => new Response([
      "Publisher/Requester,Date of notice,List of domains/URLs",
      "LAST UPDATED: 2026 Jun 23,,",
      "Example,2026-06-01,example.com"
    ].join("\n"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = () => new Request("https://app.example/api/opt-out-registry", { headers: { "x-real-ip": "203.0.113.50" } });
    await GET(request());
    await GET(request());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 429 with Retry-After and no-store once a client exceeds 30 requests per minute", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    readFileMock.mockResolvedValue([
      "Publisher/Requester,Date of notice,List of domains/URLs",
      "LAST UPDATED: 2026 Jun 20,,",
      "Example,2026-06-01,example.com"
    ].join("\n"));
    const request = () => new Request("https://app.example/api/opt-out-registry", { headers: { "x-real-ip": "203.0.113.51" } });
    for (let index = 0; index < 30; index += 1) {
      expect((await GET(request())).status).toBe(200);
    }
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(limited.headers.get("Cache-Control")).toContain("no-store");
    expect(await limited.json()).toMatchObject({ error: expect.stringMatching(/too many/i) });
  });

  it("rejects HTML or empty live data and falls back to the bundled snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>temporarily unavailable</html>", { status: 200 })));
    readFileMock.mockResolvedValue([
      "Publisher/Requester,Date of notice,List of domains/URLs",
      "LAST UPDATED: 2026 Jun 20,,",
      "Example,2026-06-01,example.com"
    ].join("\n"));
    const response = await GET(new Request("https://app.example/api/opt-out-registry"));
    expect(response.headers.get("X-Opt-Out-Registry-Source")).toBe("snapshot");
  });

  it("rejects a declared oversized registry response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("large", { status: 200, headers: { "content-length": String(5 * 1024 * 1024 + 1) } })));
    readFileMock.mockResolvedValue([
      "Publisher/Requester,Date of notice,List of domains/URLs",
      "LAST UPDATED: 2026 Jun 20,,",
      "Example,2026-06-01,example.com"
    ].join("\n"));
    const response = await GET(new Request("https://app.example/api/opt-out-registry"));
    expect(response.headers.get("X-Opt-Out-Registry-Source")).toBe("snapshot");
  });
});
