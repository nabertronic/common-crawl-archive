import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CoverageRecord, ScanSession, SearchTarget } from "@/lib/capture-store";

vi.mock("@/lib/website-preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/website-preferences")>();
  return { ...actual, hasStorageConsent: () => true, requireStorageConsent: () => true };
});

let store: typeof import("@/lib/capture-store");

const DB_NAME = "wayback-fallback";

async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 6);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try { return await run(db); } finally { db.close(); }
}

async function putRows(rows: Array<{ store: string; value: object }>): Promise<void> {
  await withDb((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(Array.from(new Set(rows.map((row) => row.store))), "readwrite");
    for (const row of rows) tx.objectStore(row.store).put(row.value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

beforeAll(async () => {
  store = await import("@/lib/capture-store");
  await store.getSettings();
  await store.clearAllLocalAppData();
});

describe("capture store IndexedDB regressions", () => {
  it("merges concurrent disjoint settings patches in serialized readwrite transactions", async () => {
    await store.clearAllLocalAppData();
    await Promise.all([
      store.updateSettings({ defaultMatchType: "host" }),
      store.updateSettings({ defaultViewMode: "calendar" })
    ]);
    expect(await store.getSettings()).toMatchObject({ defaultMatchType: "host", defaultViewMode: "calendar" });
  });

  it("preserves settings patches from independently cached store instances", async () => {
    await store.clearAllLocalAppData();
    await store.getSettings();
    // Separate module caches and database connections model two tabs sharing
    // IndexedDB. A queue confined to one module cannot protect these writes.
    vi.resetModules();
    const otherTab = await import("@/lib/capture-store");
    await otherTab.getSettings();
    await Promise.all([
      store.updateSettings({ defaultMatchType: "host" }),
      otherTab.updateSettings({ defaultViewMode: "calendar" })
    ]);
    const saved = await withDb((db) => new Promise((resolve, reject) => {
      const request = db.transaction("settings", "readonly").objectStore("settings").get("active");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
    expect(saved).toMatchObject({ defaultMatchType: "host", defaultViewMode: "calendar" });
  });

  it("uses distinct identities for the known FNV collision and separates coverage and sessions", async () => {
    const firstUrl = "https://example.org/archive/hl34kd";
    const secondUrl = "https://example.org/archive/12yjt53";
    expect(store.targetIdFor(firstUrl, "exact", false)).not.toBe(store.targetIdFor(secondUrl, "exact", false));
    await store.clearAllLocalAppData();
    const first = await store.ensureTarget(firstUrl, "exact", false);
    const second = await store.ensureTarget(secondUrl, "exact", false);
    const coverage: CoverageRecord = {
      targetId: second.targetId, url: second.url, matchType: second.matchType, mock: second.mock,
      collectionResults: {}, scanLogResults: [], updatedAt: 2
    };
    const session: ScanSession = {
      scanId: "scan_collision_first", targetId: first.targetId, url: first.url, matchType: first.matchType,
      mock: first.mock, scope: "all", createdAt: 1, updatedAt: 1
    };
    await putRows([{ store: "coverages", value: coverage }, { store: "scanSessions", value: session }]);
    expect(await store.getCoverage(first.targetId)).toBeUndefined();
    expect(await store.getCoverage(second.targetId)).toMatchObject({ url: secondUrl });
    expect(await store.getScanSession(session.scanId)).toMatchObject({ targetId: first.targetId, url: firstUrl });
  });

  it("migrates matching legacy hash records without assigning colliding coverage to another identity", async () => {
    await store.clearAllLocalAppData();
    const firstUrl = "https://example.org/archive/hl34kd";
    const secondUrl = "https://example.org/archive/12yjt53";
    const oldId = "target_wo705y";
    const firstSession: ScanSession = {
      scanId: "scan_legacy_first", targetId: oldId, url: firstUrl, matchType: "exact", mock: false,
      scope: "all", createdAt: 1, updatedAt: 1
    };
    const secondTarget: SearchTarget = {
      targetId: oldId, url: secondUrl, matchType: "exact", mock: false, createdAt: 2, updatedAt: 2
    };
    const secondCoverage: CoverageRecord = {
      targetId: oldId, url: secondUrl, matchType: "exact", mock: false, collectionResults: {}, updatedAt: 2
    };
    await putRows([
      { store: "targets", value: secondTarget },
      { store: "coverages", value: secondCoverage },
      { store: "scanSessions", value: firstSession }
    ]);
    const first = await store.ensureTarget(firstUrl, "exact", false);
    expect(await store.getCoverage(first.targetId)).toBeUndefined();
    expect(await store.getScanSession(firstSession.scanId)).toMatchObject({ targetId: first.targetId, url: firstUrl });
    const second = await store.ensureTarget(secondUrl, "exact", false);
    expect(await store.getCoverage(second.targetId)).toMatchObject({ targetId: second.targetId, url: secondUrl });
  });

  it("does not overwrite an existing canonical coverage row with older legacy data", async () => {
    await store.clearAllLocalAppData();
    const url = "https://example.org/archive/12yjt53";
    const targetId = store.targetIdFor(url, "exact", false);
    const oldId = "target_wo705y";
    const canonical: CoverageRecord = {
      targetId, url, matchType: "exact", mock: false, collectionResults: {}, updatedAt: 20
    };
    const legacyTarget: SearchTarget = {
      targetId: oldId, url, matchType: "exact", mock: false, createdAt: 1, updatedAt: 1
    };
    const stale: CoverageRecord = {
      targetId: oldId, url, matchType: "exact", mock: false, collectionResults: {}, updatedAt: 10
    };
    await putRows([
      { store: "targets", value: legacyTarget },
      { store: "coverages", value: canonical },
      { store: "coverages", value: stale }
    ]);
    await store.ensureTarget(url, "exact", false);
    expect(await store.getCoverage(targetId)).toMatchObject({ updatedAt: 20 });
  });

  it("invalidates settings and user caches during clear-all without BroadcastChannel", async () => {
    await store.clearAllLocalAppData();
    await store.updateLocalUser({ displayName: "Cached before clear" });
    await store.updateSettings({ defaultMatchType: "host" });
    await store.getSettings();
    vi.stubGlobal("BroadcastChannel", undefined);
    try {
      await store.clearAllLocalAppData();
      expect((await store.getOrCreateLocalUser()).displayName).toBeUndefined();
      expect(await store.getSettings()).toMatchObject({ activeUserId: "local", defaultMatchType: "exact" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
