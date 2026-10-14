# Crawlback

A Next.js webapp for searching URLs, hosts, and domains across public Common Crawl indexes and opening matching WARC captures in a local browser viewer. Positioned as a fallback archive: when the Wayback Machine has no capture, Crawlback helps recover what Common Crawl saw.

## Goals

- Query Common Crawl from the user's browser with exact URL, host, or domain matching.
- Check the current target site's `robots.txt` for Common Crawl's `CCBot` through the app server, avoiding browser CORS limits.
- Check the Common Crawl opt-out registry and surface likely exclusions before or during a scan.
- Search all collections returned by `https://index.commoncrawl.org/collinfo.json`.
- Store scan history, coverage, settings, and optional cached HTML locally in IndexedDB.
- Keep routes stable for future PastPage provider integration:
  - `/search?url=https://example.com/page`
  - `/view?url=...&timestamp=...&collection=...&filename=...&offset=...&length=...`
- Render extracted HTML in a sandboxed preview without attempting full Wayback-style asset reconstruction.

## Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` creates a server-capable Next.js build. Deploy it on a runtime that supports Next.js route handlers.

## Public deployment

Crawlback runs without accounts, authentication services, or analytics. No API
keys or environment variables are required. Search history, settings, and cached
captures stay in the user's browser.

Deploy the server-capable Next.js build with `pnpm build` and `pnpm start`.
The server is needed for the robots.txt checks and public archive metadata APIs.
The app still accesses Common Crawl and the published opt-out registry to provide
archive search. It does not send usage events to a tracking service.

After deploying, verify that `/`, `/search`, `/history`, `/settings`, and `/view`
open without a login, and that the API endpoints work without a session.
API request limits, SSRF protection, and the sandboxed capture viewer remain active.

## Privacy and legal information

The interface and legal pages are in English. `/how-it-works` explains the
research workflow; `/privacy` describes browser storage, search requests, and
technical access data; `/terms` contains the terms of use; `/imprint` provides
the operator's contact information and postal address as a local image.
`/impressum` redirects to `/imprint`. The privacy notice describes Vercel
hosting.

Crawlback's own code sets no cookies and uses no advertising or analytics
tracking. Before app routes that use browser storage load, visitors can choose
**Allow browser storage** or **No thanks**. App features remain disabled until
storage is explicitly allowed. A minimal versioned consent record is saved in
local storage only after the visitor allows it; declining is remembered only in
memory for the current session. Read-only information pages remain available
without allowing storage. The footer's **Website settings** control can reopen
the choice or withdraw consent. Withdrawal disables app storage features,
unregisters service workers, and deletes Crawlback Cache Storage caches. It does
not delete saved IndexedDB data or other app local-storage data; browser site-data
controls can be used to remove those remaining items.

## Opt-out Registry

The Common Crawl opt-out registry is fetched live from the published Google Sheet and cached by the app. A bundled snapshot is also stored at `data/common-crawl-opt-out-registry-snapshot.csv` so the app can still answer opt-out checks if the sheet is temporarily unavailable.

Refresh the bundled snapshot with:

```bash
pnpm refresh:opt-out-registry
```

## Current Limits

- Searches exact URLs, hosts, or domains, but does not crawl links from the target page.
- Retains HTML `200` captures and redirects from the Common Crawl index response.
- Does not rewrite or replay page assets.
- Does not execute archived JavaScript.
- Does not automatically load compressed WARC records larger than 15 MB.
- Stores data locally only; there is no account sync, team workspace, hosted job queue, or billing layer yet.
