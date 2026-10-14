import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingSections } from "@/components/landing-sections";
import { SiteFooter } from "@/components/site-footer";
import { WebsitePreferences } from "@/components/website-preferences";

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

  it("keeps landing navigation and makes legal information and website settings accessible in the shared footer", async () => {
    render(<><LandingSections /><SiteFooter /><WebsitePreferences /></>);
    const nav = screen.getByRole("navigation", { name: "Landing sections" });
    expect(nav.querySelector('a[href="#top"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#how-it-works"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#why-crawlback"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#data-source"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#faq"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();

    const footer = screen.getByRole("contentinfo");
    expect(footer.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/imprint"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Website settings" }));
    expect(await screen.findByRole("dialog", { name: "Your data, on this device" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(footer.querySelector('a[href="/history"]')).toBeNull();
    expect(footer.querySelector('a[href="/settings"]')).toBeNull();
    expect(footer.querySelector('a[href="https://commoncrawl.org"]')).toBeNull();
  });
});
