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

  it("navigates for a primary click or drag, but rejects unrelated pointer releases", () => {
    const onJump = vi.fn();
    const second = { ...capture, timestamp: "20260520141200", offset: "20" } as CommonCrawlCapture;
    render(<CaptureTimeline sorted={[capture, second]} currentIndex={0} onJump={onJump} />);
    const slider = screen.getByRole("slider", { name: "Capture timeline" });
    const track = slider.querySelector("div.absolute.inset-x-3") as HTMLDivElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 56, width: 100, height: 56,
      toJSON: () => ({})
    } as DOMRect);
    Object.defineProperty(slider, "setPointerCapture", { value: vi.fn() });

    fireEvent.pointerUp(slider, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    fireEvent.pointerDown(slider, { pointerId: 2, pointerType: "mouse", isPrimary: true, button: 2, clientX: 100 });
    fireEvent.pointerUp(slider, { pointerId: 2, pointerType: "mouse", isPrimary: true, button: 2, clientX: 100 });
    fireEvent.pointerDown(slider, { pointerId: 3, pointerType: "mouse", isPrimary: true, button: 1, clientX: 100 });
    fireEvent.pointerUp(slider, { pointerId: 3, pointerType: "mouse", isPrimary: true, button: 1, clientX: 100 });
    expect(onJump).not.toHaveBeenCalled();

    fireEvent.pointerDown(slider, { pointerId: 4, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    fireEvent.pointerUp(slider, { pointerId: 5, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    expect(onJump).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, { pointerId: 4, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    expect(onJump).toHaveBeenCalledWith(1);

    onJump.mockClear();
    fireEvent.pointerDown(slider, { pointerId: 9, pointerType: "mouse", isPrimary: true, button: 0, clientX: 0 });
    fireEvent.pointerUp(slider, { pointerId: 9, pointerType: "mouse", isPrimary: true, button: 0, clientX: 0 });
    expect(onJump).not.toHaveBeenCalled();

    fireEvent.pointerDown(slider, { pointerId: 10, pointerType: "mouse", isPrimary: true, button: 0, clientX: 0 });
    fireEvent.pointerUp(slider, { pointerId: 11, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    expect(onJump).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, { pointerId: 10, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    expect(onJump).toHaveBeenCalledWith(1);

    onJump.mockClear();
    fireEvent.pointerDown(slider, { pointerId: 12, pointerType: "touch", isPrimary: true, button: 0, clientX: 0 });
    fireEvent.pointerCancel(slider, { pointerId: 12, pointerType: "touch", isPrimary: true, button: 0, clientX: 100 });
    fireEvent.pointerUp(slider, { pointerId: 12, pointerType: "touch", isPrimary: true, button: 0, clientX: 100 });
    expect(onJump).not.toHaveBeenCalled();

    fireEvent.pointerDown(slider, { pointerId: 13, pointerType: "mouse", isPrimary: true, button: 0, clientX: 0 });
    fireEvent.pointerUp(slider, { pointerId: 13, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    expect(onJump).toHaveBeenCalledWith(1);

    onJump.mockClear();
    fireEvent.pointerDown(slider, { pointerId: 14, pointerType: "mouse", isPrimary: true, button: 0, clientX: 0 });
    fireEvent.pointerMove(slider, { pointerId: 15, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    fireEvent.lostPointerCapture(slider, { pointerId: 14, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    fireEvent.pointerUp(slider, { pointerId: 14, pointerType: "mouse", isPrimary: true, button: 0, clientX: 100 });
    expect(onJump).not.toHaveBeenCalled();
  });
});
