import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsApp } from "@/components/settings-app";
import { updateSettings, type AppSettings } from "@/lib/capture-store";

const settings: AppSettings = {
  id: "active",
  activeUserId: "local",
  htmlCacheEnabled: true,
  htmlCacheLimitBytes: 50 * 1024 * 1024,
  autoPruneEnabled: true,
  showHtmlPrivacyWarning: true,
  robotsTxtChecksEnabled: true,
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

    const menu = screen.getByRole("navigation", { name: "App navigation" });
    const menuLinks = Array.from(menu.querySelectorAll("a"));
    expect(menuLinks.map((item) => item.textContent)).toEqual(["New Scan", "History"]);
    expect(menuLinks[0]).toHaveAttribute("href", "/");
    expect(menuLinks[1]).toHaveAttribute("href", "/history");
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
      "05Export defaults",
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
    expect(screen.queryByText(/account|email address|password/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Danger zone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Export defaults" })).toBeInTheDocument();
    expect(screen.getByText("Common Crawl list")).toBeInTheDocument();
    expect(screen.getByText("Default match mode")).toBeInTheDocument();
    expect(screen.getByText("Default scan window")).toBeInTheDocument();
  });

  it("does not render account management controls", async () => {
    render(<SettingsApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeInTheDocument());

    expect(screen.queryByRole("heading", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /change email|change password|delete account/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email address|password/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });

  it("saves the global robots.txt check setting", async () => {
    render(<SettingsApp />);

    const switchButton = await screen.findByRole("switch", { name: "Check target robots.txt before scans" });
    fireEvent.click(switchButton);

    expect(updateSettings).toHaveBeenCalledWith({ robotsTxtChecksEnabled: false });
  });

  it("updates switches immediately before async settings persistence finishes", async () => {
    const save = deferred<AppSettings>();
    vi.mocked(updateSettings).mockReturnValueOnce(save.promise);
    render(<SettingsApp />);

    const robotsSwitch = await screen.findByRole("switch", { name: "Check target robots.txt before scans" });
    expect(robotsSwitch).toHaveAttribute("aria-checked", "true");

    fireEvent.click(robotsSwitch);

    expect(updateSettings).toHaveBeenCalledWith({ robotsTxtChecksEnabled: false });
    expect(robotsSwitch).toHaveAttribute("aria-checked", "false");

    save.resolve({ ...settings, robotsTxtChecksEnabled: false });

    await waitFor(() => expect(robotsSwitch).toHaveAttribute("aria-checked", "false"));
  });

  it("keeps newer setting changes visible while older saves are still resolving", async () => {
    const firstSave = deferred<AppSettings>();
    const secondSave = deferred<AppSettings>();
    vi.mocked(updateSettings)
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);
    render(<SettingsApp />);

    const robotsSwitch = await screen.findByRole("switch", { name: "Check target robots.txt before scans" });
    const cacheSwitch = await screen.findByRole("switch", { name: "Cache HTML" });

    fireEvent.click(robotsSwitch);
    fireEvent.click(cacheSwitch);

    expect(robotsSwitch).toHaveAttribute("aria-checked", "false");
    expect(cacheSwitch).toHaveAttribute("aria-checked", "false");

    firstSave.resolve({ ...settings, robotsTxtChecksEnabled: false });

    await waitFor(() => expect(cacheSwitch).toHaveAttribute("aria-checked", "false"));
    expect(robotsSwitch).toHaveAttribute("aria-checked", "false");

    secondSave.resolve({ ...settings, robotsTxtChecksEnabled: false, htmlCacheEnabled: false });

    await waitFor(() => {
      expect(robotsSwitch).toHaveAttribute("aria-checked", "false");
      expect(cacheSwitch).toHaveAttribute("aria-checked", "false");
    });
  });

  it("restores an emptied number field instead of saving its minimum", async () => {
    render(<SettingsApp />);

    const field = await screen.findByRole("spinbutton", { name: "History page size" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    expect(updateSettings).not.toHaveBeenCalled();
    expect(field).toHaveValue(25);
  });

  it("rejects a default date range whose start is after its end", async () => {
    const { getSettings } = await import("@/lib/capture-store");
    vi.mocked(getSettings).mockResolvedValueOnce({
      ...settings, defaultScanScope: "custom", defaultCustomDateFrom: "2024-01-01", defaultCustomDateTo: "2024-06-30"
    });
    render(<SettingsApp />);

    const from = await screen.findByLabelText("Default from");
    fireEvent.change(from, { target: { value: "2025-01-01" } });
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.change(from, { target: { value: "2024-02-01" } });
    expect(updateSettings).toHaveBeenCalledWith({ defaultCustomDateFrom: "2024-02-01" });
  });
});
