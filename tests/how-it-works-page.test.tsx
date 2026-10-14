import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HowItWorksPage, { metadata } from "@/app/how-it-works/page";

describe("journalist guide", () => {
  it("provides the how-it-works and FAQ anchors with practical research guidance", () => {
    render(<HowItWorksPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Finding and checking archived web pages" })).toBeInTheDocument();
    expect(document.getElementById("how-it-works")).toHaveAccessibleName("From a URL to a dated capture");
    expect(document.getElementById("faq")).toHaveAccessibleName("Questions from researchers");
    expect(screen.getByText(/OSINT means open-source intelligence/)).toBeInTheDocument();
    expect(screen.getByText(/directly to Common Crawl's public index/)).toBeInTheDocument();
    expect(screen.getByText(/A different public IP can receive a different limit/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503 response, slow down/)).toBeInTheDocument();
    expect(screen.getByText(/wait 24 hours before trying again/)).toBeInTheDocument();
    expect(screen.getByText(/capture date is when Common Crawl saved the page/)).toBeInTheDocument();
    expect(screen.getByText(/Suppose a city removes a notice about a road closure/)).toBeInTheDocument();
    expect(screen.getByText(/Record the capture date and exact URL/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Common Crawl" })).toHaveAttribute("href", "https://www.commoncrawl.org/");
    expect(screen.getByRole("link", { name: "Common Crawl FAQ" })).toHaveAttribute("href", "https://www.commoncrawl.org/faq");
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "https://www.commoncrawl.org/terms-of-use");
  });

  it("sets substantive page metadata without inventing a site domain", () => {
    expect(metadata.title).toMatch(/Common Crawl archive search for journalists/);
    expect(metadata.description).toMatch(/deleted or changed web pages/);
    expect(metadata.alternates?.canonical).toBe("/how-it-works");
    expect(metadata.openGraph).toMatchObject({ type: "article" });
    expect(metadata.openGraph).not.toHaveProperty("url");
  });
});
