import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  default: {
    readFile: (...args: unknown[]) => readFileMock(...args)
  }
}));

import { GET } from "@/app/api/opt-out-registry/route";

describe("opt-out registry API route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    readFileMock.mockReset();
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

    const response = await GET();
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

    const response = await GET();
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
});
