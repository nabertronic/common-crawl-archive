import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const storeMocks = vi.hoisted(() => ({
  getScanSession: vi.fn(async () => undefined),
  getCoverage: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => { throw new Error("settings must not be read without consent"); })
}));
const warcMocks = vi.hoisted(() => ({
  loadCaptureRecord: vi.fn(async () => ({
    record: { warcHeaders: {}, httpHeaders: {}, statusLine: "HTTP/1.1 200 OK", html: "<title>Visit local</title><p>Archived body</p>" },
    source: "network" as const
  }))
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ replace: navigation.replace })
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/website-preferences", () => ({ hasStorageConsent: () => false, subscribeStorageConsent: () => () => undefined }));
vi.mock("@/lib/warc", async () => ({
  ...(await vi.importActual<typeof import("@/lib/warc")>("@/lib/warc")),
  loadCaptureRecord: warcMocks.loadCaptureRecord
}));
vi.mock("@/lib/capture-store", async () => ({
  ...(await vi.importActual<typeof import("@/lib/capture-store")>("@/lib/capture-store")),
  getScanSession: storeMocks.getScanSession,
  getCoverage: storeMocks.getCoverage,
  getSettings: storeMocks.getSettings,
  subscribeToSearchChanges: () => () => undefined
}));

import { CaptureViewerApp } from "@/components/capture-viewer-app";
import { resetTemporaryScanStoreForTests, temporaryScanStore } from "@/lib/temporary-scan-store";

const collection = {
  id: "CC-MAIN-2026-21", name: "May 2026", cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
  from: "2026-05-01T00:00:00", to: "2026-05-31T00:00:00"
};

function capture(timestamp: string, offset: string) {
  return {
    collectionId: collection.id, collectionName: collection.name, collectionFrom: collection.from, collectionTo: collection.to,
    timestamp, url: "https://example.org/report", status: "200", mime: "text/html",
    filename: "crawl-data/CC-MAIN-2026-21/segments/x/warc/example.warc.gz", offset, length: "100"
  };
}

describe("CaptureViewerApp visit-local scan", () => {
  beforeEach(() => {
    resetTemporaryScanStoreForTests();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("loads the visit-local manifest, keeps timeline navigation in the scan, and links back without storage", async () => {
    const captures = [capture("20260512000000", "10"), capture("20260513000000", "110")];
    const session = await temporaryScanStore.ensureScanSession({
      url: captures[0].url, matchType: "exact", mock: false, scope: "all", collectionIds: [collection.id]
    });
    await temporaryScanStore.upsertCoverageResult(
      { targetId: session.targetId, url: session.url, matchType: session.matchType, mock: session.mock },
      { collection, status: "checked", captures, attempts: 1, runs: 1 }
    );
    window.history.replaceState({}, "", `/view?scan=${session.scanId}&filename=crawl-data/CC-MAIN-2026-21/segments/x/warc/example.warc.gz&offset=10&length=100&timestamp=20260512000000&url=${encodeURIComponent(captures[0].url)}&collection=${collection.id}`);

    render(<CaptureViewerApp />);
    await waitFor(() => expect(warcMocks.loadCaptureRecord).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Capture 1 of 2")).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: "Close viewer" });
    expect(backLink).toHaveAttribute("href", `/search?scan=${session.scanId}`);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining(`scan=${session.scanId}`)));
    expect(storeMocks.getScanSession).not.toHaveBeenCalled();
    expect(storeMocks.getCoverage).not.toHaveBeenCalled();
    expect(storeMocks.getSettings).not.toHaveBeenCalled();
    expect(warcMocks.loadCaptureRecord).toHaveBeenCalledTimes(1);
  });
});

describe("CaptureViewerApp route loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("keeps the current capture when an aborted previous route resolves later", async () => {
    let finishA!: (value: Awaited<ReturnType<typeof warcMocks.loadCaptureRecord>>) => void;
    const pendingA = new Promise<Awaited<ReturnType<typeof warcMocks.loadCaptureRecord>>>((resolve) => { finishA = resolve; });
    const result = (name: string) => ({
      record: { warcHeaders: {}, httpHeaders: {}, statusLine: "HTTP/1.1 200 OK", html: `<p>Body ${name}</p>` },
      source: "network" as const
    });
    warcMocks.loadCaptureRecord.mockImplementationOnce(() => pendingA).mockResolvedValueOnce(result("B"));
    window.history.replaceState({}, "", "/view?filename=crawl-data/a.warc.gz&offset=10&length=100&timestamp=20260512000000&url=https%3A%2F%2Fexample.org%2Fa");
    const app = render(<CaptureViewerApp />);
    await waitFor(() => expect(warcMocks.loadCaptureRecord).toHaveBeenCalledTimes(1));

    window.history.replaceState({}, "", "/view?filename=crawl-data/b.warc.gz&offset=110&length=100&timestamp=20260513000000&url=https%3A%2F%2Fexample.org%2Fb");
    app.rerender(<CaptureViewerApp />);
    await waitFor(() => expect(warcMocks.loadCaptureRecord).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Loading capture...")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "source" }));
    expect(app.container.querySelector("pre")?.textContent).toBe("<p>Body B</p>");

    await act(async () => finishA(result("A")));
    expect(app.container.querySelector("pre")?.textContent).toBe("<p>Body B</p>");
  });

  it("shows a controlled missing metadata notice instead of crashing", async () => {
    window.history.replaceState({}, "", "/view");
    render(<CaptureViewerApp />);
    expect(await screen.findByText("Missing WARC metadata in the viewer URL.")).toBeInTheDocument();
    expect(warcMocks.loadCaptureRecord).not.toHaveBeenCalled();
  });

  it("shows a controlled notice for invalid WARC filenames", async () => {
    window.history.replaceState({}, "", "/view?filename=../bad.warc.gz&offset=10&length=100");
    render(<CaptureViewerApp />);
    expect(await screen.findByText("Invalid WARC filename in the viewer URL.")).toBeInTheDocument();
    expect(warcMocks.loadCaptureRecord).not.toHaveBeenCalled();
  });
});
