# Crawlback — TODO

## In progress / done in this batch
- [x] JSON export (search results + history) — feature #7
- [x] Manual "Prune now" in Storage settings — feature #8 rounding-out
- [x] WARC export (search results) — feature #6
- [x] Full-text search across cached HTML (history page) — feature #3
- [x] Domain URL tree with per-URL version navigation (search page) — feature #4
- [x] Background scans via Service Worker — feature #9
      (SW caches CDX index responses cache-first + warms remaining collections
      while the tab is hidden; registered in production only. Full "survives tab
      close with SW-side IndexedDB persistence" is future work — see PWA backlog.)

## Backlog
### PWA (installable app + offline shell)
- Add a web app manifest (`app/manifest.ts`) with name, icons, theme/background colors, `display: standalone`.
- Provide maskable + regular icons (192/512) in `public/`.
- Wire the existing service worker to precache the app shell so the UI loads offline.
- Add an "Install app" affordance / detect `beforeinstallprompt`.
- Verify Lighthouse PWA checks pass; confirm CSP allows the SW (`worker-src`/`script-src`).

### Other ideas (from feature brainstorm)
- Capture diff / version comparison in the viewer (#1).
- Reader/text-extraction mode in the viewer (#2).
- WACZ export (replayable in ReplayWeb.page) building on the WARC export (#6).
- Redirect-chain resolution for 3xx captures (#10 equiv).
- "Why blocked?" transparency panel + opt-out request helper (#11).
