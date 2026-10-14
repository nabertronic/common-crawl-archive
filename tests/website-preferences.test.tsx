import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebsitePreferences } from "@/components/website-preferences";
import {
  acknowledgeWebsitePreferences,
  hasWebsitePreferencesAcknowledgement,
  openWebsitePreferences,
  WEBSITE_PREFERENCES_STORAGE_KEY,
  WEBSITE_PREFERENCES_VERSION
} from "@/lib/website-preferences";

describe("WebsitePreferences", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, String(value)),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear()
      }
    });
  });

  it("shows the first visit notice and acknowledges with Continue", async () => {
    render(<WebsitePreferences />);

    const panel = await screen.findByRole("complementary", { name: /cookies & local storage/i });
    expect(panel).toHaveTextContent("settings, search history, saved captures, and browser cache");
    expect(panel).toHaveTextContent("We do not use analytics or advertising cookies.");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Manage stored data" })).toHaveAttribute("href", "/settings#storage");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(hasWebsitePreferencesAcknowledgement()).toBe(true);
  });

  it("does not show the notice when the current acknowledgement is valid", async () => {
    window.localStorage.setItem(WEBSITE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: WEBSITE_PREFERENCES_VERSION, acknowledged: true }));
    render(<WebsitePreferences />);
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  });

  it("treats malformed and outdated values as unacknowledged", async () => {
    window.localStorage.setItem(WEBSITE_PREFERENCES_STORAGE_KEY, "not-json");
    expect(hasWebsitePreferencesAcknowledgement()).toBe(false);
    render(<WebsitePreferences />);
    expect(await screen.findByRole("complementary")).toBeInTheDocument();
  });

  it("continues gracefully when browser storage is unavailable", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(hasWebsitePreferencesAcknowledgement()).toBe(false);
    expect(acknowledgeWebsitePreferences()).toBe(false);
    render(<WebsitePreferences />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("reopens settings from the public helper and restores focus on Escape", async () => {
    render(<WebsitePreferences />);
    await screen.findByRole("complementary");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const trigger = document.createElement("button");
    trigger.textContent = "Website settings";
    document.body.append(trigger);
    trigger.focus();
    act(() => openWebsitePreferences());

    const dialog = await screen.findByRole("dialog", { name: "Your data, on this device" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Analytics and advertising");
    expect(dialog).toHaveTextContent("We do not use analytics or advertising cookies, or any other cookies.");
    expect(screen.getByRole("link", { name: "Manage stored data" })).toHaveAttribute("href", "/settings#storage");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("traps keyboard focus and closes through its control", async () => {
    render(<WebsitePreferences />);
    await screen.findByRole("complementary");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    act(() => openWebsitePreferences());
    const dialog = await screen.findByRole("dialog");
    const close = screen.getByRole("button", { name: "Close settings" });
    const last = screen.getByRole("link", { name: "Manage stored data" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector<HTMLAnchorElement>("a[href='/privacy']"));
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
