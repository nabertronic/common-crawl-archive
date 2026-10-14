import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandingSections } from "@/components/landing-sections";
import { SiteFooter } from "@/components/site-footer";
import { WebsitePreferences } from "@/components/website-preferences";
import { detectBookmarkHint } from "@/components/landing-bookmark-hint";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/"
}));

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

describe("LandingSections", () => {
  it("renders the merged sections with a single heading per section and no separate guide links", () => {
    render(<LandingSections />);
    expect(screen.getByRole("heading", { name: "Three steps to a lost page", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Built on Common Crawl", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A web archive that stays out of your way", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Frequently asked questions", level: 2 })).toBeInTheDocument();
    expect(document.getElementById("how-it-works")).not.toBeNull();
    expect(document.getElementById("faq")).not.toBeNull();

    const guideNav = screen.getByRole("navigation", { name: "Research guide" });
    expect(guideNav.querySelector('a[href="#how-it-works"]')).toHaveTextContent("How it works");
    expect(guideNav.querySelector('a[href="#faq"]')).toHaveTextContent("FAQ");
    expect(document.querySelector('a[href^="/how-it-works"]')).toBeNull();
  });

  it("exposes FAQ entries as h3 buttons with aria-expanded and aria-controls", () => {
    render(<LandingSections />);
    const button = screen.getByRole("button", { name: "How is this different from the Wayback Machine?" });
    expect(button.closest("h3")).not.toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("data-open", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("data-open", "true");
    expect(screen.getByText(/Common Crawl often holds captures the Wayback Machine is missing/)).toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("data-open", "false");
  });

  it("emits FAQPage JSON-LD that matches the visible questions", () => {
    const { container } = render(<LandingSections />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script?.innerHTML ?? "{}");
    expect(data["@type"]).toBe("FAQPage");
    const questions = data.mainEntity.map((entry: { name: string }) => entry.name);
    expect(questions).toHaveLength(6);
    for (const question of questions) {
      expect(screen.getByRole("button", { name: question })).toBeInTheDocument();
    }
  });

  it("keeps native landing anchors, footer links, and legal information accessible", async () => {
    render(<><LandingSections /><SiteFooter /><WebsitePreferences /></>);
    const nav = screen.getByRole("navigation", { name: "Landing sections" });
    for (const href of ["#top", "#how-it-works", "#why-crawlback", "#data-source", "#faq"]) {
      expect(nav.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();

    const footer = screen.getByRole("contentinfo");
    expect(footer.querySelector('a[href="/#how-it-works"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/#faq"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/imprint"]')).not.toBeNull();
    fireEvent.click(within(footer).getByRole("button", { name: "Website settings" }));
    expect(await screen.findByRole("dialog", { name: "Browser storage" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(footer.querySelector('a[href="/history"]')).toBeNull();
    expect(footer.querySelector('a[href="/settings"]')).toBeNull();
    expect(footer.querySelector('a[href="https://commoncrawl.org"]')).toBeNull();
  });
});

describe("detectBookmarkHint", () => {
  it("uses the Command key on macOS and Ctrl elsewhere", () => {
    expect(detectBookmarkHint({ userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 0 })).toEqual({ kind: "keys", keys: ["⌘", "D"] });
    expect(detectBookmarkHint({ userAgent: WINDOWS_UA, platform: "Win32", maxTouchPoints: 0 })).toEqual({ kind: "keys", keys: ["Ctrl", "D"] });
    expect(detectBookmarkHint({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)", platform: "Linux x86_64" })).toEqual({ kind: "keys", keys: ["Ctrl", "D"] });
  });

  it("prefers userAgentData platform when available", () => {
    expect(detectBookmarkHint({ userAgent: WINDOWS_UA, platform: "", userAgentData: { platform: "macOS" } })).toEqual({ kind: "keys", keys: ["⌘", "D"] });
  });

  it("shows a touch alternative instead of a shortcut on iPhone, iPad, and Android", () => {
    expect(detectBookmarkHint({ userAgent: IPHONE_UA, platform: "iPhone" })).toMatchObject({ kind: "touch" });
    expect(detectBookmarkHint({ userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 5 })).toMatchObject({ kind: "touch" });
    expect(detectBookmarkHint({ userAgent: ANDROID_UA, platform: "Linux armv8l" })).toMatchObject({ kind: "touch" });
  });
});
