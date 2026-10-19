import { useSyncExternalStore } from "react";

export type PastPageStore = { browser: "chrome" | "firefox"; label: string; href: string };

export const PASTPAGE_CHROME: PastPageStore = {
  browser: "chrome",
  label: "Chrome Extension",
  href: "https://chromewebstore.google.com/detail/pastpage-query-10+-web-ar/icpegbecignmplpkjjcegmjmfadpcpoo"
};

export const PASTPAGE_FIREFOX: PastPageStore = {
  browser: "firefox",
  label: "Firefox Add-on",
  href: "https://addons.mozilla.org/firefox/addon/pastpage-query-10-web-archives/"
};

// Pure so the browser rule can be tested without a browser. Everything that is
// not Firefox gets the Chrome Web Store, which also serves Edge, Brave, and Opera.
export function detectPastPageStore(userAgent: string): PastPageStore {
  return /\bFirefox\//.test(userAgent) ? PASTPAGE_FIREFOX : PASTPAGE_CHROME;
}

const noopSubscribe = () => () => {};

// Snapshots must be referentially stable, and the browser never changes, so detect once.
let clientStore: PastPageStore | null = null;
function getClientStore(): PastPageStore {
  clientStore ??= detectPastPageStore(navigator.userAgent);
  return clientStore;
}

/** Server HTML renders the Chrome link; Firefox swaps to the add-on right after hydration. */
export function usePastPageStore(): PastPageStore {
  return useSyncExternalStore(noopSubscribe, getClientStore, () => PASTPAGE_CHROME);
}
