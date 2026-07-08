# Performance-Baseline

Die Messung läuft über die `crawlback:*` Performance-Measures (siehe `lib/performance.ts`)
und das Dev-Overlay `components/dev/perf-panel.tsx` (nur `NODE_ENV !== "production"`).

## So nimmst du eine Baseline auf
1. `npm run dev`, App im Browser öffnen.
2. Repräsentativen Flow durchspielen (Scan starten, History öffnen, Ergebnisliste
   filtern/sortieren, Export, Kalenderansicht, Capture-Viewer).
3. Unten rechts „⏱ perf" öffnen → `console.table` klicken → Werte notieren.
4. Werte in die Tabelle unten pro Phase eintragen (Vorher/Nachher).

## Erfasste Measures
| Measure | Ort | Erwartete Hotness |
| --- | --- | --- |
| `indexeddb-open` / `indexeddb-upgrade` | `lib/capture-store.ts` | Start |
| `history-summary-load` | `lib/capture-store.ts` | History-Reopen |
| `cdx-scan` | `lib/common-crawl.ts` searchCollections | Scan (netzgebunden) |
| `search-filter-sort` | `components/archive-search-app.tsx` | jede Filter/Sort-Änderung |
| `filter-options` | `components/archive-search-app.tsx` | Ergebnis-Render |
| `calendar-aggregate` | `components/calendar-view.tsx` | Kalender-Render |
| `csv-build` | search-/history-app | Export |
| `zip-build` | `lib/zip.ts` | HTML-ZIP-Export |
| `warc-parse` | `lib/warc.ts` | Capture-Viewer |

## Vorher/Nachher (p95, ms)
| Measure | Baseline | Phase 1/2 | Phase 3 | Phase 4 |
| --- | --- | --- | --- | --- |
| history-summary-load | | | | |
| search-filter-sort | | | | |
| filter-options | | | | |
| calendar-aggregate | | | | |
| csv-build | | | | |
| zip-build | | | | |

> Zahlen sind gerätespezifisch — jeweils auf demselben Rechner Vorher/Nachher messen.
