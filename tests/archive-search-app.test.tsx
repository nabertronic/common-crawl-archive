import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commonCrawlMocks = vi.hoisted(() => ({
  collections: [] as Array<{
    id: string;
    name: string;
    cdxApi: string;
    from: string;
    to: string;
  }>
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
    }))
  };
});

import { ArchiveSearchApp } from "@/components/archive-search-app";
import { ensureScanSession, findOrCreateLegacySession, getCoverage, getScanSession, putSearch } from "@/lib/capture-store";
import { queryCollection } from "@/lib/common-crawl";
import { robotsCacheKey } from "@/lib/robots-cache";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}

function dispatchPageShow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
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
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
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
    });
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
  });

  it("syncs back-forward restored URL field values before enabling search controls", async () => {
    render(<ArchiveSearchApp />);

    const input = screen.getByLabelText("URL to search") as HTMLInputElement;
    const startButton = screen.getByRole("button", { name: /start scan/i });

    expect(startButton).toBeDisabled();

    setNativeInputValue(input, "hutt.io");
    dispatchPageShow(true);

    await waitFor(() => expect(startButton).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /advanced search/i }));

    expect(screen.getByLabelText("Match type")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));

    expect(screen.getByRole("menuitem", { name: /history/i })).toHaveAttribute("href", "/history");
    expect(screen.getByRole("menuitem", { name: /settings/i })).toHaveAttribute("href", "/settings");
  });

  it("responds when search route params change without a full reload", async () => {
    const { rerender } = render(<ArchiveSearchApp initialParams={{ mock: "1", url: "first.example" }} />);

    // After a search starts the editable field is replaced by a read-only chip.
    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://first.example/"));

    rerender(<ArchiveSearchApp initialParams={{ mock: "1", url: "second.example" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("https://second.example/"));
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

    expect(screen.getByRole("menuitem", { name: /history/i })).toHaveAttribute("href", "/history");
    expect(screen.getByRole("menuitem", { name: /settings/i })).toHaveAttribute("href", "/settings");
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
        if (url.includes("/api/robots?")) {
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

    render(<ArchiveSearchApp autoStart initialParams={{ url: "blocked.example", scope: "all" }} />);

    await waitFor(() => expect(queryCollection).toHaveBeenCalled());
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

    expect(await screen.findByText("Only http and https URLs can be scanned.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scanned URL")).not.toBeInTheDocument();
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
      expect(call[12]).toEqual({ from: "2026-05-01", to: "2026-05-31" });
    }
  });

  it("logs a truncation notice when a collection has more captures than the limit", async () => {
    vi.mocked(queryCollection).mockImplementation(async (_targetUrl, collection) => ({
      collection,
      status: "checked",
      captures: [],
      checkedAt: Date.now(),
      attempts: 1,
      runs: 1,
      truncated: true,
      attemptLogs: [{ status: "checked", checkedAt: Date.now(), captureCount: 0 }]
    }));
    vi.mocked(findOrCreateLegacySession).mockResolvedValue({
      scanId: "scan_legacy",
      targetId: "target:https://truncated.example/:exact:live",
      url: "https://truncated.example/",
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
      targetId: "target:https://truncated.example/:exact:live",
      ownerId: "owner_test",
      url: "https://truncated.example/",
      matchType: "exact",
      mock: false,
      // CC-MAIN-2026-21 is already fully covered so it is skipped; the remaining
      // collection is queried and comes back truncated.
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
      updatedAt: 1
    });
    localStorage.setItem(robotsCacheKey("https://truncated.example/"), JSON.stringify({
      status: "allowed",
      robotsUrl: "https://truncated.example/robots.txt",
      userAgent: "CCBot",
      checkedAt: Date.now()
    }));

    render(<ArchiveSearchApp autoStart initialParams={{ url: "truncated.example", scope: "all" }} />);

    await waitFor(() => expect(queryCollection).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: /scan log/i }));
    expect(
      await screen.findByText(/more captures than the per-collection limit/i)
    ).toBeInTheDocument();
  });
});
