import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("renders the merged sections with a single heading per section and no links under the hero", () => {
    render(<LandingSections />);
    expect(screen.getByRole("heading", { name: "Three steps to a lost page", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Built on Common Crawl", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A web archive that stays out of your way", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Frequently asked questions", level: 2 })).toBeInTheDocument();
    expect(document.getElementById("how-it-works")).not.toBeNull();
    expect(document.getElementById("faq")).not.toBeNull();

    expect(screen.queryByRole("navigation", { name: "Research guide" })).toBeNull();
    expect(screen.queryByText("How it works →")).toBeNull();
    expect(document.querySelector('a[href^="/how-it-works"]')).toBeNull();
  });

  it("omits the local government notice example and keeps the Common Crawl guidance links", () => {
    render(<LandingSections />);
    expect(screen.queryByText(/Local government notice/)).toBeNull();
    expect(screen.queryByText(/Suppose a city removes a notice/)).toBeNull();
    expect(screen.getByRole("link", { name: "Common Crawl FAQ →" })).toHaveAttribute("href", "https://www.commoncrawl.org/faq");
    expect(screen.queryByRole("link", { name: /Terms of Use/ })).toBeNull();
  });

  it("answers the scan, preview, and FAQ questions with the updated guidance", () => {
    render(<LandingSections />);
    const script = document.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script?.innerHTML ?? "{}");
    const answers: Record<string, string> = Object.fromEntries(
      data.mainEntity.map((entry: { name: string; acceptedAnswer: { text: string } }) => [entry.name, entry.acceptedAnswer.text])
    );

    const scan = answers["Why can a scan take so long?"];
    expect(scan).toContain("Common Crawl's public index API is often overloaded, so if you get many errors, simply try again later.");
    expect(scan).not.toMatch(/rotate|proxies|proxy|VPN|different (IP|network)/i);

    const preview = answers["Why is the preview incomplete?"];
    expect(preview).toContain("for security and privacy reasons");
    expect(preview).toContain("archived scripts never run");
    expect(preview).toContain("does not load external resources");
    expect(preview).toContain("reveal your visit or IP address");

    for (const answer of Object.values(answers)) {
      expect(answer).not.toMatch(/OSINT|rotate IP|use proxies|VPN/i);
    }
  });

  it("links the open-source repository in a new tab", () => {
    render(<LandingSections />);
    const link = screen.getByRole("link", { name: "Read the code on GitHub →" });
    expect(link).toHaveAttribute("href", "https://github.com/nabertronic/common-crawl-archive");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Crawlback is open source/)).toBeInTheDocument();
  });

  it("places the bookmark hint below the benefit cards and reserves its space before hydration", () => {
    render(<LandingSections />);
    const cards = screen.getByRole("heading", { name: "Alternative archive", level: 3 }).closest("ul");
    const hintText = screen.getByText(/to bookmark Crawlback|Tap the Share button|Open your browser menu/);
    expect(cards).not.toBeNull();
    expect((cards?.compareDocumentPosition(hintText) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cards?.nextElementSibling?.contains(hintText)).toBe(true);
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
    expect(questions).not.toContain("What does OSINT mean here?");
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
    const githubLink = within(footer).getByRole("link", { name: "GitHub" });
    expect(githubLink).toHaveAttribute("href", "https://github.com/nabertronic/common-crawl-archive");
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink).toHaveAttribute("rel", "noopener noreferrer");
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

describe("Reveal robustness", () => {
  const sectionCount = () => document.querySelectorAll("#how-it-works, #why-crawlback, #data-source, #faq").length;
  const originalIO = globalThis.IntersectionObserver;
  const originalRect = Element.prototype.getBoundingClientRect;
  afterEach(() => {
    globalThis.IntersectionObserver = originalIO;
    Element.prototype.getBoundingClientRect = originalRect;
    vi.useRealTimers();
  });
  const hidden = () => document.querySelectorAll(".scroll-reveal:not(.is-visible)");

  it("shows everything when IntersectionObserver is unavailable", () => {
    // @ts-expect-error simulate missing API
    delete globalThis.IntersectionObserver;
    render(<LandingSections />);
    expect(sectionCount()).toBe(4);
    expect(hidden().length).toBe(0);
    expect(document.querySelectorAll(".is-visible").length).toBeGreaterThan(0);
  });

  it("reveals sections already in or above the viewport at mount, including after a remount", () => {
    class NeverFiresIO { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } }
    globalThis.IntersectionObserver = NeverFiresIO as unknown as typeof IntersectionObserver;
    Element.prototype.getBoundingClientRect = () => ({ top: -2000, bottom: -1000, left: 0, right: 0, width: 0, height: 0, x: 0, y: -2000, toJSON() {} }) as DOMRect;
    const first = render(<LandingSections />);
    expect(hidden().length).toBe(0);
    first.unmount();
    render(<LandingSections />);
    expect(hidden().length).toBe(0);
  });

  it("never leaves below-fold sections hidden if the observer never fires", () => {
    vi.useFakeTimers();
    class NeverFiresIO { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } }
    globalThis.IntersectionObserver = NeverFiresIO as unknown as typeof IntersectionObserver;
    Element.prototype.getBoundingClientRect = () => ({ top: 5000, bottom: 6000, left: 0, right: 0, width: 0, height: 0, x: 0, y: 5000, toJSON() {} }) as DOMRect;
    render(<LandingSections />);
    expect(hidden().length).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(hidden().length).toBe(0);
  });
});
