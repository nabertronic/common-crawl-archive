import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCollectionsMock = vi.fn();
vi.mock("@/lib/common-crawl", () => ({
  fetchCollections: (...args: unknown[]) => fetchCollectionsMock(...args)
}));

import { GET, resetCollectionsRateLimitForTests } from "@/app/api/common-crawl/collections/route";

const collections = [
  { id: "CC-MAIN-2026-26", name: "June 2026", cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-26-index", from: "2026-06-01", to: "2026-06-30" }
];

function requestFrom(ip: string, refresh = false): Request {
  const suffix = refresh ? "?refresh=1" : "";
  return new Request(`https://app.example/api/common-crawl/collections${suffix}`, {
    headers: { "x-forwarded-for": ip }
  });
}

describe("common-crawl collections API route", () => {
  beforeEach(() => {
    fetchCollectionsMock.mockReset();
    resetCollectionsRateLimitForTests();
  });

  it("returns the collection list with a no-store cache header", async () => {
    fetchCollectionsMock.mockResolvedValue(collections);

    const response = await GET(requestFrom("203.0.113.20"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(collections);
    expect(fetchCollectionsMock).toHaveBeenCalledWith({ forceRefresh: false, signal: expect.any(AbortSignal) });
  });

  it("passes forceRefresh through when ?refresh=1 is set", async () => {
    fetchCollectionsMock.mockResolvedValue(collections);

    await GET(requestFrom("203.0.113.21"));
    await GET(requestFrom("203.0.113.21", true));
    expect(fetchCollectionsMock).toHaveBeenNthCalledWith(1, { forceRefresh: false, signal: expect.any(AbortSignal) });
    expect(fetchCollectionsMock).toHaveBeenNthCalledWith(2, { forceRefresh: true, signal: expect.any(AbortSignal) });
  });

  it("serves normal requests from the server cache while allowing an explicit refresh", async () => {
    fetchCollectionsMock.mockResolvedValue(collections);
    await GET(requestFrom("203.0.113.25"));
    await GET(requestFrom("203.0.113.25"));
    expect(fetchCollectionsMock).toHaveBeenCalledTimes(1);
    await GET(requestFrom("203.0.113.25", true));
    expect(fetchCollectionsMock).toHaveBeenCalledTimes(2);
  });

  it("returns a generic 502 message and logs the real upstream error server-side", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const upstream = new Error("getaddrinfo ENOTFOUND internal-proxy.corp.example");
    fetchCollectionsMock.mockRejectedValue(upstream);

    const response = await GET(requestFrom("203.0.113.22"));
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Could not reach Common Crawl from this network" });
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), upstream);
    errorSpy.mockRestore();
  });

  it("rate limits a client after the per-minute budget is exhausted", async () => {
    fetchCollectionsMock.mockResolvedValue(collections);
    const client = "203.0.113.99";

    for (let i = 0; i < 20; i += 1) {
      expect((await GET(requestFrom(client))).status).toBe(200);
    }
    const limited = await GET(requestFrom(client));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(await limited.json()).toMatchObject({ error: expect.stringMatching(/too many/i) });
    // The route's in-memory cache collapses the successful upstream calls.
    expect(fetchCollectionsMock).toHaveBeenCalledTimes(1);
  });
});
