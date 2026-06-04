import { describe, expect, it } from "vitest";
import {
  legacyScanSearchKey,
  legacyScanSearchKeys,
  legacyUnscopedScanSearchKey,
  scanSearchKey,
  targetIdFor
} from "@/lib/capture-store";

describe("capture store keys", () => {
  it("builds stable target ids from url, match type, and mock mode", () => {
    expect(targetIdFor("https://example.com/", "exact", false)).toBe(
      targetIdFor("https://example.com/", "exact", false)
    );
    expect(targetIdFor("https://example.com/", "exact", false)).not.toBe(
      targetIdFor("https://example.com/", "host", false)
    );
    expect(targetIdFor("https://example.com/", "exact", false)).not.toBe(
      targetIdFor("https://example.com/", "exact", true)
    );
  });

  it("keeps recent and full scan records in separate canonical keys", () => {
    const recent = scanSearchKey("https://example.com/", "domain", false, "recent");
    const full = scanSearchKey("https://example.com/", "domain", false, "all");

    expect(recent).not.toBe(full);
    expect(recent).toBe("live:domain:https://example.com/:scan:recent");
    expect(full).toBe("live:domain:https://example.com/:scan:all");
  });

  it("still lists old scan key formats for migration", () => {
    expect(legacyScanSearchKeys("https://example.com/", "host", false)).toEqual([
      legacyUnscopedScanSearchKey("https://example.com/", "host", false),
      legacyScanSearchKey("https://example.com/", "host", false, "recent"),
      legacyScanSearchKey("https://example.com/", "host", false, "all")
    ]);
  });
});
