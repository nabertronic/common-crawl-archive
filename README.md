# Crawlback

Find and open archived versions of web pages from Common Crawl, a fallback for when the Wayback Machine has no capture.

Live site: https://crawlback.vercel.app

## Features

- Search an exact URL, a host, or a domain across the public Common Crawl indexes.
- Search all collections by default, only recent collections, or a custom date range.
- Check the target site's `robots.txt` for Common Crawl's `CCBot` user agent.
- Check the Common Crawl opt-out registry and flag likely exclusions before or during a scan.
- Open matching captures in a sandboxed local viewer. Archived scripts do not run.
- Keep scan history, results, coverage, and settings in the browser (IndexedDB).
- Optionally cache captured HTML locally, with size limits and manual pruning.
- Export history as CSV or JSON, and export captures as JSON, ZIP (HTML), or WARC.

## Privacy

- No accounts, no sign-in, and no analytics or tracking scripts.
- Search history, settings, and cached captures stay in your browser. They are not synced to a server.
- Crawlback's own code sets no cookies. Browser storage is only used after you choose "Allow browser storage".
- Archive queries are sent from your browser directly to Common Crawl's index and data servers.
- The robots.txt check and the opt-out registry lookup go through the Crawlback server. The robots.txt check sends your target URL to the target site's server, not your IP address.
- The hosting provider processes standard request data to deliver the site.

The full description is on the [privacy page](https://crawlback.vercel.app/privacy).

## How it works

- **Index search.** Crawlback reads the collection list from `index.commoncrawl.org/collinfo.json` and queries each selected collection's CDX index. Matching captures are then read from Common Crawl's WARC files in `data.commoncrawl.org`, using byte ranges from the index.
- **Respecting site owners.** The `robots.txt` check and the opt-out registry lookup are shown before and during a scan. The registry is fetched from the published Common Crawl sheet, with a bundled snapshot as a fallback.
- **Sandboxed viewer.** Archived HTML is shown in an iframe with an empty `sandbox` attribute, so scripts, forms, and same-origin access are disabled. HTML is also sanitized as defense in depth.
- **Server-side protection.** Every server-side fetch of a user-supplied URL goes through an SSRF guard. It allows only HTTP(S) on ports 80 and 443, blocks private, loopback, and link-local addresses, pins the connection to the validated address, re-checks every redirect, and caps response size and time.
- **Rate limits.** API routes apply per-client request limits. Common Crawl requests are spaced out to avoid rate-limit responses.

For the security model and the invariants that must be preserved, see [SECURITY.md](SECURITY.md).

## Current limits

- Searches exact URLs, hosts, or domains. It does not crawl links from the target page.
- Keeps HTML `200` captures and redirects returned by the index.
- Does not rewrite or replay page assets, and does not execute archived JavaScript.
- Does not automatically load compressed WARC records larger than 15 MB.
- Data is stored in the browser only. There is no sync, team workspace, or hosted job queue.

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) and React
- TypeScript
- Tailwind CSS
- Vitest and Testing Library for tests

## Getting started

### Requirements

- Node.js 24 to 26 (see `engines` in `package.json`)
- pnpm 10.33.2 (see `packageManager` in `package.json`)

### Run locally

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

### Checks and build

```bash
pnpm typecheck   # TypeScript
pnpm test        # Vitest
pnpm build       # production build
pnpm start       # serve the production build
```

`pnpm build` creates a server-capable Next.js build. The app needs a runtime that supports Next.js route handlers, because the robots.txt check and the opt-out and collections APIs run on the server.

### Maintenance scripts

```bash
pnpm refresh:opt-out-registry   # refresh the bundled opt-out registry snapshot
pnpm benchmark:cdx              # benchmark CDX scanning
```

## Deployment

Crawlback needs no environment variables and no API keys. Deploy the Next.js build on any host that runs Next.js server code. The reference deployment runs on Vercel.

After deploying, check that `/`, `/search`, `/history`, `/settings`, and `/view` load without a login.

The optional variable `TRUST_CLOUDFLARE_HEADERS=1` should only be set when Cloudflare sits in front of the app and overwrites `cf-connecting-ip`. See `.env.example` and [SECURITY.md](SECURITY.md).

## Project structure

- `app/` - Next.js routes (`/search`, `/view`, `/history`, `/settings`, legal pages) and API routes under `app/api/`
- `components/` - UI components
- `lib/` - Common Crawl client, WARC parsing, robots.txt handling, opt-out registry, SSRF guard, storage, and exports
- `lib/workers/` - compute worker
- `public/sw.js` - service worker for background scans
- `proxy.ts` - per-request Content-Security-Policy
- `data/` - bundled opt-out registry snapshot
- `scripts/` - maintenance and benchmark scripts
- `tests/` - unit and component tests

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run:

```bash
pnpm typecheck
pnpm test
```

Changes to network code, the proxy, the HTML preview, or response headers should follow the checklist in [SECURITY.md](SECURITY.md).

## Security

Please do not report vulnerabilities in public issues. Report them privately as described in [SECURITY.md](SECURITY.md#reporting-a-vulnerability). That file also describes the security architecture and the invariants that changes must preserve.

## Acknowledgements

Crawlback uses data from [Common Crawl](https://commoncrawl.org/), a nonprofit that publishes open web crawl data. The archived content belongs to its respective owners. Use of Common Crawl data is subject to Common Crawl's terms of use. Crawlback is an independent project.

## License

Copyright (C) 2026 Alexander Nabert.

Crawlback is licensed under the GNU Affero General Public License, version 3 only (AGPL-3.0-only). See [LICENSE](LICENSE).

If you run a modified version of Crawlback as a network service, the AGPL requires you to offer the source code of your modified version to the users who interact with it (section 13).
