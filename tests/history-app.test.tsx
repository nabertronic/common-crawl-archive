import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryApp } from "@/components/history-app";
import type { CollectionCheckResult, CommonCrawlCapture, CommonCrawlCollection } from "@/lib/common-crawl";
import type { StoredSearch } from "@/lib/capture-store";

const collection: CommonCrawlCollection = {
  id: "CC-MAIN-2026-21",
  name: "May 2026 Index",
  cdxApi: "https://index.commoncrawl.org/CC-MAIN-2026-21-index",
  from: "2026-05-08T07:40:46",
  to: "2026-05-21T22:06:58"
};

const capture: CommonCrawlCapture = {
  url: "https://beta.example/",
  timestamp: "20260508112233",
  status: "200",
  mime: "text/html",
  digest: "digest",
  length: "100",
  offset: "10",
  filename: "crawl-data/test.warc.gz",
  collectionId: collection.id,
  collectionName: collection.name,
  collectionFrom: collection.from,
  collectionTo: collection.to
};

const checkedResult: CollectionCheckResult = {
  collection,
  captures: [capture],
  status: "checked",
  attempts: 1,
  runs: 1
};

const baseRecords: StoredSearch[] = [
  {
    key: "live:exact:https://alpha.example/:scan:recent",
    url: "https://alpha.example/",
    matchType: "exact",
    mock: false,
    captures: [],
    scanScope: "recent",
    collections: [collection],
    results: [{ ...checkedResult, captures: [] }],
    updatedAt: 1
  },
  {
    key: "live:exact:https://beta.example/:scan:recent",
    url: "https://beta.example/",
    matchType: "exact",
    mock: false,
    captures: [capture],
    scanScope: "recent",
    collections: [collection],
    results: [checkedResult],
    updatedAt: 2
  }
];

let storedRecords: StoredSearch[] = baseRecords;

vi.mock("@/lib/capture-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/capture-store")>("@/lib/capture-store");
  return {
    ...actual,
    listSearches: vi.fn(async () => storedRecords),
    deleteSearch: vi.fn(),
    deleteSearches: vi.fn(),
    subscribeToSearchChanges: vi.fn(() => () => {})
  };
});

vi.mock("@/lib/common-crawl", async () => {
  const actual = await vi.importActual<typeof import("@/lib/common-crawl")>("@/lib/common-crawl");
  return {
    ...actual,
    fetchCollections: vi.fn(async () => [collection])
  };
});

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
}

function dispatchPageShow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

describe("HistoryApp", () => {
  beforeEach(() => {
    storedRecords = baseRecords;
    window.history.pushState({}, "", "/history");
  });

  it("syncs browser-restored history filter values before filtering rows", async () => {
    render(<HistoryApp />);

    await waitFor(() => expect(screen.getByText("alpha.example")).toBeInTheDocument());
    expect(screen.getByText("beta.example")).toBeInTheDocument();

    setNativeInputValue(screen.getByLabelText("Search history") as HTMLInputElement, "beta");
    dispatchPageShow(true);

    await waitFor(() => expect(screen.queryByText("alpha.example")).not.toBeInTheDocument());
    expect(screen.getByText("beta.example")).toBeInTheDocument();
  });

  it("clears browser-restored history filter values on a fresh history open", async () => {
    render(<HistoryApp />);

    await waitFor(() => expect(screen.getByText("alpha.example")).toBeInTheDocument());

    const input = screen.getByLabelText("Search history") as HTMLInputElement;
    setNativeInputValue(input, "beta");
    dispatchPageShow(false);

    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.getByText("alpha.example")).toBeInTheDocument();
    expect(screen.getByText("beta.example")).toBeInTheDocument();
  });

  it("shows narrower scans even when a broader complete scan exists", async () => {
    storedRecords = [
      ...baseRecords,
      {
        key: "live:exact:https://blog.example.com/:scan:recent",
        url: "https://blog.example.com/",
        matchType: "exact",
        mock: false,
        captures: [],
        scanScope: "recent",
        collections: [collection],
        results: [{ ...checkedResult, captures: [] }],
        updatedAt: 3
      },
      {
        key: "live:domain:https://example.com/:scan:all",
        url: "https://example.com/",
        matchType: "domain",
        mock: false,
        captures: [capture],
        scanScope: "all",
        collections: [collection],
        results: [checkedResult],
        updatedAt: 4
      }
    ];

    render(<HistoryApp />);

    await waitFor(() => expect(screen.getByText("blog.example.com")).toBeInTheDocument());
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("Scans").parentElement).toHaveTextContent("4");
  });
});
