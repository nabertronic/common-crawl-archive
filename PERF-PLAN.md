# Crawlback — Performance-Umsetzungsplan

Status-Legende: ⬜ offen · 🟨 in Arbeit · ✅ fertig

## Umsetzungsstand (alle Phasen ✅)

Umgebungs-Randbedingungen, die einige Plan-Entscheidungen geprägt haben:
- **Kein `npm`/`pnpm install` möglich**: node_modules wurde mit pnpm v11 gelinkt,
  lokal ist nur pnpm 10.x → Store-Mismatch. Neue Laufzeit-Deps (`@tanstack/react-virtual`,
  `Comlink`, `@next/bundle-analyzer`) konnten **nicht** installiert werden → dependency-frei gelöst.
- **Kein Browser-Use** (Vorgabe): verifiziert über `tsc`, Vitest (179 Tests grün) und `next build`.

- ✅ **Phase 0**: `observePerformance`/`getPerfSummary` in `lib/performance.ts`, Dev-Overlay
  `components/dev/perf-panel.tsx` (via `dev-tools.tsx` in Prod komplett tree-shaken, verifiziert),
  Messpunkte an cdx-scan/search-filter-sort/filter-options/calendar-aggregate/csv-build/zip-build/warc-parse.
- ✅ **Phase 1**: `DB_VERSION 6`, ownerId-Indexe auf `searches` + `historySummaries`
  (+ `owner_updatedAt`); Reads via `listByOwnerIndex` (Index-`getAll` statt Full-Scan+Filter).
  Indexe auf coverages/targets/sessions **bewusst weggelassen** (nur Primary-Key-Zugriff).
- ✅ **Phase 2**: `migrateStoreInBatches` (Cursor, `requestIdleCallback`), Migrations-Marker im
  settings-Store (`ensureOwnerBackfill`, idempotent), ownerId-Backfill vor Index-Read.
- ✅ **Phase 3**: `useDeferredValue` für den Text-Filter (Filter/Sort läuft mit niedriger Priorität,
  Eingabe bleibt flüssig); `content-visibility:auto` auf Capture-Rows. `CaptureManifest`
  **verworfen** (Captures sind bereits minimal, keine großen Payloads → kein realer Nutzen).
- ✅ **Phase 4**: dependency-freier Worker-RPC (`lib/compute-client.ts` + `lib/workers/compute.worker.ts`)
  für ZIP-Bau, **mit garantiertem Main-Thread-Fallback** (SSR/Tests/CSP-Block). CSP um
  `worker-src 'self' blob:` erweitert. CSV bewusst auf Main-Thread (klein, sync-Aufrufstellen).
- ✅ **Phase 5**: `next/dynamic` für `CalendarView`, `HtmlPrivacyWarningDialog` (nur bei Bedarf),
  `LandingSections` (SSR erhalten). Landing als reine Server-Component **nicht** umgebaut
  (Kind des Client-Trees, echt interaktiv → zu breiter, unverifizierbarer Umbau).

### Offene Browser-QA (einmalig, wenn Browser-Use wieder erlaubt)
- Bestätigen, dass der Compute-Worker wirklich lädt (nicht still auf den Fallback fällt):
  im Netzwerk-Tab den `compute.worker`-Chunk beim HTML-ZIP-Export sehen.
- `content-visibility` auf langen Ergebnislisten optisch prüfen (keine Scroll-Sprünge).
- Baseline-Zahlen laut PERF-BASELINE.md vor/nach erfassen.


## Phase 0 — Mess-Grundlage
- `lib/performance.ts`: `observePerformance`, `getPerfSummary` (p50/p95/count), Dev-Guard.
- `components/dev/perf-panel.tsx`: Dev-only Overlay (kein Prod-Bundle).
- Messpunkte an Hot-Paths: cdx-scan, search-filter-sort, filter-options, calendar-aggregate, csv-build, zip-build, warc-parse.
- Baseline dokumentieren.

## Phase 1 — IndexedDB-Indexe & Cursor
- `DB_VERSION 5 → 6`, Indexe: `historySummaries.ownerId` + `owner_updatedAt`, `searches.ownerId`, `coverages.ownerId`, `targets.ownerId`.
- `withIndexCursor`-Helfer; `listHistorySummaries`/`listSearches` auf Cursor statt `getAll()+filter`.
- Paginiertes Reopen.
- ⚠️ ownerId-Backfill VOR Index-Nutzung (koppelt an Phase 2).

## Phase 2 — Chunked Migration
- `migrateInBatches(store, transform, {batchSize:100})` via `requestIdleCallback`.
- Migrations-Registry im `settings`-Store (idempotent).
- UI sofort, Migration im Hintergrund.

## Phase 3 — Manifeste + Virtualisierung
- `CaptureManifest`-Typ; volle Details lazy per captureKey.
- `@tanstack/react-virtual` für Ergebnisliste.
- Aggregierte Filteroptionen inkrementell.

## Phase 4 — Web Worker
- `lib/workers/compute.worker.ts` + Comlink.
- Auslagern: CSV, ZIP-Manifest, große Filter/Sort, Calendar-Aggregate, Scan-Log-Rekonstruktion.
- `useComputeWorker()` mit Main-Thread-Fallback.

## Phase 5 — Bundle/Hydration
- `landing-sections.tsx`: Server-Component-Teil + kleine Client-Inseln.
- `next/dynamic` für große Dialoge/Export.
- `@next/bundle-analyzer` Vorher/Nachher.

## Sequenzierung
0 → (1+2) → 3 → 4 → 5. Phase 5 parallel möglich.

## Runde 2 — Weitere Geschwindigkeit (alle ✅, im Browser verifiziert)
- ✅ **#1 IndexedDB-Connection-Reuse**: eine gecachte `IDBDatabase` statt open/close pro
  Transaktion (`lib/capture-store.ts`, `releaseDb`/`resetDbCache`, onversionchange/onclose).
  Browser-Messung: `indexeddb-open` **49 → 1** pro Session.
- ✅ **#2 History zweistufiges Laden**: `listRecentHistorySummaries(limit)` liest die neueste
  Seite über den `owner_updatedAt`-Index (Cursor, prev) für schnelles First Paint; die volle
  Liste lädt im Hintergrund nach (`fullHistoryLoadedRef`-Guard). Alle Client-Filter/Sort/Suche/
  Export bleiben erhalten. Verifiziert: `history-summary-load-recent` + `-load` laufen beide.
- ✅ **#3 CSV im Worker**: `"csv"`-Op im compute.worker + `computeCsv` (Fallback). Gemeinsame
  `lib/csv.ts` (`escapeCsvCell`/`rowsToCsv`). Verifiziert: Export CSV → Worker `messages:1`.
- ✅ **#4 Echte Virtualisierung**: `@tanstack/react-virtual` (pnpm-Mismatch via `npx pnpm@latest`
  gelöst), `components/virtualized-capture-list.tsx` mit `useWindowVirtualizer` + dynamischer
  Messung; Client-Pagination der Listenansicht entfernt (Pagination/getPageRange/pagedCaptures
  gelöscht). Verifiziert: `div[data-index]`, absolute Positionierung, keine Pagination-Nav.
- ✅ **#5 WARC-Prefetch on hover**: `lib/warc-prefetch.ts` (dedupe, HTML-only, Cache-Setting-Gate,
  best-effort) an Capture-Row-`onMouseEnter/onFocus` (150ms Debounce). Verifiziert: Hover feuert
  `loadCaptureRecord` → WARC-Fetch nach Debounce.

Nicht angefasst (bewusst): statisches Rendering (durch CSP-Nonce blockiert), weiteres Zerschneiden
von `archive-search-app.tsx`.

## Runde 3 — Render/Reads (alle ✅, im Browser verifiziert)
- ✅ **`React.memo(CaptureRow)`** mit Comparator auf `captureKey` + gerenderten Feldern (`components/capture-row.tsx`):
  Scan-Progress-Ticks rendern nicht mehr jede sichtbare Row neu. Verifiziert: Sortierung reordnet
  weiterhin korrekt (Memo bricht Updates nicht).
- ✅ **In-Memory-Caches für Settings UND lokalen User** (`lib/capture-store.ts`): `getSettings` und
  `getOrCreateLocalUser`/`activeOwnerId` cachen normalisierte Settings bzw. den `LocalUser`;
  Invalidierung bei `writeSettings`/`updateLocalUser` (same-tab) und über den `BroadcastChannel`
  (cross-tab, keys `settings`/`clear-all`/userId). Browser-Messung: Hovern von 9 Rows erzeugte
  vorher je **9 `settings`- und 9 `users`-Reads**, jetzt **0/0** (nur der legitime `htmlCaptures`-
  Cache-Lookup bleibt). Wichtige Erkenntnis aus der Verifikation: die dominante Read-Quelle war
  `getOrCreateLocalUser` (via `activeOwnerId`), nicht `getSettings` — daher beide gecacht.
