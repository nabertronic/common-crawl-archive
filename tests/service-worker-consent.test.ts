import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function createWorkerHarness(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, (event: any) => void>();
  const cache = {
    match: vi.fn<() => Promise<Response | undefined>>(async () => undefined),
    put: vi.fn(async (): Promise<void> => {}),
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => [] as Request[])
  };
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
    Headers,
    Response,
    caches: { open: cacheOpen, delete: cacheDelete },
    fetch: vi.fn(async () => new Response("ok", { status: 200 })),
    setTimeout: (callback: () => void, delay = 0) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timeout: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timeout),
    ...overrides
  };
  runInNewContext(source, context);
  return { handlers, cache, cacheOpen, cacheDelete, context };
}

async function runPrefetch(data: Record<string, unknown>) {
  vi.useFakeTimers();
  try {
    const delays: number[] = [];
    const worker = createWorkerHarness({
      setTimeout: (callback: () => void, delay = 0) => {
        delays.push(delay);
        return globalThis.setTimeout(callback, delay);
      }
    });
    const message = worker.handlers.get("message");
    const source = { id: "client-1", postMessage: vi.fn() };
    message?.({ data: { type: "consent:grant" }, source });
    let work: Promise<unknown> | undefined;
    message?.({
      data: { type: "scan:prefetch", ...data },
      source,
      waitUntil: (value: Promise<unknown>) => { work = value; }
    });
    const pending = work;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await pending;
    const fetched = (worker.context as Record<string, unknown> & { fetch: ReturnType<typeof vi.fn> }).fetch.mock.calls.map((call) => String(call[0]));
    return { delays: delays.filter((delay) => delay !== 12_000), fetched };
  } finally {
    vi.useRealTimers();
  }
}

const restartedHandlers = new Map<string, (event: any) => void>();

describe("service worker consent", () => {
  it("keeps concurrent prefetches isolated by client and cancels only the sender's job", async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    const clientMessages = new Map<string, unknown[]>();
    const worker = createWorkerHarness({
      fetch: vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
        await fetchGate;
        return new Response("ok", { status: 200 });
      })
    });
    const message = worker.handlers.get("message");
    const sources = ["client-a", "client-b"].map((id) => ({ id, postMessage: (value: unknown) => clientMessages.get(id)?.push(value) }));
    for (const source of sources) {
      clientMessages.set(source.id, []);
      message?.({ data: { type: "consent:grant" }, source });
    }
    const jobs: Promise<unknown>[] = [];
    for (const [index, source] of sources.entries()) {
      message?.({
        data: { type: "scan:prefetch", urls: [`https://index.commoncrawl.org/${source.id}`], spacingMs: 1000 },
        source,
        waitUntil: (job: Promise<unknown>) => { jobs[index] = job; }
      });
    }
    await vi.waitFor(() => expect((worker.context as any).fetch).toHaveBeenCalledTimes(2));
    const signals = (worker.context as any).fetch.mock.calls.map((call: any[]) => call[1].signal as AbortSignal);
    message?.({ data: { type: "scan:cancel" }, source: sources[1] });
    expect(signals[0].aborted).toBe(false);
    expect(signals[1].aborted).toBe(true);
    releaseFetch();
    await Promise.all(jobs);
    expect(clientMessages.get("client-a")).toEqual([
      { type: "scan:prefetch-progress", completed: 1, total: 1 },
      { type: "scan:prefetch-done" }
    ]);
    expect(clientMessages.get("client-b")).toEqual([]);
  });

  it("stops an obsolete same-client prefetch after replacement", async () => {
    let releaseFirstFetch!: () => void;
    const firstFetch = new Promise<void>((resolve) => { releaseFirstFetch = resolve; });
    const clientMessages: unknown[] = [];
    const worker = createWorkerHarness({
      fetch: vi.fn(async (url: string) => {
        if (url.endsWith("old")) await firstFetch;
        return new Response("ok", { status: 200 });
      })
    });
    const message = worker.handlers.get("message");
    const source = { id: "client-a", postMessage: (value: unknown) => clientMessages.push(value) };
    message?.({ data: { type: "consent:grant" }, source });
    const jobs: Promise<unknown>[] = [];
    const start = (urls: string[], index: number) => message?.({
      data: { type: "scan:prefetch", urls, spacingMs: 1000 }, source,
      waitUntil: (job: Promise<unknown>) => { jobs[index] = job; }
    });
    start(["https://index.commoncrawl.org/old", "https://index.commoncrawl.org/old-next"], 0);
    await vi.waitFor(() => expect((worker.context as any).fetch).toHaveBeenCalledTimes(1));
    start(["https://index.commoncrawl.org/new"], 1);
    await vi.waitFor(() => expect((worker.context as any).fetch).toHaveBeenCalledTimes(2));
    releaseFirstFetch();
    await Promise.all(jobs);
    const fetched = (worker.context as any).fetch.mock.calls.map((call: any[]) => String(call[0]));
    expect(fetched).toEqual(["https://index.commoncrawl.org/old", "https://index.commoncrawl.org/new"]);
    expect(clientMessages).toEqual([
      { type: "scan:prefetch-progress", completed: 1, total: 1 },
      { type: "scan:prefetch-done" }
    ]);
  });

  it("does not open Cache Storage for a request from an unapproved client", async () => {
    const worker = createWorkerHarness();
    let response: Promise<unknown> | undefined;
    worker.handlers.get("fetch")?.({ request: { method: "GET", url: "https://index.commoncrawl.org/x" }, clientId: "client-1", respondWith: (value: Promise<unknown>) => { response = value; } });
    await response;
    expect(worker.cacheOpen).not.toHaveBeenCalled();
  });

  it("uses the network when Cache Storage fails", async () => {
    const worker = createWorkerHarness();
    worker.cacheOpen.mockRejectedValue(new Error("quota unavailable"));
    worker.handlers.get("message")?.({ data: { type: "consent:grant" }, source: { id: "client-1" } });
    let response: Promise<unknown> | undefined;
    worker.handlers.get("fetch")?.({ request: { method: "GET", url: "https://index.commoncrawl.org/x" }, clientId: "client-1", respondWith: (value: Promise<unknown>) => { response = value; } });
    await expect(response).resolves.toBeInstanceOf(Response);
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

  it("removes the old unbounded cache during service worker activation", async () => {
    const worker = createWorkerHarness();
    let activation: Promise<unknown> | undefined;
    worker.handlers.get("activate")?.({ waitUntil: (value: Promise<unknown>) => { activation = value; } });
    await activation;
    expect(worker.cacheDelete).toHaveBeenCalledWith("crawlback-cdx-v1");
  });

  it("expires cached CDX responses after seven days", async () => {
    const worker = createWorkerHarness();
    const stale = new Response("old", { headers: { "X-Crawlback-Cached-At": String(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1) } });
    worker.cache.match.mockResolvedValue(stale);
    const message = worker.handlers.get("message");
    message?.({ data: { type: "consent:grant" }, source: { id: "client-1" } });
    let response: Promise<unknown> | undefined;
    worker.handlers.get("fetch")?.({ request: { method: "GET", url: "https://index.commoncrawl.org/x" }, clientId: "client-1", respondWith: (value: Promise<unknown>) => { response = value; } });
    await response;
    expect(worker.cache.delete).toHaveBeenCalledWith({ method: "GET", url: "https://index.commoncrawl.org/x" });
  });

  it("caps both retained entry count and total cached bytes", async () => {
    const worker = createWorkerHarness();
    const now = Date.now();
    const tooMany = Array.from({ length: 1001 }, (_, index) => new Request(`https://index.commoncrawl.org/${index}`));
    worker.cache.keys.mockResolvedValue(tooMany);
    worker.cache.match.mockImplementation(async () => new Response(null, {
      headers: { "X-Crawlback-Cached-At": String(now), "X-Crawlback-Cache-Bytes": "1" }
    }));
    (worker.context as Record<string, unknown>).cache = worker.cache;
    await runInNewContext("pruneCache(cache)", worker.context);
    expect(worker.cache.delete).toHaveBeenCalledTimes(1);

    worker.cache.delete.mockClear();
    const tooLarge = Array.from({ length: 26 }, (_, index) => new Request(`https://index.commoncrawl.org/large-${index}`));
    worker.cache.keys.mockResolvedValue(tooLarge);
    worker.cache.match.mockImplementation(async () => new Response(null, {
      headers: { "X-Crawlback-Cached-At": String(now), "X-Crawlback-Cache-Bytes": String(2 * 1024 * 1024) }
    }));
    await runInNewContext("pruneCache(cache)", worker.context);
    expect(worker.cache.delete).toHaveBeenCalledTimes(1);
  });

  it("abandons stalled cache buffering after its fixed timeout", async () => {
    const worker = createWorkerHarness();
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }));
    const context = worker.context as Record<string, unknown>;
    context.response = response;
    context.setTimeout = (callback: () => void) => { callback(); return 1; };
    context.clearTimeout = () => {};
    const result = await runInNewContext("readCachePayload(response)", worker.context);
    expect(result).toBeNull();
    expect(cancelled).toBe(true);
  });
  it("only prefetches https index.commoncrawl.org URLs from page messages", async () => {
    const { fetched } = await runPrefetch({
      urls: [
        "https://index.commoncrawl.org/ok",
        "http://index.commoncrawl.org/plain-http",
        "https://evil.test/x",
        "https://index.commoncrawl.org.evil.test/x",
        "javascript:alert(1)",
        42,
        "not a url"
      ],
      spacingMs: 1000
    });
    expect(fetched).toEqual(["https://index.commoncrawl.org/ok"]);
  });

  it("caps the prefetch list at 500 URLs", async () => {
    const urls = Array.from({ length: 600 }, (_, index) => `https://index.commoncrawl.org/${index}`);
    const { fetched } = await runPrefetch({ urls, spacingMs: 1000 });
    expect(fetched).toHaveLength(500);
  });

  it.each([
    [1, 1000],
    [999_999, 60_000],
    [undefined, 1100],
    [0, 1100],
    [5_000, 5_000]
  ])("clamps prefetch spacing %s to %s ms", async (spacingMs, expected) => {
    const { delays } = await runPrefetch({
      urls: ["https://index.commoncrawl.org/a", "https://index.commoncrawl.org/b"],
      spacingMs
    });
    expect(delays).toEqual([expected]);
  });

  it("restores approved clients after the browser restarts an idle worker", async () => {
    const stored = new Map<string, Response>();
    const stateCache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async (url: string, response: Response) => { stored.set(url, response); }),
      delete: vi.fn(async () => true),
      keys: vi.fn(async () => [] as Request[])
    };
    const caches = {
      open: vi.fn(async () => stateCache),
      delete: vi.fn(async () => true),
      match: vi.fn(async (url: string) => stored.get(url)?.clone())
    };
    const first = createWorkerHarness({ caches });
    let persisted: Promise<unknown> | undefined;
    first.handlers.get("message")?.({ data: { type: "consent:grant" }, source: { id: "client-1" }, waitUntil: (value: Promise<unknown>) => { persisted = value; } });
    await persisted;

    // A restarted worker starts with empty globals but the same Cache Storage.
    const restarted = createWorkerHarness({ caches, self: {
      addEventListener: function (this: any, name: string, handler: (event: any) => void) { restartedHandlers.set(name, handler); },
      skipWaiting: vi.fn(), clients: { claim: vi.fn(), matchAll: vi.fn(async () => [{ id: "client-1" }]) }
    } });
    expect(runInNewContext('authorizedClients.has("client-1")', restarted.context)).toBe(false);
    let job: Promise<unknown> | undefined;
    restartedHandlers.get("message")?.({
      data: { type: "scan:prefetch", urls: ["https://index.commoncrawl.org/warm"], spacingMs: 1000 },
      source: { id: "client-1", postMessage: vi.fn() },
      waitUntil: (value: Promise<unknown>) => { job = value; }
    });
    await job;
    expect(runInNewContext('authorizedClients.has("client-1")', restarted.context)).toBe(true);
    expect((restarted.context as any).fetch).toHaveBeenCalledWith("https://index.commoncrawl.org/warm", expect.anything());
  });

  it("stops background warming on a rate-limit response", async () => {
    vi.useFakeTimers();
    try {
      const worker = createWorkerHarness({ fetch: vi.fn(async () => new Response("slow down", { status: 429 })) });
      const message = worker.handlers.get("message");
      const source = { id: "client-1", postMessage: vi.fn() };
      message?.({ data: { type: "consent:grant" }, source });
      let job: Promise<unknown> | undefined;
      message?.({
        data: { type: "scan:prefetch", urls: ["https://index.commoncrawl.org/a", "https://index.commoncrawl.org/b"], spacingMs: 1000 },
        source,
        waitUntil: (value: Promise<unknown>) => { job = value; }
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await job;
      expect((worker.context as any).fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
