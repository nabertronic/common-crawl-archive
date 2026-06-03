import type { CollectionCheckResult, CommonCrawlCapture, CommonCrawlCollection, MatchType } from "./common-crawl";

const DB_NAME = "wayback-fallback";
const DB_VERSION = 1;
const STORE = "searches";
const CHANNEL_NAME = "wayback-fallback:searches";

export type StoredSearch = {
  key: string;
  url: string;
  matchType: MatchType;
  mock: boolean;
  captures: CommonCrawlCapture[];
  scanScope?: "recent" | "all";
  collections?: CommonCrawlCollection[];
  results?: CollectionCheckResult[];
  updatedAt: number;
};

export function searchKey(url: string, matchType: MatchType | string, mock: boolean): string {
  return `${mock ? "mock" : "live"}:${matchType}:${url}`;
}

export function scanSearchKey(
  url: string,
  matchType: MatchType | string,
  mock: boolean,
  scope: "recent" | "all"
): string {
  return `${searchKey(url, matchType, mock)}:scan:${scope}`;
}

export function legacyUnscopedScanSearchKey(url: string, matchType: MatchType | string, mock: boolean): string {
  return `${searchKey(url, matchType, mock)}:scan`;
}

export function legacyScanSearchKey(
  url: string,
  matchType: MatchType | string,
  mock: boolean,
  scope: "recent" | "all"
): string {
  return `${searchKey(url, matchType, mock)}:${scope}`;
}

export function legacyScanSearchKeys(url: string, matchType: MatchType | string, mock: boolean): string[] {
  return [
    legacyUnscopedScanSearchKey(url, matchType, mock),
    legacyScanSearchKey(url, matchType, mock, "recent"),
    legacyScanSearchKey(url, matchType, mock, "all")
  ];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function putSearch(record: StoredSearch): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    notifyUpdated(record.key);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function getSearch(key: string): Promise<StoredSearch | undefined> {
  try {
    const db = await openDB();
    const result = await new Promise<StoredSearch | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as StoredSearch | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return undefined;
  }
}

export async function listSearches(): Promise<StoredSearch[]> {
  try {
    const db = await openDB();
    const result = await new Promise<StoredSearch[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredSearch[] | undefined) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return [];
  }
}

export async function deleteSearch(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    notifyUpdated(key);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

export async function deleteSearches(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    for (const key of keys) notifyUpdated(key);
  } catch {
    // Best-effort persistence — never break the UI.
  }
}

function notifyUpdated(key: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: "updated", key });
    channel.close();
  } catch {
    // BroadcastChannel may not be available in every environment.
  }
}

export function subscribeToSearch(key: string, onUpdate: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (event.data?.type === "updated" && event.data.key === key) onUpdate();
    };
  } catch {
    return () => {};
  }
  return () => channel?.close();
}
