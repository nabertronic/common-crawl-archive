import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/history", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: navigation.push }) }));

import { StorageConsentGate } from "@/components/storage-consent-gate";
import { WebsitePreferences } from "@/components/website-preferences";
import { hasStorageConsent, resetStorageConsentSession, STORAGE_CONSENT_STORAGE_KEY } from "@/lib/website-preferences";

describe("StorageConsentGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigation.pathname = "/history";
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
    expect(screen.getByText("Find archived versions of web pages.")).toBeInTheDocument();
    expect(screen.getByLabelText("URL to search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start scan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advanced search" })).toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Research guide" })).toHaveLength(1);
    expect(screen.queryByText("Storage app contents")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("URL to search"), { target: { value: "https://example.org/report" } });
    fireEvent.click(screen.getByRole("button", { name: /start scan/i }));
    expect(await screen.findByRole("dialog", { name: "Browser storage" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow browser storage" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/search?url=https%3A%2F%2Fexample.org%2Freport"));
  });
});
import "@testing-library/jest-dom/vitest";
