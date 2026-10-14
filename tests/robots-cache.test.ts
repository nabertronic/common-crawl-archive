import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readCachedRobotsStatus,
  ROBOTS_CACHE_TTL_MS,
  robotsCacheKey,
  writeCachedRobotsStatus
} from "@/lib/robots-cache";
import type { RobotsCheckResult } from "@/lib/robots";
import { grantStorageConsent, resetStorageConsentSession } from "@/lib/website-preferences";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    })
  };
}

describe("robots cache", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key), clear: () => values.clear()
    } });
    resetStorageConsentSession();
    grantStorageConsent();
  });
  it("caches robots status by robots URL and target path", () => {
    const storage = memoryStorage();
    const result: RobotsCheckResult = {
      status: "allowed",
      robotsUrl: "https://example.com/robots.txt",
      targetPath: "/pricing",
      userAgent: "CCBot",
      checkedAt: 1000
    };

    writeCachedRobotsStatus("https://example.com/pricing", result, storage);

    expect(storage.setItem).toHaveBeenCalledWith(robotsCacheKey("https://example.com/pricing"), JSON.stringify(result));
    expect(readCachedRobotsStatus("https://example.com/pricing", storage, 1000 + ROBOTS_CACHE_TTL_MS - 1)).toEqual(result);
  });

  it("expires cached robots status after 48 hours", () => {
    const storage = memoryStorage();
    const result: RobotsCheckResult = {
      status: "blocked",
      robotsUrl: "https://example.com/robots.txt",
      targetPath: "/private",
      userAgent: "CCBot",
      checkedAt: 1000
    };

    writeCachedRobotsStatus("https://example.com/private", result, storage);

    expect(readCachedRobotsStatus("https://example.com/private", storage, 1000 + ROBOTS_CACHE_TTL_MS)).toBeNull();
  });
});
