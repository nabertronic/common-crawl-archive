import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commonCrawlMocks = vi.hoisted(() => ({
  push: vi.fn(),
  collections: [] as Array<{
    id: string;
    name: string;
    cdxApi: string;
    from: string;
    to: string;
  }>
}));

const settingsMocks = vi.hoisted(() => ({
  settings: {
    id: "active",
    activeUserId: "local",
    htmlCacheEnabled: true,
    htmlCacheLimitBytes: 50 * 1024 * 1024,
    autoPruneEnabled: true,
    showHtmlPrivacyWarning: true,
    robotsTxtChecksEnabled: true,
    defaultMatchType: "exact",
    defaultScanScope: "recent",
    defaultViewMode: "list",
    defaultSort: "timestamp-desc",
    searchPageSize: 50,
    historyPageSize: 25,
    defaultExportColumns: ["url", "timestamp"],
    largeCaptureLimitBytes: 10 * 1024 * 1024,
    updatedAt: 1
  }
}));

vi.mock("@/lib/capture-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/capture-store")>("@/lib/capture-store");

  return {
    ...actual,
    ensureTarget: vi.fn(async (url: string, matchType, mock: boolean) => ({
      targetId: `target:${url}:${matchType}:${mock ? "mock" : "live"}`,
      url,
      matchType,
      mock,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })),
    ensureScanSession: vi.fn(async (options: {
      scanId?: string;
      url: string;
      matchType: string;
      mock: boolean;
      scope: "recent" | "all" | "custom";
      dateFrom?: string;
      dateTo?: string;
      year?: string;
      collection?: string;
      mime?: string;
      status?: string;
      filter?: string;
      sort?: string;
      view?: string;
      page?: number;
      collectionIds?: string[];
      collectionListFetchedAt?: number;
      scanWindowFrom?: string;
      scanWindowTo?: string;
    }) => ({
      scanId: options.scanId ?? "scan_test",
      targetId: `target:${options.url}:${options.matchType}:${options.mock ? "mock" : "live"}`,
      url: options.url,
      matchType: options.matchType,
      mock: options.mock,
      scope: options.scope,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      year: options.year,
      collection: options.collection,
      mime: options.mime,
      status: options.status,
      filter: options.filter,
      sort: options.sort,
      view: options.view,
      page: options.page,
      collectionIds: options.collectionIds,
      collectionListFetchedAt: options.collectionListFetchedAt,
      scanWindowFrom: options.scanWindowFrom,
      scanWindowTo: options.scanWindowTo,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })),
    findOrCreateLegacySession: vi.fn(async (url: string, matchType, mock: boolean, scope: "recent" | "all" | "custom") => ({
      scanId: "scan_legacy",
      targetId: `target:${url}:${matchType}:${mock ? "mock" : "live"}`,
      url,
      matchType,
      mock,
      scope,
      collectionIds: ["CC-MAIN-2026-21"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-05-21T22:06:58",
      createdAt: 1,
      updatedAt: 1
    })),
    getSettings: vi.fn(async () => settingsMocks.settings),
    getScanSession: vi.fn(async () => undefined),
    getCoverage: vi.fn(async () => undefined),
    startCoverageRun: vi.fn(async () => {}),
    addCoverageDuration: vi.fn(async () => {}),
    appendCoverageScanLogEntry: vi.fn(async () => {}),
    upsertCoverageResult: vi.fn(async (_target, result) => ({
      targetId: _target.targetId,
      url: _target.url,
      matchType: _target.matchType,
      mock: _target.mock,
      collectionResults: { [result.collection.id]: result },
      updatedAt: Date.now()
    })),
    putSearch: vi.fn(async () => {}),
    deleteSearches: vi.fn(async () => {})
  };
});

vi.mock("@/lib/common-crawl", async () => {
  const actual = await vi.importActual<typeof import("@/lib/common-crawl")>("@/lib/common-crawl");

  return {
    ...actual,
    fetchCollections: vi.fn(async () => commonCrawlMocks.collections),
    queryCollection: vi.fn(async (targetUrl: string, collection: { id: string; name: string; cdxApi: string; from: string; to: string }) => ({
      collection,
      status: "checked",
      captures: [],
      checkedAt: Date.now(),
      attempts: 1,
      runs: 1,
      attemptLogs: [
        {
          status: "checked",
          checkedAt: Date.now(),
          captureCount: 0
        }
      ]
    })),
    resetCommonCrawlRateLimitState: vi.fn()
  };
});

import { ArchiveSearchApp, mergePersistedScanLog, persistedSearchDurationMs, restoredCoverageDurationMs } from "@/components/archive-search-app";
import { ensureScanSession, findOrCreateLegacySession, getCoverage, getScanSession, putSearch, startCoverageRun, upsertCoverageResult } from "@/lib/capture-store";
import { fetchCollections, queryCollection, resetCommonCrawlRateLimitState } from "@/lib/common-crawl";
import { robotsCacheKey } from "@/lib/robots-cache";
import { declineStorageConsent, revokeStorageConsent, resetStorageConsentSession, grantStorageConsent, hasStorageConsent, STORAGE_CONSENT_STORAGE_KEY } from "@/lib/website-preferences";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({
    push: commonCrawlMocks.push,
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

import { StorageConsentGate } from "@/components/storage-consent-gate";
import { WebsitePreferences } from "@/components/website-preferences";

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}

function dispatchPageShow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function blockedRobotsApprovalStorageKey(targetId: string) {
  return `crawlback:blocked-robots-approved:${targetId}`;
}

describe("ArchiveSearchApp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    settingsMocks.settings = {
      id: "active",
      activeUserId: "local",
      htmlCacheEnabled: true,
      htmlCacheLimitBytes: 50 * 1024 * 1024,
      autoPruneEnabled: true,
      showHtmlPrivacyWarning: true,
      robotsTxtChecksEnabled: true,
      defaultMatchType: "exact",
      defaultScanScope: "recent",
      defaultViewMode: "list",
      defaultSort: "timestamp-desc",
      searchPageSize: 50,
      historyPageSize: 25,
      defaultExportColumns: ["url", "timestamp"],
      largeCaptureLimitBytes: 10 * 1024 * 1024,
      updatedAt: 1
    };
    const storage = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      clear: vi.fn(() => {
        storage.clear();
      })
    };
    vi.stubGlobal("localStorage", localStorageMock);
    Object.defineProperty(window, "localStorage", { configurable: true, value: localStorageMock });
    grantStorageConsent();
    commonCrawlMocks.collections = [
      {
        id: "CC-MAIN-2026-21",
        name: "May 2026 Index",
        cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
        from: "2026-05-08T07:40:46",
        to: "2026-05-21T22:06:58"
      },
      {
        id: "CC-MAIN-2026-26",
        name: "June 2026 Index",
        cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-26-index",
        from: "2026-06-20T00:00:00",
        to: "2026-06-30T00:00:00"
      }
    ];
    window.history.pushState({}, "", "/");
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
      window.cancelAnimationFrame = (id) => window.clearTimeout(id);
    }
    vi.mocked(getCoverage).mockResolvedValue(undefined);
    vi.mocked(upsertCoverageResult).mockImplementation(async (_target, result) => ({
      targetId: _target.targetId,
      url: _target.url,
      matchType: _target.matchType,
      mock: _target.mock,
      collectionResults: { [result.collection.id]: result },
      updatedAt: Date.now()
    }));
    vi.mocked(queryCollection).mockImplementation(async (_targetUrl, collection) => ({
      collection,
      status: "checked",
      captures: [],
      checkedAt: Date.now(),
      attempts: 1,
      runs: 1,
      attemptLogs: [
        {
          status: "checked",
          checkedAt: Date.now(),
          captureCount: 0
        }
      ]
    }));
  });

  it.each(["undecided", "declined", "granted"])("starts the PastPage full scan with %s storage consent and shows the banner only without a decision", async (decision) => {
    revokeStorageConsent();
    resetStorageConsentSession();
    if (decision === "declined") declineStorageConsent();
    if (decision === "granted") grantStorageConsent();
    commonCrawlMocks.collections[0] = { ...commonCrawlMocks.collections[0], from: "2010-01-01T00:00:00", to: "2010-02-01T00:00:00" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    window.history.replaceState({}, "", "/search?url=https%3A%2F%2Fexample.org%2Farticle%3Fid%3D42&match=exact&scope=all&source=pastpage");
    render(<><StorageConsentGate><ArchiveSearchApp autoStart /></StorageConsentGate><WebsitePreferences /></>);
    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(2));
    expect(queryCollection).toHaveBeenCalledWith(
      "https://example.org/article?id=42", expect.anything(), expect.anything(),
      undefined, undefined, undefined, undefined, "exact", expect.any(Function), expect.any(Function), null, null, undefined
    );
    expect(hasStorageConsent()).toBe(decision === "granted");
    expect(ensureScanSession).not.toHaveBeenCalled();
    if (decision !== "granted") expect(putSearch).not.toHaveBeenCalled();
    if (decision === "undecided") {
      expect(screen.getByRole("complementary", { name: "Allow browser storage?" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("complementary", { name: "Allow browser storage?" })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    if (decision !== "granted") {
      expect((window.localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.every(([key]) => key === STORAGE_CONSENT_STORAGE_KEY)).toBe(true);
    }
  });

  it.each(["allow", "decline", "revoke"])("continues a PastPage scan after storage choice: %s", async (choice) => {
    revokeStorageConsent();
    resetStorageConsentSession();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const pending = deferred<Awaited<ReturnType<typeof queryCollection>>>();
    vi.mocked(queryCollection).mockReturnValueOnce(pending.promise);
    window.history.replaceState({}, "", "/search?url=https%3A%2F%2Fexample.org%2Farticle&match=exact&scope=all&source=pastpage");
    render(<><StorageConsentGate><ArchiveSearchApp autoStart /></StorageConsentGate><WebsitePreferences /></>);
    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(queryCollection).mock.calls[0][2] as AbortSignal;
    if (choice === "allow" || choice === "revoke") {
      fireEvent.click(screen.getByRole("button", { name: "Allow browser storage" }));
      if (choice === "revoke") act(() => revokeStorageConsent());
    } else {
      fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    }
    expect(signal.aborted).toBe(false);
    await act(async () => pending.resolve({
      collection: commonCrawlMocks.collections[0], status: "checked", captures: [], checkedAt: Date.now(), attempts: 1, runs: 1
    }));
    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^pause$/i })).not.toBeInTheDocument());
    expect(signal.aborted).toBe(false);
    expect(fetchCollections).toHaveBeenCalledTimes(2);
  });

  it("still aborts ordinary scans when storage consent is revoked", async () => {
    settingsMocks.settings.robotsTxtChecksEnabled = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const pending = deferred<Awaited<ReturnType<typeof queryCollection>>>();
    vi.mocked(queryCollection).mockReturnValueOnce(pending.promise);
    window.history.replaceState({}, "", "/search?url=example.org&scope=all");
    render(<><StorageConsentGate><ArchiveSearchApp autoStart /></StorageConsentGate><WebsitePreferences /></>);
    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(queryCollection).mock.calls[0][2] as AbortSignal;
    act(() => revokeStorageConsent());
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Start search" })).toBeInTheDocument();
    await act(async () => pending.resolve({
      collection: commonCrawlMocks.collections[0], status: "checked", captures: [], checkedAt: Date.now(), attempts: 1, runs: 1
    }));
    expect(queryCollection).toHaveBeenCalledTimes(1);
  });

  it("guards tab departure while loading collections and removes the guard when paused", async () => {
    settingsMocks.settings.robotsTxtChecksEnabled = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const collections = deferred<Awaited<ReturnType<typeof fetchCollections>>>();
    vi.mocked(fetchCollections).mockReturnValueOnce(collections.promise);
    render(<ArchiveSearchApp autoStart initialParams={{ url: "example.org" }} />);
    await waitFor(() => expect(fetchCollections).toHaveBeenCalled());

    const departure = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);

    await act(async () => collections.resolve([commonCrawlMocks.collections[0]]));
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^pause$/i })).not.toBeInTheDocument());
    const afterCompletion = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterCompletion);
    expect(afterCompletion.defaultPrevented).toBe(false);
  });

  it("confirms same-tab links during a scan and keeps scanning when navigation is cancelled", async () => {
    settingsMocks.settings.robotsTxtChecksEnabled = false;
    vi.mocked(fetchCollections).mockReturnValueOnce(new Promise(() => {}));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = render(<ArchiveSearchApp autoStart initialParams={{ url: "example.org" }} />);
    await waitFor(() => expect(fetchCollections).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    const history = screen.getByRole("link", { name: /history/i });

    fireEvent.click(history);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("the scan will stop"));
    expect(commonCrawlMocks.push).not.toHaveBeenCalled();
    const departure = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(departure);
    expect(departure.defaultPrevented).toBe(true);

    confirm.mockReturnValue(true);
    fireEvent.click(history);
    expect(commonCrawlMocks.push).toHaveBeenCalledWith("/history");

    unmount();
    const afterUnmount = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it("does not bake the active scan segment into durationMs while persisting a running scan", () => {
    const durationMs = persistedSearchDurationMs({
      isRunning: true,
      activeDurationMs: 360_000,
      storedDurationMs: 120_000,
      coverage: {
        targetId: "target_test",
        url: "https://example.com/",
        matchType: "exact",
        mock: false,
        collectionResults: {},
        durationMs: 120_000,
        activeScanStartedAt: 1_000,
        updatedAt: 1_000
      },
      persistedScanLog: [
        { kind: "event", event: "scan-started", checkedAt: 1_000, message: "Scan started." },
        {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 361_000,
          attempts: 1,
          runs: 1
        }
      ]
    });

    expect(durationMs).toBe(120_000);
  });

  it("uses the UI elapsed duration at completion when coverage still has a stale active marker", () => {
    const durationMs = persistedSearchDurationMs({
      isRunning: false,
      activeDurationMs: 360_000,
      storedDurationMs: 0,
      coverage: {
        targetId: "target_test",
        url: "https://example.com/",
        matchType: "exact",
        mock: false,
        collectionResults: {},
        durationMs: 0,
        activeScanStartedAt: 1_000,
        updatedAt: 1_000
      },
      persistedScanLog: [
        { kind: "event", event: "scan-started", checkedAt: 1_000, message: "Scan started." },
        {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 361_000,
          attempts: 1,
          runs: 1
        }
      ]
    });

    expect(durationMs).toBe(360_000);
  });

  it("does not revive a stale active marker as running time when restoring coverage", () => {
    const durationMs = restoredCoverageDurationMs(
      {
        targetId: "target_test",
        url: "https://example.com/",
        matchType: "exact",
        mock: false,
        collectionResults: {},
        durationMs: 120_000,
        activeScanStartedAt: 1_000,
        updatedAt: 1_000
      },
      [
        { kind: "event", event: "scan-started", checkedAt: 1_000, message: "Scan started." },
        {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 181_000,
          attempts: 1,
          runs: 1
        }
      ]
    );

    expect(durationMs).toBe(180_000);
  });

  it("uses scan-log duration when stored coverage duration is smaller", () => {
    const durationMs = restoredCoverageDurationMs(
      {
        targetId: "target_test",
        url: "https://example.com/",
        matchType: "exact",
        mock: false,
        collectionResults: {},
        durationMs: 90_000,
        updatedAt: 1_000
      },
      [
        { kind: "event", event: "scan-started", checkedAt: 1_000, message: "Scan started." },
        {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 121_000,
          attempts: 1,
          runs: 1
        },
        { kind: "event", event: "scan-completed", checkedAt: 125_000, message: "Scan completed." }
      ]
    );

    expect(durationMs).toBe(124_000);
  });

  it("keeps a recent active scan segment after reload", () => {
    const durationMs = restoredCoverageDurationMs(
      {
        targetId: "target_test",
        url: "https://example.com/",
        matchType: "exact",
        mock: false,
        collectionResults: {},
        durationMs: 90_000,
        activeScanStartedAt: 1_000,
        updatedAt: 1_000
      },
      [
        { kind: "event", event: "scan-started", checkedAt: 1_000, message: "Scan started." },
        {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 121_000,
          attempts: 1,
          runs: 1
        }
      ],
      181_000
    );

    expect(durationMs).toBe(270_000);
  });

  it("syncs back-forward restored URL field values before enabling search controls", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { type: "back_forward" } as PerformanceNavigationTiming
    ]);
    render(<ArchiveSearchApp />);

    const input = screen.getByLabelText("URL to search") as HTMLInputElement;
    const startButton = screen.getByRole("button", { name: /start scan/i });

    expect(startButton).toBeDisabled();

    act(() => {
      setNativeInputValue(input, "hutt.io");
      dispatchPageShow(true);
    });

    await waitFor(() => expect(startButton).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /advanced search/i }));

    expect(await screen.findByLabelText("Match type")).toBeInTheDocument();
  });

  it("clears browser-restored URL field values on a fresh home-page open", async () => {
    render(<ArchiveSearchApp />);

    const input = screen.getByLabelText("URL to search") as HTMLInputElement;
    const startButton = screen.getByRole("button", { name: /start scan/i });

    setNativeInputValue(input, "hutt.io");
    dispatchPageShow(false);

    await waitFor(() => expect(input).toHaveValue(""));
    expect(startButton).toBeDisabled();
  });

  it("does not clear active user input during the delayed fresh-home cleanup", async () => {
    render(<ArchiveSearchApp />);

    const input = screen.getByLabelText("URL to search") as HTMLInputElement;
    const startButton = screen.getByRole("button", { name: /start scan/i });

    input.focus();
    fireEvent.change(input, { target: { value: "hutt.io" } });

    await waitFor(() => expect(startButton).toBeEnabled());
    await new Promise((resolve) => window.setTimeout(resolve, 150));

    expect(input).toHaveValue("hutt.io");
    expect(startButton).toBeEnabled();
  });

  it("opens the landing-page menu with history and settings links", () => {
    render(<ArchiveSearchApp />);

    fireEvent.click(screen.getAllByRole("button", { name: /open menu/i })[0]);

    const menu = screen.getByRole("navigation", { name: "App navigation" });
    expect(within(menu).getByRole("link", { name: /history/i })).toHaveAttribute("href", "/history");
    expect(within(menu).getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
    expect(within(menu).queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("responds when search route params change without a full reload", async () => {
    const { rerender } = render(<ArchiveSearchApp initialParams={{ mock: "1", url: "first.example" }} />);

    // After a search starts the editable field is replaced by a read-only chip.
    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://first.example/"));

    rerender(<ArchiveSearchApp initialParams={{ mock: "1", url: "second.example" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://second.example/"));
  });

  it("exits the initial searching state when loading collections fails", async () => {
    vi.mocked(fetchCollections).mockRejectedValueOnce(
      new Error("Could not reach Common Crawl from this network")
    );

    render(<ArchiveSearchApp autoStart initialParams={{ url: "example.org" }} />);

    expect(await screen.findByText("Could not reach Common Crawl from this network")).toBeInTheDocument();
    expect(screen.queryByText("Searching")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("updates result filters when search route params change without a full reload", async () => {
    const { rerender } = render(
      <ArchiveSearchApp
        initialParams={{
          mock: "1",
          url: "example.org",
          filter: "pricing",
          sort: "url-asc",
          view: "calendar",
          page: "2"
        }}
      />
    );

    await waitFor(() => expect(screen.getByLabelText("Filter by URL")).toHaveValue("pricing"));
    expect(screen.getByRole("button", { name: /calendar/i })).toHaveClass("bg-amber-300");

    rerender(
      <ArchiveSearchApp
        initialParams={{
          mock: "1",
          url: "example.org",
          filter: "status",
          sort: "timestamp-desc",
          view: "list",
          page: "1"
        }}
      />
    );

    await waitFor(() => expect(screen.getByLabelText("Filter by URL")).toHaveValue("status"));
    expect(screen.getByRole("button", { name: /^list$/i })).toHaveClass("bg-amber-300");
  });

  it("uses the same menu pattern in the results header", async () => {
    render(<ArchiveSearchApp initialParams={{ mock: "1", url: "example.org" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));

    const menu = screen.getByRole("navigation", { name: "App navigation" });
    expect(within(menu).getByRole("link", { name: /history/i })).toHaveAttribute("href", "/history");
    expect(within(menu).getByRole("link", { name: /settings/i })).toHaveAttribute("href", "/settings");
  });

  it("keeps stored collection rows when persisting a reduced visible scan log", () => {
    const [firstCollection, secondCollection] = commonCrawlMocks.collections;
    const scanStarted = {
      kind: "event" as const,
      event: "scan-started" as const,
      checkedAt: 1_000,
      message: "Scan started."
    };
    const firstResult = {
      collection: firstCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 2_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const secondResult = {
      collection: secondCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 3_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const completed = {
      kind: "event" as const,
      event: "scan-completed" as const,
      checkedAt: 4_000,
      message: "Scan completed · 2 checked · 0 failed · 0 captures."
    };

    const mergedLog = mergePersistedScanLog(
      [scanStarted, firstResult, secondResult],
      [scanStarted, completed],
      commonCrawlMocks.collections
    );

    expect(mergedLog).toEqual([scanStarted, firstResult, secondResult, completed]);
  });

  it("shows a separate retry action for failed scan results", async () => {
    render(<ArchiveSearchApp initialParams={{ mock: "1", url: "example.org" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));

    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry failed/i })).toBeInTheDocument();
  });

  it("labels collection log rows with attempt numbers", async () => {
    render(<ArchiveSearchApp initialParams={{ mock: "1", url: "example.org" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));

    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));

    expect(
      await screen.findAllByText((_, node) => node?.textContent?.includes("Attempt 1") ?? false)
    ).not.toHaveLength(0);
  });

  it("keeps the scan log open when retrying a stored scan", async () => {
    render(<ArchiveSearchApp initialParams={{ mock: "1", url: "example.org" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));

    const scanLogToggle = screen.getByRole("button", { name: /scan log/i });
    fireEvent.click(scanLogToggle);
    expect(scanLogToggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: /retry failed/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /scan log/i })).toHaveAttribute("aria-expanded", "true"));
  });

  it("does not inject newly loaded stored scan-log rows when continuing", async () => {
    const [restoredCollection, staleCollection] = commonCrawlMocks.collections;
    const restoredResult = {
      collection: restoredCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 1_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const staleResult = {
      collection: staleCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 2_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_existing",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "all" as const,
      collectionIds: commonCrawlMocks.collections.map((collection) => collection.id),
      collectionListFetchedAt: 1,
      scanWindowFrom: restoredCollection.from,
      scanWindowTo: staleCollection.to,
      createdAt: 1,
      updatedAt: 1
    };
    const restoredCoverage = {
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: { [restoredCollection.id]: restoredResult },
      scanLogResults: [restoredResult],
      updatedAt: 1
    };
    const refreshedCoverage = {
      ...restoredCoverage,
      collectionResults: {
        [restoredCollection.id]: restoredResult,
        [staleCollection.id]: staleResult
      },
      scanLogResults: [restoredResult, staleResult]
    };

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValueOnce(restoredCoverage).mockResolvedValue(refreshedCoverage);

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    const scanLogToggle = screen.getByRole("button", { name: /scan log/i });
    fireEvent.click(scanLogToggle);
    expect(screen.getByText(restoredCollection.id)).toBeInTheDocument();
    expect(screen.queryByText(staleCollection.id)).not.toBeInTheDocument();

    const continueButtons = screen.getAllByRole("button", { name: /continue/i });
    fireEvent.click(continueButtons[continueButtons.length - 1]);

    await waitFor(() => expect(screen.getByText(/scan completed/i)).toBeInTheDocument());
    expect(screen.queryByText(staleCollection.id)).not.toBeInTheDocument();
    expect(queryCollection).not.toHaveBeenCalled();
  });

  it("shows a single stored-progress row when restoring a cached scan", async () => {
    const [restoredCollection, pendingCollection] = commonCrawlMocks.collections;
    const restoredResult = {
      collection: restoredCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 1_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_existing",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "all" as const,
      collectionIds: [restoredCollection.id, pendingCollection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: restoredCollection.from,
      scanWindowTo: pendingCollection.to,
      createdAt: 1,
      updatedAt: 1
    };

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: { [restoredCollection.id]: restoredResult },
      scanLogResults: [restoredResult],
      updatedAt: 1
    });

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));

    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));

    const storedProgressRows = await screen.findAllByText("Loaded stored progress · 1/2 sources · 0 snapshots · 0 failed.");
    expect(storedProgressRows).toHaveLength(1);
  });

  it("labels a pending history restore as loading saved data instead of searching", async () => {
    const coverage = deferred<Awaited<ReturnType<typeof getCoverage>>>();
    vi.mocked(getCoverage).mockReturnValueOnce(coverage.promise);

    render(<ArchiveSearchApp autoStart initialParams={{ history: "1", url: "large.example", scope: "all" }} />);

    await waitFor(() => expect(getCoverage).toHaveBeenCalled());

    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.getByText("Reading saved scan data from local history. Large histories can take a moment.")).toBeInTheDocument();
    expect(screen.queryByText("Searching")).not.toBeInTheDocument();
    expect(screen.queryByText(/No snapshots were found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run full scan/i })).not.toBeInTheDocument();

    await act(async () => {
      coverage.resolve({
        targetId: "target:https://large.example/:exact:live",
        url: "https://large.example/",
        matchType: "exact",
        mock: false,
        collectionResults: {},
        updatedAt: 1
      });
    });

    await waitFor(() => expect(screen.getByText("Scan paused")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /continue/i }).length).toBeGreaterThan(0);
  });

  it("counts only successful stored sources in the stored-progress row", async () => {
    const [restoredCollection, failedCollection] = commonCrawlMocks.collections;
    const restoredResult = {
      collection: restoredCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 1_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const failedResult = {
      collection: failedCollection,
      status: "not-checked" as const,
      captures: [],
      checkedAt: 2_000,
      error: "browser/network request failed before an HTTP response",
      errorKind: "network_no_response" as const,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_existing",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "all" as const,
      collectionIds: [restoredCollection.id, failedCollection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: restoredCollection.from,
      scanWindowTo: failedCollection.to,
      createdAt: 1,
      updatedAt: 1
    };

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: {
        [restoredCollection.id]: restoredResult,
        [failedCollection.id]: failedResult
      },
      scanLogResults: [restoredResult, failedResult],
      updatedAt: 1
    });

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));

    const storedProgressRows = await screen.findAllByText("Loaded stored progress · 1/2 sources · 0 snapshots · 1 failed.");
    expect(storedProgressRows).toHaveLength(1);
  });

  it("offers only Continue while unchecked sources remain and retries failed sources last", async () => {
    const [failedCollection, pendingCollection] = commonCrawlMocks.collections;
    const failedResult = {
      collection: failedCollection,
      status: "not-checked" as const,
      captures: [],
      checkedAt: 1_000,
      error: "browser/network request failed before an HTTP response",
      errorKind: "network_no_response" as const,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_partial",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "all" as const,
      collectionIds: [failedCollection.id, pendingCollection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: failedCollection.from,
      scanWindowTo: pendingCollection.to,
      createdAt: 1,
      updatedAt: 1
    };

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: { [failedCollection.id]: failedResult },
      scanLogResults: [failedResult],
      collectionIds: session.collectionIds,
      collectionListFetchedAt: session.collectionListFetchedAt,
      scanWindowFrom: session.scanWindowFrom,
      scanWindowTo: session.scanWindowTo,
      updatedAt: 1
    });

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    expect(resetCommonCrawlRateLimitState).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /continue/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /retry failed/i })).not.toBeInTheDocument();

    const continueButtons = screen.getAllByRole("button", { name: /continue/i });
    fireEvent.click(continueButtons[continueButtons.length - 1]);

    await waitFor(() => expect(resetCommonCrawlRateLimitState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(2));
    expect(vi.mocked(queryCollection).mock.calls.map((call) => call[1].id)).toEqual([
      pendingCollection.id,
      failedCollection.id
    ]);
  });

  it("retries failed sources immediately after continuing unfinished work", async () => {
    const [failedCollection, pendingCollection] = commonCrawlMocks.collections;
    const failedResult = {
      collection: failedCollection,
      status: "not-checked" as const,
      captures: [],
      checkedAt: 1_000,
      error: "browser/network request failed before an HTTP response",
      errorKind: "network_no_response" as const,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_partial_retry",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "all" as const,
      collectionIds: [failedCollection.id, pendingCollection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: failedCollection.from,
      scanWindowTo: pendingCollection.to,
      createdAt: 1,
      updatedAt: 1
    };
    const collectionResults: Record<string, typeof failedResult | Awaited<ReturnType<typeof queryCollection>>> = {
      [failedCollection.id]: failedResult
    };
    const coverage = () => ({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults,
      scanLogResults: Object.values(collectionResults),
      collectionIds: session.collectionIds,
      collectionListFetchedAt: session.collectionListFetchedAt,
      scanWindowFrom: session.scanWindowFrom,
      scanWindowTo: session.scanWindowTo,
      updatedAt: Date.now()
    });

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockImplementation(async () => coverage());
    vi.mocked(upsertCoverageResult).mockImplementation(async (_target, result) => {
      collectionResults[result.collection.id] = result;
      return coverage();
    });
    vi.mocked(queryCollection).mockImplementation(async (_targetUrl, collection) => {
      if (collection.id === failedCollection.id) {
        return {
          collection,
          status: "not-checked",
          captures: [],
          checkedAt: Date.now(),
          error: "browser/network request failed before an HTTP response",
          errorKind: "network_no_response",
          attempts: 1,
          runs: 1,
          attemptLogs: [
            {
              status: "not-checked",
              checkedAt: Date.now(),
              error: "browser/network request failed before an HTTP response",
              errorKind: "network_no_response"
            }
          ]
        };
      }
      return {
        collection,
        status: "checked",
        captures: [],
        checkedAt: Date.now(),
        httpStatus: 404,
        attempts: 1,
        runs: 1,
        attemptLogs: [
          {
            status: "checked",
            checkedAt: Date.now(),
            httpStatus: 404,
            captureCount: 0
          }
        ]
      };
    });

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    const continueButtons = screen.getAllByRole("button", { name: /continue/i });
    fireEvent.click(continueButtons[continueButtons.length - 1]);

    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(3));
    expect(vi.mocked(queryCollection).mock.calls.map((call) => call[1].id)).toEqual([
      pendingCollection.id,
      failedCollection.id,
      failedCollection.id
    ]);

    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));

    expect(screen.getByText(/Retrying 1 failed source before finishing/i)).toBeInTheDocument();
    expect(screen.getByText(/Scan paused · 1 checked · 1 failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/Scan completed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto retry scheduled/i)).not.toBeInTheDocument();
  });

  it("does not auto-resume a complete stored scan opened from the search route", async () => {
    const [firstCollection, secondCollection] = commonCrawlMocks.collections;
    const firstResult = {
      collection: firstCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 1_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const secondResult = {
      collection: secondCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 2_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_complete",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "all" as const,
      collectionIds: [firstCollection.id, secondCollection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: firstCollection.from,
      scanWindowTo: secondCollection.to,
      createdAt: 1,
      updatedAt: 1
    };

    vi.mocked(findOrCreateLegacySession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: {
        [firstCollection.id]: firstResult,
        [secondCollection.id]: secondResult
      },
      scanLogResults: [firstResult, secondResult],
      collectionIds: session.collectionIds,
      durationMs: 420_000,
      activeScanStartedAt: 1_000,
      updatedAt: 3_000
    });

    render(<ArchiveSearchApp autoStart initialParams={{ url: "example.org", scope: "all" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument());
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(startCoverageRun).not.toHaveBeenCalled();
    expect(queryCollection).not.toHaveBeenCalled();
    expect(screen.queryByText("Searching")).not.toBeInTheDocument();
    expect(screen.queryByText("Scan started.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));
    expect(screen.getByText(firstCollection.id)).toBeInTheDocument();
    expect(screen.getByText(secondCollection.id)).toBeInTheDocument();
  });

  it("does not restart a complete stored scan when reloading a fresh-action scan route", async () => {
    const [firstCollection, secondCollection] = commonCrawlMocks.collections;
    const firstResult = {
      collection: firstCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 1_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const secondResult = {
      collection: secondCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 2_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_complete",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "recent" as const,
      collectionIds: [firstCollection.id, secondCollection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: firstCollection.from,
      scanWindowTo: secondCollection.to,
      createdAt: 1,
      updatedAt: 1
    };

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: {
        [firstCollection.id]: firstResult,
        [secondCollection.id]: secondResult
      },
      scanLogResults: [
        { kind: "event", event: "scan-started", checkedAt: 500, message: "Original scan started." },
        firstResult,
        secondResult
      ],
      collectionIds: session.collectionIds,
      durationMs: 68_000,
      updatedAt: 3_000
    });

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId, action: "fresh" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(startCoverageRun).not.toHaveBeenCalled();
    expect(queryCollection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));
    expect(screen.getByText("Original scan started.")).toBeInTheDocument();
    expect(screen.queryByText("Scan started.")).not.toBeInTheDocument();
    expect(screen.getByText(firstCollection.id)).toBeInTheDocument();
    expect(screen.getByText(secondCollection.id)).toBeInTheDocument();
  });

  it("resumes an incomplete fresh-action scan route without dropping the stored scan log", async () => {
    const [restoredCollection, pendingCollection] = commonCrawlMocks.collections;
    const originalStart = {
      kind: "event" as const,
      event: "scan-started" as const,
      checkedAt: 1_000,
      message: "Original scan started."
    };
    const restoredResult = {
      collection: restoredCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 2_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_incomplete_fresh",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "recent" as const,
      collectionIds: [restoredCollection.id, pendingCollection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: restoredCollection.from,
      scanWindowTo: pendingCollection.to,
      createdAt: 1,
      updatedAt: 1
    };

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: {
        [restoredCollection.id]: restoredResult
      },
      scanLogResults: [originalStart, restoredResult],
      collectionIds: session.collectionIds,
      durationMs: 68_000,
      activeScanStartedAt: 1_000,
      updatedAt: 3_000
    });

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId, action: "fresh" }} />);

    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(1));
    expect(vi.mocked(queryCollection).mock.calls[0][1].id).toBe(pendingCollection.id);

    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));
    expect(screen.getByText("Original scan started.")).toBeInTheDocument();
    expect(screen.getByText(restoredCollection.id)).toBeInTheDocument();
  });

  it("does not duplicate scope or opt-out rows when restoring and continuing a stored full scan", async () => {
    const [restoredCollection, pendingCollection] = commonCrawlMocks.collections;
    const scopeMessage = "Full scan selected: checking the entire archive.";
    const optOutMessage = "Opt-out registry checked: no match.";
    const restoredResult = {
      collection: restoredCollection,
      status: "checked" as const,
      captures: [],
      checkedAt: 1_000,
      httpStatus: 404,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_existing",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "all" as const,
      collectionIds: [restoredCollection.id, pendingCollection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: restoredCollection.from,
      scanWindowTo: pendingCollection.to,
      createdAt: 1,
      updatedAt: 1
    };

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: { [restoredCollection.id]: restoredResult },
      scanLogResults: [
        { kind: "event", event: "opt-out-checked", checkedAt: 1_100, message: optOutMessage, tone: "neutral" as const },
        { kind: "event", event: "scope-selected", checkedAt: 1_200, message: scopeMessage, tone: "amber" as const },
        restoredResult
      ],
      updatedAt: 1
    });

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));
    expect(screen.getAllByText(scopeMessage)).toHaveLength(1);
    expect(screen.getAllByText(optOutMessage)).toHaveLength(1);

    const continueButtons = screen.getAllByRole("button", { name: /continue/i });
    fireEvent.click(continueButtons[continueButtons.length - 1]);

    await waitFor(() => expect(screen.getByText(/scan completed/i)).toBeInTheDocument());
    expect(screen.getAllByText(scopeMessage)).toHaveLength(1);
    expect(screen.getAllByText(optOutMessage)).toHaveLength(1);
  });

  it.each(["url", "session"] as const)("starts a %s scan after Strict Mode replays its startup effect", async (route) => {
    settingsMocks.settings.robotsTxtChecksEnabled = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const session = {
      scanId: "scan_strict",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "all" as const,
      createdAt: 1,
      updatedAt: 1
    };
    vi.mocked(getScanSession).mockResolvedValue(session);
    window.history.pushState({}, "", "/search");

    render(
      <StrictMode>
        <ArchiveSearchApp autoStart initialParams={route === "session"
          ? { scan: session.scanId, action: "fresh" }
          : { url: "example.org" }} />
      </StrictMode>
    );

    await waitFor(() => expect(queryCollection).toHaveBeenCalled());
    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(commonCrawlMocks.collections.length));
    for (const collection of commonCrawlMocks.collections) {
      expect(vi.mocked(queryCollection).mock.calls.filter(([, queried]) => queried.id === collection.id)).toHaveLength(1);
    }
  });

  it("starts a full scan when the search URL has no scope param", async () => {
    vi.mocked(getCoverage).mockResolvedValue(undefined);

    render(<ArchiveSearchApp autoStart initialParams={{ url: "example.org" }} />);

    await waitFor(() => expect(findOrCreateLegacySession).toHaveBeenCalled());
    expect(vi.mocked(findOrCreateLegacySession).mock.calls[0][3]).toBe("all");
  });

  it("shows the scan type and scope under the scanned URL once a scan starts", async () => {
    vi.mocked(getCoverage).mockResolvedValue(undefined);

    render(<ArchiveSearchApp autoStart initialParams={{ url: "example.org", match: "host", scope: "recent" }} />);

    const scannedUrl = await screen.findByLabelText("Scanned URL");
    const description = await screen.findByText("Host, all paths · Last 12 months");
    expect(scannedUrl.parentElement).toContainElement(description);
  });

  it("does not show stored-progress for a clean fresh scan", async () => {
    vi.mocked(getCoverage).mockResolvedValue(undefined);

    render(<ArchiveSearchApp autoStart initialParams={{ url: "example.org", scope: "all" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));

    expect(screen.queryAllByText(/Loaded stored progress/i)).toHaveLength(0);
  });

  it("shows the cached robots block row when reopening a blocked stored scan", async () => {
    vi.mocked(findOrCreateLegacySession).mockResolvedValue({
      scanId: "scan_legacy",
      targetId: "target:https://blocked.example/:exact:live",
      url: "https://blocked.example/",
      matchType: "exact",
      mock: false,
      scope: "all",
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-06-30T00:00:00",
      createdAt: 1,
      updatedAt: 1
    });
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: "target:https://blocked.example/:exact:live",
      ownerId: "owner_test",
      url: "https://blocked.example/",
      matchType: "exact",
      mock: false,
      collectionResults: {
        "CC-MAIN-2026-21": {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 1,
          attempts: 1,
          runs: 1
        }
      },
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-06-30T00:00:00",
      durationMs: 100,
      updatedAt: 1
    });
    localStorage.setItem(robotsCacheKey("https://blocked.example/"), JSON.stringify({
      status: "blocked",
      robotsUrl: "https://blocked.example/robots.txt",
      userAgent: "CCBot",
      matchedRule: { directive: "disallow", path: "/" },
      checkedAt: 2_000
    }));

    render(<ArchiveSearchApp autoStart initialParams={{ url: "blocked.example", scope: "all" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://blocked.example/"));
    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));
    await waitFor(() => expect(screen.getByText("CCBot robots.txt")).toBeInTheDocument());
  });

  it("does not add a second robots continuation row when resuming a blocked stored scan", async () => {
    vi.mocked(findOrCreateLegacySession).mockResolvedValue({
      scanId: "scan_legacy",
      targetId: "target:https://blocked.example/:exact:live",
      url: "https://blocked.example/",
      matchType: "exact",
      mock: false,
      scope: "all",
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-06-30T00:00:00",
      createdAt: 1,
      updatedAt: 1
    });
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: "target:https://blocked.example/:exact:live",
      ownerId: "owner_test",
      url: "https://blocked.example/",
      matchType: "exact",
      mock: false,
      collectionResults: {
        "CC-MAIN-2026-21": {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 1,
          attempts: 1,
          runs: 1
        }
      },
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-06-30T00:00:00",
      durationMs: 100,
      updatedAt: 1
    });
    localStorage.setItem(robotsCacheKey("https://blocked.example/"), JSON.stringify({
      status: "blocked",
      robotsUrl: "https://blocked.example/robots.txt",
      userAgent: "CCBot",
      matchedRule: { directive: "disallow", path: "/" },
      checkedAt: 2_000
    }));

    render(<ArchiveSearchApp autoStart initialParams={{ url: "blocked.example", scope: "all" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://blocked.example/"));
    fireEvent.click(screen.getByRole("button", { name: /scan log/i }));
    expect(screen.queryByText(/continuing stored scan without confirmation/i)).not.toBeInTheDocument();
  });

  it("does not rewrite saved history when opening a stored scan", async () => {
    render(<ArchiveSearchApp autoStart initialParams={{ mock: "1", history: "1", url: "example.org" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));

    await new Promise((resolve) => window.setTimeout(resolve, 350));

    expect(putSearch).not.toHaveBeenCalled();
  });

  it("starts a missing-collections history action without asking for blocked robots confirmation", async () => {
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: "target:https://blocked.example/:exact:live",
      ownerId: "owner_test",
      url: "https://blocked.example/",
      matchType: "exact",
      mock: false,
      collectionResults: {
        "CC-MAIN-2026-21": {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 1,
          attempts: 1,
          runs: 1
        }
      },
      collectionIds: ["CC-MAIN-2026-21"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-05-21T22:06:58",
      durationMs: 100,
      updatedAt: 1
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "https://blocked.example/robots.txt") {
          return new Response("User-agent: CCBot\nDisallow: /", { status: 200 });
        }
        return new Response("", { status: 404 });
      })
    );

    render(<ArchiveSearchApp autoStart initialParams={{ url: "blocked.example", scope: "all", history: "1", action: "missing" }} />);

    expect(screen.queryByRole("button", { name: /start scan anyway/i })).not.toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: /continue/i })).length).toBeGreaterThan(0);
  });

  it("auto-resumes a stored blocked scan from the search page without asking again", async () => {
    vi.mocked(findOrCreateLegacySession).mockResolvedValue({
      scanId: "scan_legacy",
      targetId: "target:https://blocked.example/:exact:live",
      url: "https://blocked.example/",
      matchType: "exact",
      mock: false,
      scope: "all",
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-06-30T00:00:00",
      createdAt: 1,
      updatedAt: 1
    });
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: "target:https://blocked.example/:exact:live",
      ownerId: "owner_test",
      url: "https://blocked.example/",
      matchType: "exact",
      mock: false,
      collectionResults: {
        "CC-MAIN-2026-21": {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 1,
          attempts: 1,
          runs: 1
        }
      },
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-06-30T00:00:00",
      durationMs: 100,
      updatedAt: 1
    });
    localStorage.setItem(robotsCacheKey("https://blocked.example/"), JSON.stringify({
      status: "blocked",
      robotsUrl: "https://blocked.example/robots.txt",
      userAgent: "CCBot",
      matchedRule: { directive: "disallow", path: "/" },
      checkedAt: 2_000
    }));

    render(<ArchiveSearchApp autoStart initialParams={{ url: "blocked.example", scope: "all" }} />);

    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(1));
    expect(vi.mocked(queryCollection).mock.calls[0][1].id).toBe("CC-MAIN-2026-26");
    expect(screen.queryByRole("button", { name: /start scan anyway/i })).not.toBeInTheDocument();
  });

  it("reuses a previously approved blocked target without asking again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/robots") {
          return Response.json({
            status: "blocked",
            robotsUrl: "https://blocked.example/robots.txt",
            userAgent: "CCBot",
            matchedRule: { directive: "disallow", path: "/" },
            checkedAt: 2_000
          });
        }
        return new Response("", { status: 404 });
      })
    );
    localStorage.setItem(
      blockedRobotsApprovalStorageKey("target:https://blocked.example/:exact:live"),
      "1"
    );

    // `autoStart` only renders on the /search route; a fresh scan started from
    // any other path navigates there first and returns (see runSearch). Start on
    // /search so the scan runs instead of early-returning against the stub router.
    window.history.pushState({}, "", "/search?url=blocked.example");
    render(<ArchiveSearchApp autoStart initialParams={{ url: "blocked.example", scope: "all" }} />);

    await waitFor(() => expect(queryCollection).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /start scan anyway/i })).not.toBeInTheDocument();
  });

  it("does not contact the target robots.txt endpoint when robots checks are disabled", async () => {
    settingsMocks.settings = {
      ...settingsMocks.settings,
      robotsTxtChecksEnabled: false
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/robots") throw new Error("robots endpoint should not be called");
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // See the note above: a fresh autostart only completes on the /search route.
    window.history.pushState({}, "", "/search?url=blocked.example");
    render(<ArchiveSearchApp autoStart initialParams={{ url: "blocked.example", scope: "all" }} />);

    await waitFor(() => expect(queryCollection).toHaveBeenCalled());
    // The scan still runs (and may hit other endpoints like the opt-out
    // registry), but the target's robots.txt must never be contacted.
    const robotsCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url === "/api/robots";
    });
    expect(robotsCalls).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /start scan anyway/i })).not.toBeInTheDocument();
  });

  it("clears the URL when navigating from a search flow back to the home screen", async () => {
    const { unmount } = render(<ArchiveSearchApp initialParams={{ mock: "1", url: "hutt.io" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://hutt.io/"));

    // `/` and `/search` are separate route files, so real navigation remounts
    // the component — a fresh mount with no params lands on the idle home screen.
    unmount();
    render(<ArchiveSearchApp />);

    await waitFor(() => expect(screen.getByLabelText("URL to search")).toHaveValue(""));
    expect(screen.getByRole("button", { name: /start scan/i })).toBeDisabled();
  });

  it("requires both custom range dates before enabling a fresh scan", async () => {
    render(<ArchiveSearchApp />);

    fireEvent.change(screen.getByLabelText("URL to search"), { target: { value: "hutt.io" } });
    fireEvent.click(screen.getByRole("button", { name: /advanced search/i }));
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "custom" } });

    const startButton = screen.getByRole("button", { name: /start scan/i });
    expect(startButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2020-01-01" } });
    expect(startButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2020-12-31" } });
    await waitFor(() => expect(startButton).toBeEnabled());
  });

  it("normalizes bare URLs before starting a scan", async () => {
    render(<ArchiveSearchApp initialParams={{ mock: "1", url: "example.com/path" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.com/path"));
  });

  it("rejects non-http URL schemes before scanning", async () => {
    render(<ArchiveSearchApp />);

    fireEvent.change(screen.getByLabelText("URL to search"), { target: { value: "ftp://example.com/archive" } });
    fireEvent.click(screen.getByRole("button", { name: /start scan/i }));

    await waitFor(() => {
      expect(screen.getByText("Only http and https URLs can be scanned.")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Scanned URL")).not.toBeInTheDocument();
    expect(queryCollection).not.toHaveBeenCalled();
  });

  it("shows a real empty result state when a scan finds no snapshots", async () => {
    render(
      <ArchiveSearchApp
        initialParams={{
          mock: "1",
          url: "example.org",
          from: "2030-01-01",
          to: "2030-12-31"
        }}
      />
    );

    await waitFor(() => expect(screen.getAllByText("No snapshots found").length).toBeGreaterThan(0));
    expect(screen.queryByText(/No HTML snapshots were found/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run full scan across entire archive/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /start another search/i })).not.toBeInTheDocument();
  });

  it("starts a full scan from the empty state after a custom or recent scan finds nothing", async () => {
    render(
      <ArchiveSearchApp
        initialParams={{
          mock: "1",
          url: "example.org",
          from: "2030-01-01",
          to: "2030-12-31"
        }}
      />
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /run full scan across entire archive/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /run full scan across entire archive/i }));

    await waitFor(() =>
      expect(vi.mocked(ensureScanSession)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scanId: "scan_test",
          scope: "all",
          dateFrom: undefined,
          dateTo: undefined
        })
      )
    );
  });

  it("offers a full scan after a recent scan completes with snapshots", async () => {
    const [collection] = commonCrawlMocks.collections;
    const capture = {
      collectionId: collection.id,
      collectionName: collection.name,
      collectionFrom: collection.from,
      collectionTo: collection.to,
      timestamp: "20260510000000",
      url: "https://example.org/",
      status: "200",
      mime: "text/html",
      filename: "crawl-data/example.warc.gz",
      offset: "0",
      length: "123"
    };
    const result = {
      collection,
      status: "checked" as const,
      captures: [capture],
      checkedAt: 1_000,
      httpStatus: 200,
      attempts: 1,
      runs: 1
    };
    const session = {
      scanId: "scan_recent_complete",
      targetId: "target:https://example.org/:exact:live",
      url: "https://example.org/",
      matchType: "exact" as const,
      mock: false,
      scope: "recent" as const,
      collectionIds: [collection.id],
      collectionListFetchedAt: 1,
      scanWindowFrom: collection.from,
      scanWindowTo: collection.to,
      createdAt: 1,
      updatedAt: 1
    };

    vi.mocked(getScanSession).mockResolvedValue(session);
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: session.targetId,
      url: session.url,
      matchType: session.matchType,
      mock: session.mock,
      collectionResults: { [collection.id]: result },
      scanLogResults: [result],
      collectionIds: session.collectionIds,
      collectionListFetchedAt: session.collectionListFetchedAt,
      scanWindowFrom: session.scanWindowFrom,
      scanWindowTo: session.scanWindowTo,
      updatedAt: 1
    });

    render(<ArchiveSearchApp autoStart initialParams={{ scan: session.scanId }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    expect(screen.getByRole("button", { name: /run full scan/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /run full scan/i }));

    await waitFor(() =>
      expect(vi.mocked(ensureScanSession)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scanId: "scan_recent_complete",
          scope: "all",
          dateFrom: undefined,
          dateTo: undefined
        })
      )
    );
  });

  it("does not offer the full-scan CTA when the active scope is already full scan", async () => {
    render(
      <ArchiveSearchApp
        autoStart
        initialParams={{
          url: "example.org",
          scope: "all"
        }}
      />
    );

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://example.org/"));
    expect(screen.queryByRole("button", { name: /run full scan across entire archive/i })).not.toBeInTheDocument();
  });

  // These live-scan tests use the stored-coverage resume path (a non-empty
  // collectionResults triggers hasStoredCoverageHistory), so the robots status
  // is read from the seeded cache and no network robots check is needed.
  it("re-queries a collection whose stored result only covers a narrower window during a full scan", async () => {
    vi.mocked(findOrCreateLegacySession).mockResolvedValue({
      scanId: "scan_legacy",
      targetId: "target:https://windowed.example/:exact:live",
      url: "https://windowed.example/",
      matchType: "exact",
      mock: false,
      scope: "all",
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-06-30T00:00:00",
      createdAt: 1,
      updatedAt: 1
    });
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: "target:https://windowed.example/:exact:live",
      ownerId: "owner_test",
      url: "https://windowed.example/",
      matchType: "exact",
      mock: false,
      collectionResults: {
        // Stored result only covers a narrow window, so a full-archive scan must
        // not treat this collection as already covered and must re-query it.
        "CC-MAIN-2026-21": {
          collection: commonCrawlMocks.collections[0],
          status: "checked",
          captures: [],
          checkedAt: 1,
          attempts: 1,
          runs: 1,
          window: { from: "2026-05-08", to: "2026-05-10" }
        }
      },
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      scanWindowFrom: "2026-05-08T07:40:46",
      scanWindowTo: "2026-06-30T00:00:00",
      durationMs: 100,
      updatedAt: 1
    });
    localStorage.setItem(robotsCacheKey("https://windowed.example/"), JSON.stringify({
      status: "allowed",
      robotsUrl: "https://windowed.example/robots.txt",
      userAgent: "CCBot",
      checkedAt: Date.now()
    }));

    render(<ArchiveSearchApp autoStart initialParams={{ url: "windowed.example", scope: "all" }} />);

    await waitFor(() => expect(queryCollection).toHaveBeenCalledTimes(2));
    const queriedIds = vi.mocked(queryCollection).mock.calls.map((call) => call[1].id);
    expect(queriedIds).toContain("CC-MAIN-2026-21");
    expect(queriedIds).toContain("CC-MAIN-2026-26");
    // A full-archive scan is not date-constrained: no window reaches the API.
    for (const call of vi.mocked(queryCollection).mock.calls) {
      expect(call[10]).toBeNull();
      expect(call[11]).toBeNull();
      expect(call[12]).toBeUndefined();
    }
  });

  it("passes the custom date window to queryCollection so Common Crawl filters server-side", async () => {
    vi.mocked(findOrCreateLegacySession).mockResolvedValue({
      scanId: "scan_legacy",
      targetId: "target:https://custom.example/:exact:live",
      url: "https://custom.example/",
      matchType: "exact",
      mock: false,
      scope: "custom",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      createdAt: 1,
      updatedAt: 1
    });
    vi.mocked(getCoverage).mockResolvedValue({
      targetId: "target:https://custom.example/:exact:live",
      ownerId: "owner_test",
      url: "https://custom.example/",
      matchType: "exact",
      mock: false,
      // June collection is outside the May window (so it is inactive); it only
      // exists here to make this a stored-coverage resume. The in-window May
      // collection is uncovered and must be queried with the date window.
      collectionResults: {
        "CC-MAIN-2026-26": {
          collection: commonCrawlMocks.collections[1],
          status: "checked",
          captures: [],
          checkedAt: 1,
          attempts: 1,
          runs: 1
        }
      },
      collectionIds: ["CC-MAIN-2026-21", "CC-MAIN-2026-26"],
      collectionListFetchedAt: 1,
      updatedAt: 1
    });
    localStorage.setItem(robotsCacheKey("https://custom.example/"), JSON.stringify({
      status: "allowed",
      robotsUrl: "https://custom.example/robots.txt",
      userAgent: "CCBot",
      checkedAt: Date.now()
    }));

    render(
      <ArchiveSearchApp
        autoStart
        initialParams={{ url: "custom.example", scope: "custom", from: "2026-05-01", to: "2026-05-31" }}
      />
    );

    await waitFor(() => expect(queryCollection).toHaveBeenCalled());
    const calls = vi.mocked(queryCollection).mock.calls;
    expect(calls.map((call) => call[1].id)).toContain("CC-MAIN-2026-21");
    for (const call of calls) {
      expect(call[10]).toBeNull();
      expect(call[11]).toBeNull();
      expect(call[12]).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    }
  });
});
