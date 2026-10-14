import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebsitePreferences } from "@/components/website-preferences";
import {
  grantStorageConsent,
  hasStorageConsent,
  openWebsitePreferences,
  resetStorageConsentSession,
  STORAGE_CONSENT_STORAGE_KEY,
  STORAGE_CONSENT_VERSION
} from "@/lib/website-preferences";

describe("WebsitePreferences", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear()
    } });
    resetStorageConsentSession();
  });

  it("explains storage in plain language, allows it only after a clear choice, and lets visitors decline", async () => {
    render(<WebsitePreferences />);
    const panel = await screen.findByRole("complementary", { name: /allow browser storage/i });
    expect(panel).toHaveTextContent("search, save results, and remember settings");
    expect(hasStorageConsent()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(hasStorageConsent()).toBe(false);
    act(() => openWebsitePreferences());
    fireEvent.click(await screen.findByRole("button", { name: "Allow browser storage" }));
    expect(hasStorageConsent()).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_CONSENT_STORAGE_KEY) ?? "{}")).toEqual({ version: STORAGE_CONSENT_VERSION, granted: true });
  });

  it("does not treat a version 1 acknowledgement as permission", async () => {
    window.localStorage.setItem("crawlback:website-preferences:v1", JSON.stringify({ version: 1, acknowledged: true }));
    expect(hasStorageConsent()).toBe(false);
    render(<WebsitePreferences />);
    expect(await screen.findByRole("complementary")).toBeInTheDocument();
  });

  it("keeps the choice open and reports an error if the browser blocks storage", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<WebsitePreferences />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow browser storage" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your browser did not allow storage");
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(hasStorageConsent()).toBe(false);
  });

  it("reopens settings from the footer helper and revokes consent", async () => {
    grantStorageConsent();
    render(<WebsitePreferences />);
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    act(() => openWebsitePreferences());
    const dialog = await screen.findByRole("dialog", { name: "Browser storage" });
    expect(dialog).toHaveTextContent("Turning storage off stops app features from using it");
    fireEvent.click(screen.getByRole("button", { name: "Turn storage off" }));
    await waitFor(() => expect(hasStorageConsent()).toBe(false));
    trigger.remove();
  });
});
import "@testing-library/jest-dom/vitest";
