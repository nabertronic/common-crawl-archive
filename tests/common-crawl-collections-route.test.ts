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
    expect(fetchCollectionsMock).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it("passes forceRefresh through when ?refresh=1 is set", async () => {
    fetchCollectionsMock.mockResolvedValue(collections);

    await GET(requestFrom("203.0.113.21", true));
    expect(fetchCollectionsMock).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("surfaces upstream failures as HTTP 502", async () => {
    fetchCollectionsMock.mockRejectedValue(new Error("Could not reach Common Crawl from this network"));

    const response = await GET(requestFrom("203.0.113.22"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Could not reach Common Crawl from this network" });
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
    // The blocked request must not trigger another upstream fetch.
    expect(fetchCollectionsMock).toHaveBeenCalledTimes(20);
  });
});
