import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CHANGED_HINT, CaptureRow } from "@/components/capture-row";
import type { CommonCrawlCapture } from "@/lib/common-crawl";
import { resetTemporaryScanStoreForTests, temporaryScanStore } from "@/lib/temporary-scan-store";

const capture: CommonCrawlCapture = {
  url: "https://example.org/",
  timestamp: "20260420141200",
  status: "200",
  mime: "text/html",
  digest: "digest",
  length: "100",
  offset: "10",
  filename: "crawl-data/CC-MAIN-2026-18/segment.warc.gz",
  collectionId: "CC-MAIN-2026-18",
  collectionName: "April 2026 Index",
  collectionFrom: "",
  collectionTo: ""
} as CommonCrawlCapture;

const backContext = {};

describe("CaptureRow changed marker", () => {
  it("shows a changed icon whose tooltip and accessible text explain it", () => {
    render(<CaptureRow capture={capture} backContext={backContext} changed />);

    const marker = screen.getByText(CHANGED_HINT).closest("span[title]");
    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute("title", CHANGED_HINT);
    expect(marker).toHaveTextContent(CHANGED_HINT);
    expect(screen.queryByText("Δ")).toBeNull();
  });

  it("renders no marker for an unchanged capture", () => {
    render(<CaptureRow capture={capture} backContext={backContext} />);

    expect(screen.queryByText(CHANGED_HINT)).toBeNull();
    expect(screen.queryByText(CHANGED_HINT, { exact: false })).toBeNull();
  });
});

describe("CaptureRow viewer link", () => {
  beforeEach(() => resetTemporaryScanStoreForTests());

  it.each([true, false])("keeps temporary captures in the current tab: %s", async (temporary) => {
    const session = temporary ? await temporaryScanStore.ensureScanSession({
      url: capture.url, matchType: "exact", mock: false, scope: "all"
    }) : undefined;
    const scanId = session?.scanId ?? "saved_scan";
    render(<CaptureRow capture={capture} backContext={backContext} scanId={scanId} />);

    // A new tab cannot see the in-memory scan, so only saved scans open one.
    const link = screen.getByRole("link", { name: "View" });
    expect(new URL(link.getAttribute("href")!, "https://crawlback.test").searchParams.get("scan")).toBe(scanId);
    if (temporary) expect(link).not.toHaveAttribute("target");
    else expect(link).toHaveAttribute("target", "_blank");
  });
});
