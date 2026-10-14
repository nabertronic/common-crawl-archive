export const STORAGE_CONSENT_VERSION = 2;
export const STORAGE_CONSENT_STORAGE_KEY = "crawlback:storage-consent:v2";
// Kept as aliases for existing footer integrations.
export const WEBSITE_PREFERENCES_VERSION = STORAGE_CONSENT_VERSION;
export const WEBSITE_PREFERENCES_STORAGE_KEY = STORAGE_CONSENT_STORAGE_KEY;
export const OPEN_WEBSITE_PREFERENCES_EVENT = "crawlback:open-website-preferences";
export const STORAGE_CONSENT_CHANGE_EVENT = "crawlback:storage-consent-change";

export type StorageConsentSnapshot = { granted: boolean; decided: boolean };
type ConsentRecord = { version: 2; granted: true };
let sessionDecision: "undecided" | "declined" | "granted" = "undecided";
const listeners = new Set<() => void>();
let browserEventsInstalled = false;

/** Reads only the small consent record. It never inspects app data. */
export function hasStorageConsent(storage?: Pick<Storage, "getItem"> | null): boolean {
  if (storage === undefined && sessionDecision === "declined") return false;
  try {
    const target = storage === undefined ? (typeof window === "undefined" ? null : window.localStorage) : storage;
    if (!target) return false;
    const raw = target.getItem(STORAGE_CONSENT_STORAGE_KEY);
    if (!raw) return false;
    const value: unknown = JSON.parse(raw);
    return Boolean(value && typeof value === "object" && (value as ConsentRecord).version === 2 && (value as ConsentRecord).granted === true);
  } catch { return false; }
}

export function getStorageConsentSnapshot(): StorageConsentSnapshot {
  const granted = hasStorageConsent();
  return { granted, decided: granted || sessionDecision === "declined" };
}

export function subscribeStorageConsent(listener: () => void): () => void {
  if (typeof window !== "undefined") {
    window.addEventListener(STORAGE_CONSENT_CHANGE_EVENT, listener);
    listeners.add(listener);
    if (!browserEventsInstalled) {
      window.addEventListener("storage", onStorage);
      browserEventsInstalled = true;
    }
  }
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener(STORAGE_CONSENT_CHANGE_EVENT, listener);
      listeners.delete(listener);
      if (listeners.size === 0 && browserEventsInstalled) {
        window.removeEventListener("storage", onStorage);
        browserEventsInstalled = false;
      }
    }
  };
}
function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === STORAGE_CONSENT_STORAGE_KEY) {
    let granted = false;
    try { granted = hasStorageConsent(window.localStorage); } catch { /* Storage may be blocked by the browser. */ }
    if (!granted) { sessionDecision = "declined"; disableStorageWorkers(); }
    else sessionDecision = "granted";
    notify();
  }
}
function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STORAGE_CONSENT_CHANGE_EVENT));
}

export function grantStorageConsent(storage?: Pick<Storage, "setItem"> | null): boolean {
  try {
    const target = storage === undefined ? (typeof window === "undefined" ? null : window.localStorage) : storage;
    if (!target) return false;
    target.setItem(STORAGE_CONSENT_STORAGE_KEY, JSON.stringify({ version: 2, granted: true } satisfies ConsentRecord));
    sessionDecision = "granted";
    notify();
    return true;
  } catch { return false; }
}

export function revokeStorageConsent(): void {
  try { if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_CONSENT_STORAGE_KEY); } catch { /* Best effort. */ }
  sessionDecision = "declined";
  disableStorageWorkers();
  notify();
}

export function disableStorageWorkers(): void {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "scan:cancel" });
    navigator.serviceWorker.controller?.postMessage({ type: "consent:revoke" });
    const registrationsPromise = navigator.serviceWorker.getRegistrations?.();
    if (registrationsPromise) void registrationsPromise.then((registrations) => Promise.all(registrations.filter((registration) => {
      try { const script = new URL(registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL ?? ""); return script.origin === location.origin && script.pathname === "/sw.js"; } catch { return false; }
    }).map(async (registration) => {
      for (const worker of [registration.active, registration.waiting, registration.installing]) {
        worker?.postMessage({ type: "scan:cancel" });
        worker?.postMessage({ type: "consent:revoke" });
      }
      await registration.unregister();
    }))).catch(() => undefined);
  }
  if (typeof caches !== "undefined") void caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("crawlback-")).map((key) => caches.delete(key)))).catch(() => undefined);
}

export function declineStorageConsent(): void { sessionDecision = "declined"; notify(); }
/** Resets the in-memory decision when a fresh browser session begins. */
export function resetStorageConsentSession(): void { sessionDecision = "undecided"; notify(); }
export function hasStorageConsentDecision(): boolean { return getStorageConsentSnapshot().decided; }
export function requireStorageConsent(): boolean {
  if (hasStorageConsent()) return true;
  openWebsitePreferences();
  return false;
}
export function hasWebsitePreferencesAcknowledgement(storage?: Storage | null): boolean { return hasStorageConsent(storage); }
export function acknowledgeWebsitePreferences(storage?: Storage | null): boolean { return grantStorageConsent(storage); }
export function openWebsitePreferences(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_WEBSITE_PREFERENCES_EVENT));
}
