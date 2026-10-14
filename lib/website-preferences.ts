export const WEBSITE_PREFERENCES_VERSION = 1;
export const WEBSITE_PREFERENCES_STORAGE_KEY = "crawlback:website-preferences:v1";
export const OPEN_WEBSITE_PREFERENCES_EVENT = "crawlback:open-website-preferences";

type Acknowledgement = { version: number; acknowledged: true };

/** Returns true only for the current, well-formed acknowledgement. */
export function hasWebsitePreferencesAcknowledgement(storage?: Storage | null): boolean {
  try {
    const target = storage === undefined ? window.localStorage : storage;
    if (!target) return false;
    const raw = target.getItem(WEBSITE_PREFERENCES_STORAGE_KEY);
    if (!raw) return false;
    const value: unknown = JSON.parse(raw);
    return Boolean(
      value &&
      typeof value === "object" &&
      (value as Acknowledgement).version === WEBSITE_PREFERENCES_VERSION &&
      (value as Acknowledgement).acknowledged === true
    );
  } catch {
    return false;
  }
}

/** Persists the acknowledgement; storage may be disabled or unavailable. */
export function acknowledgeWebsitePreferences(storage?: Storage | null): boolean {
  try {
    const target = storage === undefined ? window.localStorage : storage;
    if (!target) return false;
    target.setItem(
      WEBSITE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: WEBSITE_PREFERENCES_VERSION, acknowledged: true } satisfies Acknowledgement)
    );
    return true;
  } catch {
    return false;
  }
}

/** Dispatch from a footer or other persistent control to reopen Website settings. */
export function openWebsitePreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_WEBSITE_PREFERENCES_EVENT));
}
