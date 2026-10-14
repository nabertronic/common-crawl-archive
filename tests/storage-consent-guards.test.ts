import { beforeEach, describe, expect, it, vi } from "vitest";
import { putSearch } from "@/lib/capture-store";
import { readCachedRobotsStatus, writeCachedRobotsStatus } from "@/lib/robots-cache";
import { resetStorageConsentSession, STORAGE_CONSENT_STORAGE_KEY } from "@/lib/website-preferences";

describe("low-level storage consent guards", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: vi.fn((key: string) => key === STORAGE_CONSENT_STORAGE_KEY ? null : null),
      setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn()
    } });
    resetStorageConsentSession();
  });

  it("does not read or write a supplied robots cache before consent", () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const result = { status: "allowed" as const, robotsUrl: "https://example.org/robots.txt", targetPath: "/", userAgent: "CCBot", checkedAt: 1 };
    expect(readCachedRobotsStatus("https://example.org/", storage)).toBeNull();
    writeCachedRobotsStatus("https://example.org/", result, storage);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("does not open IndexedDB when a capture-store write is attempted before consent", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    await putSearch({ key: "x", url: "https://example.org/", matchType: "exact", mock: false, captures: [], updatedAt: 1 });
    expect(open).not.toHaveBeenCalled();
  });
});
