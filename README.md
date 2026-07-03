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
