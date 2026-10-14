import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function createWorkerHarness(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, (event: any) => void>();
  const cache = { match: vi.fn(async () => undefined), put: vi.fn(async (): Promise<void> => {}) };
  const cacheOpen = vi.fn(async () => cache);
  const cacheDelete = vi.fn(async () => true);
  const self = {
    addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler),
    skipWaiting: vi.fn(), clients: { claim: vi.fn(), matchAll: vi.fn(async () => []) }
  };
  const source = readFileSync(`${process.cwd()}/public/sw.js`, "utf8");
  const context = {
    self,
    URL,
    AbortController,
    caches: { open: cacheOpen, delete: cacheDelete },
    fetch: vi.fn(async () => ({ ok: true, clone: () => ({}) })),
    setTimeout: (callback: () => void) => { callback(); return 1; },
    ...overrides
  };
  runInNewContext(source, context);
  return { handlers, cache, cacheOpen, cacheDelete, context };
}

describe("service worker consent", () => {
  it("does not open Cache Storage for a request from an unapproved client", async () => {
    const worker = createWorkerHarness();
    let response: Promise<unknown> | undefined;
    worker.handlers.get("fetch")?.({ request: { method: "GET", url: "https://index.commoncrawl.org/x" }, clientId: "client-1", respondWith: (value: Promise<unknown>) => { response = value; } });
    await response;
    expect(worker.cacheOpen).not.toHaveBeenCalled();
  });

  it("waits for a pending cache write before deleting data on revoke", async () => {
    let finishWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => { finishWrite = resolve; });
    const worker = createWorkerHarness();
    expect(Array.from(worker.handlers.keys())).toContain("fetch");
    worker.cache.put.mockReturnValue(pendingWrite);
    const message = worker.handlers.get("message");
    message?.({ data: { type: "consent:grant" }, source: { id: "client-1" } });
    expect(runInNewContext('authorizedClients.has("client-1")', worker.context)).toBe(true);
    let response: Promise<unknown> | undefined;
    worker.handlers.get("fetch")?.({ request: { method: "GET", url: "https://index.commoncrawl.org/x" }, clientId: "client-1", respondWith: (value: Promise<unknown>) => { response = value; } });
    expect(response).toBeDefined();
    await vi.waitFor(() => expect(worker.cacheOpen).toHaveBeenCalled());
    await vi.waitFor(() => expect(worker.cache.put).toHaveBeenCalled());
    let cleanup: Promise<unknown> | undefined;
    message?.({ data: { type: "consent:revoke" }, waitUntil: (value: Promise<unknown>) => { cleanup = value; } });
    expect(worker.cacheDelete).not.toHaveBeenCalled();
    finishWrite();
    await response;
    await cleanup;
    expect(worker.cacheDelete).toHaveBeenCalledWith("crawlback-cdx-v1");
  });
});
