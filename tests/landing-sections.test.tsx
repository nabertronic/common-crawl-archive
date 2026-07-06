import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingSections } from "@/components/landing-sections";

describe("LandingSections", () => {
  it("renders all four landing sections", () => {
    render(<LandingSections />);
    expect(screen.getByRole("heading", { name: "Three steps to a lost page" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Built on Common Crawl" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "A fallback archive that stays out of your way" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Questions" })).toBeInTheDocument();
  });

  it("opens an FAQ entry on click", () => {
    render(<LandingSections />);
    const summary = screen.getByText("How is this different from the Wayback Machine?");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText(/Common Crawl often holds captures the Wayback Machine is missing/)).toBeVisible();
  });

  it("links to history, settings, and Common Crawl in the footer", () => {
    render(<LandingSections />);
    const footer = screen.getByRole("navigation", { name: "Footer" });
    expect(footer.querySelector('a[href="/history"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/settings"]')).not.toBeNull();
    const commonCrawlLink = footer.querySelector('a[href="https://commoncrawl.org"]');
    expect(commonCrawlLink).toHaveAttribute("target", "_blank");
    expect(commonCrawlLink).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});
