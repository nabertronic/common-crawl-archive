import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveSearchApp } from "@/components/archive-search-app";

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

describe("ArchiveSearchApp", () => {
  beforeEach(() => {
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

  it("responds when search route params change without a full reload", async () => {
    const { rerender } = render(<ArchiveSearchApp initialParams={{ mock: "1", url: "first.example" }} />);

    // After a search starts the editable field is replaced by a read-only chip.
    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("first.example"));

    rerender(<ArchiveSearchApp initialParams={{ mock: "1", url: "second.example" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("second.example"));
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

  it("shows one continue action for failed scan results", async () => {
    render(<ArchiveSearchApp initialParams={{ mock: "1", url: "example.org" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("example.org"));

    expect(screen.queryByRole("button", { name: /retry failed/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });

  it("clears the URL when navigating from a search flow back to the home screen", async () => {
    const { unmount } = render(<ArchiveSearchApp initialParams={{ mock: "1", url: "hutt.io" }} />);

    await waitFor(() => expect(screen.getByLabelText("Scanned URL")).toHaveTextContent("hutt.io"));

    // `/` and `/search` are separate route files, so real navigation remounts
    // the component — a fresh mount with no params lands on the idle home screen.
    unmount();
    render(<ArchiveSearchApp />);

    await waitFor(() => expect(screen.getByLabelText("URL to search")).toHaveValue(""));
    expect(screen.getByRole("button", { name: /start scan/i })).toBeDisabled();
  });
});
