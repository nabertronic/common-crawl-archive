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
      screen.getByRole("heading", { name: "A web archive that stays out of your way" })
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

  it("renders the floating landing navigation and keeps footer minimal", () => {
    render(<LandingSections />);
    const nav = screen.getByRole("navigation", { name: "Landing sections" });
    expect(nav.querySelector('a[href="#top"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#how-it-works"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#why-crawlback"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#data-source"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#faq"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();

    const footer = screen.getByRole("contentinfo");
    expect(footer.querySelector('a[href="/history"]')).toBeNull();
    expect(footer.querySelector('a[href="/settings"]')).toBeNull();
    expect(footer.querySelector('a[href="https://commoncrawl.org"]')).toBeNull();
  });
});
