import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/history", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: navigation.push }), useSearchParams: () => new URLSearchParams(window.location.search) }));

import { StorageConsentGate } from "@/components/storage-consent-gate";
import { WebsitePreferences } from "@/components/website-preferences";
import { hasStorageConsent, resetStorageConsentSession, STORAGE_CONSENT_STORAGE_KEY } from "@/lib/website-preferences";
import { isTemporaryScanId, temporaryScanStore } from "@/lib/temporary-scan-store";

describe("StorageConsentGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigation.pathname = "/history";
    window.history.replaceState({}, "", "/");
    navigation.push.mockReset();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, String(value))),
      removeItem: (key: string) => values.delete(key), clear: () => values.clear()
    } });
    resetStorageConsentSession();
  });

  it("does not mount storage consumers before consent and mounts them after Allow", async () => {
    const mounted = vi.fn();
    function StorageConsumer() { useEffect(() => mounted(), []); return <p>Private app feature</p>; }
    render(<><StorageConsentGate><StorageConsumer /></StorageConsentGate><WebsitePreferences /></>);
    expect(screen.queryByText("Private app feature")).not.toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem).toHaveBeenCalledWith(STORAGE_CONSENT_STORAGE_KEY));
    expect((window.localStorage.getItem as ReturnType<typeof vi.fn>).mock.calls.every(([key]) => key === STORAGE_CONSENT_STORAGE_KEY)).toBe(true);
    expect(mounted).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Allow browser storage" }));
    expect(await screen.findByText("Private app feature")).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("allows only a known visit-local scan through viewer and restored scan routes", async () => {
    const session = await temporaryScanStore.ensureScanSession({
      url: "https://example.org/report", matchType: "exact", mock: false, scope: "all"
    });
    expect(isTemporaryScanId(session.scanId)).toBe(true);
    window.history.replaceState({}, "", `/view?scan=${encodeURIComponent(session.scanId)}`);
    navigation.pathname = "/view";
    const rendered = render(<StorageConsentGate><p>Visit local capture</p></StorageConsentGate>);
    expect(screen.getByText("Visit local capture")).toBeInTheDocument();

    rendered.unmount();
    window.history.replaceState({}, "", `/search?scan=${encodeURIComponent(session.scanId)}`);
    navigation.pathname = "/search";
    const restored = render(<StorageConsentGate><p>Restored visit local scan</p></StorageConsentGate>);
    expect(screen.getByText("Restored visit local scan")).toBeInTheDocument();

    window.history.replaceState({}, "", "/view?scan=temporary_unknown");
    navigation.pathname = "/view";
    restored.rerender(<StorageConsentGate><p>Unknown capture</p></StorageConsentGate>);
    expect(screen.queryByText("Unknown capture")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Archived page" })).toBeInTheDocument();
  });

  it.each([
    "/search?url=https%3A%2F%2Fexample.org%2Farticle&match=exact&scope=all",
    "/search?url=https%3A%2F%2Fexample.org%2Farticle&match=host&scope=all&source=pastpage",
    "/search?url=https%3A%2F%2Fexample.org%2Farticle&match=exact&scope=recent&source=pastpage",
    "/search?match=exact&scope=all&source=pastpage",
    "/search?url=example.org&match=exact&scope=all&source=other",
    "/search?url=example.org&match=exact&scope=all&source=pastpage&history=1",
    "/?url=example.org&match=exact&scope=all&source=pastpage"
  ])("keeps other entries consent-gated: %s", (href) => {
    window.history.replaceState({}, "", href);
    navigation.pathname = window.location.pathname;
    render(<StorageConsentGate><p>Search contents</p></StorageConsentGate>);
    expect(screen.queryByText("Search contents")).not.toBeInTheDocument();
  });

  it("prompts again when blocked history is requested after No thanks", async () => {
    render(<><StorageConsentGate><p>History contents</p></StorageConsentGate><WebsitePreferences /></>);
    fireEvent.click(await screen.findByRole("button", { name: "No thanks" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByText("History contents")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View saved searches" }));
    expect(await screen.findByRole("dialog", { name: "Browser storage" })).toBeInTheDocument();
    expect(hasStorageConsent()).toBe(false);
  });

  it("keeps protected pages minimal while the single global banner explains storage", async () => {
    render(<><StorageConsentGate><p>Storage app contents</p></StorageConsentGate><WebsitePreferences /></>);
    expect(await screen.findByRole("heading", { name: "Scan history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View saved searches" })).toBeInTheDocument();
    expect(screen.getAllByRole("complementary", { name: /allow browser storage/i })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: /allow browser storage to continue/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Storage app contents")).not.toBeInTheDocument();
  });

  it("leaves public explainer pages available before consent", async () => {
    navigation.pathname = "/privacy";
    render(<><StorageConsentGate><p>Public privacy information</p></StorageConsentGate><WebsitePreferences /></>);
    expect(await screen.findByText("Public privacy information")).toBeInTheDocument();
    expect(hasStorageConsent()).toBe(false);
  });

  it("explains the storage choice on settings instead of an empty page and mounts settings after Allow", async () => {
    navigation.pathname = "/settings";
    const mounted = vi.fn();
    function SettingsConsumer() { useEffect(() => mounted(), []); return <p>Settings controls</p>; }
    render(<><StorageConsentGate><SettingsConsumer /></StorageConsentGate><WebsitePreferences /></>);
    expect(await screen.findByRole("heading", { name: "App settings" })).toBeInTheDocument();
    expect(screen.getByText("Available after you allow storage")).toBeInTheDocument();
    expect(screen.queryByText("Settings controls")).not.toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
    const storage = screen.getByRole("region", { name: "Browser storage" });
    expect(storage).toHaveTextContent("search history, scan results, cached pages, and settings");
    fireEvent.click(within(storage).getByRole("button", { name: "Allow browser storage" }));
    expect(await screen.findByText("Settings controls")).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("keeps the original centered home search and guide visible without mounting the app", async () => {
    navigation.pathname = "/";
    render(<><StorageConsentGate><p>Storage app contents</p></StorageConsentGate><WebsitePreferences /></>);
    expect(screen.getByRole("heading", { name: /crawlback/i })).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Find archived copies of pages the web forgot.")).toBeInTheDocument();
    expect(screen.getByLabelText("URL to search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start scan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advanced search" })).toBeInTheDocument();
    expect(screen.queryByText("Storage app contents")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("URL to search"), { target: { value: "https://example.org/report" } });
    fireEvent.click(screen.getByRole("button", { name: /start scan/i }));
    expect(await screen.findByRole("dialog", { name: "Browser storage" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow browser storage" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/search?url=https%3A%2F%2Fexample.org%2Freport"));
  });
});
import "@testing-library/jest-dom/vitest";
