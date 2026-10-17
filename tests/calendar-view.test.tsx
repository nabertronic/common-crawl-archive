import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CalendarView } from "@/components/calendar-view";
import type { CommonCrawlCapture } from "@/lib/common-crawl";
import { resetTemporaryScanStoreForTests, temporaryScanStore } from "@/lib/temporary-scan-store";

const capture: CommonCrawlCapture = {
  collectionId: "CC-MAIN-2020-24", collectionName: "June 2020", collectionFrom: "", collectionTo: "",
  url: "https://example.org/report", timestamp: "20200512000000", status: "200", mime: "text/html",
  filename: "crawl-data/CC-MAIN-2020-24/report.warc.gz", offset: "0", length: "100"
};
const captures = [capture, { ...capture, timestamp: "20200513000000", offset: "100" }];

describe("CalendarView capture links", () => {
  beforeEach(() => resetTemporaryScanStoreForTests());

  it.each([true, false])("keeps temporary captures in the current tab: %s", async (temporary) => {
    const session = temporary ? await temporaryScanStore.ensureScanSession({
      url: capture.url, matchType: "exact", mock: false, scope: "all"
    }) : undefined;
    const scanId = session?.scanId ?? "saved_scan";
    render(<CalendarView captures={captures} backContext={{ url: capture.url }} scanId={scanId} />);

    // Both first/last summary links and the day popover must preserve the
    // in-memory scan; permanent scans retain their separate-tab behavior.
    expect(screen.getAllByRole("link")).toHaveLength(2);
    fireEvent.click(screen.getByTitle("1 capture on 2020-05-12"));
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(new URL(link.getAttribute("href")!, "https://crawlback.test").searchParams.get("scan")).toBe(scanId);
      if (temporary) expect(link).not.toHaveAttribute("target");
      else expect(link).toHaveAttribute("target", "_blank");
    }
  });
});
