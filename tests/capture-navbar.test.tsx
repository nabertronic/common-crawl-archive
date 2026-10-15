import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaptureTimeline } from "@/components/capture-navbar";
import type { CommonCrawlCapture } from "@/lib/common-crawl";

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

describe("CaptureTimeline hooks", () => {
  it("renders an empty list without crashing and then accepts data on re-render", () => {
    const onJump = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { container, rerender } = render(
      <CaptureTimeline sorted={[]} currentIndex={-1} onJump={onJump} />
    );
    expect(container).toBeEmptyDOMElement();

    expect(() =>
      rerender(<CaptureTimeline sorted={[capture]} currentIndex={0} onJump={onJump} />)
    ).not.toThrow();
    const slider = screen.getByRole("slider", { name: "Capture timeline" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(slider).toHaveAttribute("aria-valuetext", expect.stringMatching(/Capture 1 of 1: 2026-04-20 14:12:00 UTC/));

    errorSpy.mockRestore();
  });

  it("jumps with Home/End and leaves arrow keys to the viewer", () => {
    const onJump = vi.fn();
    const second = { ...capture, timestamp: "20260520141200", offset: "20" } as CommonCrawlCapture;
    render(<CaptureTimeline sorted={[capture, second]} currentIndex={0} onJump={onJump} />);
    const slider = screen.getByRole("slider", { name: "Capture timeline" });
    fireEvent.keyDown(slider, { key: "End" });
    expect(onJump).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onJump).toHaveBeenCalledTimes(1);
  });
});
