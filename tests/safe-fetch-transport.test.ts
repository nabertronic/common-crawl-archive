import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Resolve every hostname to a public address so the SSRF address guard passes
// and we reach the real pinned node transport (the subject of these tests).
vi.mock("node:dns/promises", () => {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  return { lookup, default: { lookup } };
});

// Fake node:https so no real socket opens. The fake lets a test stream arbitrary
// response chunks and simulates `req.destroy(err)` emitting the request "error".
const httpsRequestMock = vi.fn();
vi.mock("node:https", () => {
  const request = (...args: unknown[]) => httpsRequestMock(...args);
  return { request, default: { request } };
});

import { SsrfError, safeFetch } from "@/lib/safe-fetch";

type Listener = (...args: unknown[]) => void;

function respondWithChunks(chunks: Buffer[], status = 200, headers: Record<string, string> = {}) {
  httpsRequestMock.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
    const resListeners: Record<string, Listener[]> = {};
    const reqListeners: Record<string, Listener[]> = {};
    let destroyed = false;
    const res = {
      statusCode: status,
      headers,
      on(event: string, cb: Listener) {
        (resListeners[event] ??= []).push(cb);
        return res;
      }
    };
    const req = {
      on(event: string, cb: Listener) {
        (reqListeners[event] ??= []).push(cb);
        return req;
      },
      end() {
        callback(res);
        queueMicrotask(() => {
          for (const chunk of chunks) {
            if (destroyed) break;
            resListeners.data?.forEach((cb) => cb(chunk));
          }
          if (!destroyed) resListeners.end?.forEach((cb) => cb());
        });
      },
      destroy(err?: Error) {
        destroyed = true;
        if (err) reqListeners.error?.forEach((cb) => cb(err));
      }
    };
    return req;
  });
}

describe("safeFetch pinned node transport", () => {
  beforeEach(() => {
    httpsRequestMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the buffered body for a small response", async () => {
    respondWithChunks([Buffer.from("hello "), Buffer.from("world")]);

    const response = await safeFetch("https://example.com/robots.txt");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");
  });

  it("aborts and rejects when the body exceeds the size limit", async () => {
    // Three 1 MiB chunks = 3 MiB, past the 2 MiB MAX_RESPONSE_BYTES cap.
    const oneMiB = Buffer.alloc(1024 * 1024, 0x61);
    respondWithChunks([oneMiB, oneMiB, oneMiB]);

    await expect(safeFetch("https://example.com/huge")).rejects.toThrowError(SsrfError);
    await expect(safeFetch("https://example.com/huge")).rejects.toThrow(/size limit/i);
  });

  it("accepts a body that sits just under the limit", async () => {
    // Two 1 MiB chunks = 2 MiB exactly, which is not over the cap.
    const oneMiB = Buffer.alloc(1024 * 1024, 0x62);
    respondWithChunks([oneMiB, oneMiB]);

    const response = await safeFetch("https://example.com/big");
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);
  });
});
