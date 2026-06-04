# Crawlback

A Next.js webapp for searching individual URLs across every public Common Crawl index and opening matching WARC captures in a local browser viewer. Positioned as a fallback archive: when the Wayback Machine has no capture, Crawlback brings the page back from Common Crawl.

## Goals

- Query Common Crawl from the user's browser.
- Check the current target site's `robots.txt` for Common Crawl's `CCBot` through the app server, avoiding browser CORS limits.
- Search all collections returned by `https://index.commoncrawl.org/collinfo.json`.
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

## MVP Limits

- Searches the exact URL only.
- Shows HTML captures with status `200`.
- Does not rewrite or replay page assets.
- Does not execute archived JavaScript.
- Does not automatically load compressed WARC records larger than 15 MB.
