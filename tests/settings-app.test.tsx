import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsApp } from "@/components/settings-app";
import type { AppSettings } from "@/lib/capture-store";

const settings: AppSettings = {
  id: "active",
  activeUserId: "local",
  htmlCacheEnabled: true,
  htmlCacheLimitBytes: 50 * 1024 * 1024,
  autoPruneEnabled: true,
  showHtmlPrivacyWarning: true,
  defaultMatchType: "exact",
  defaultScanScope: "recent",
  defaultViewMode: "list",
  defaultSort: "timestamp-desc",
  searchPageSize: 50,
  historyPageSize: 25,
  defaultExportColumns: ["url", "timestamp"],
  largeCaptureLimitBytes: 10 * 1024 * 1024,
  updatedAt: 1
};

vi.mock("@/lib/capture-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/capture-store")>("@/lib/capture-store");
  return {
    ...actual,
    clearAllLocalAppData: vi.fn(),
    clearHtmlCache: vi.fn(),
    getCacheStats: vi.fn(async () => ({ count: 0, sizeBytes: 0 })),
    getSettings: vi.fn(async () => settings),
    resetSettings: vi.fn(async () => settings),
    subscribeToSearchChanges: vi.fn(() => () => {}),
    updateSettings: vi.fn(async () => settings)
  };
});

vi.mock("@/lib/common-crawl", async () => {
  const actual = await vi.importActual<typeof import("@/lib/common-crawl")>("@/lib/common-crawl");
  return {
    ...actual,
    getCollectionCacheInfo: vi.fn(() => ({ count: 0 })),
    refreshCollections: vi.fn(async () => [])
  };
});

class TestIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}

describe("SettingsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  });

  it("uses a right-aligned menu for history and start navigation", async () => {
    render(<SettingsApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeInTheDocument());

    expect(screen.queryByRole("link", { name: /open scan history/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));

    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual(["New Scan", "History"]);
    expect(menuItems[0]).toHaveAttribute("href", "/");
    expect(menuItems[1]).toHaveAttribute("href", "/history");
  });

  it("shows the settings sections in the configured order", async () => {
    render(<SettingsApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeInTheDocument());

    const sectionLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("#"));
    expect(sectionLinks.map((link) => link.textContent)).toEqual([
      "01Scan settings",
      "02Results",
      "03Viewer",
      "04Storage",
      "05Export",
      "06Danger zone"
    ]);
    expect(sectionLinks.map((link) => link.getAttribute("href"))).toEqual([
      "#scan-settings",
      "#results-defaults",
      "#viewer",
      "#storage",
      "#export",
      "#danger-zone"
    ]);
    expect(screen.queryByRole("link", { name: /collections/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scan settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByText("Common Crawl list")).toBeInTheDocument();
  });
});
