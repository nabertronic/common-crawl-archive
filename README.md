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

## Private beta deployment

Crawlback is configured as an invite-only Clerk application. All app pages and
route handlers require a valid Clerk session; `/sign-in` is the sole public app
page. The app never renders a sign-up component.

Before deploying, create a separate **Clerk Production** instance and complete
these dashboard steps:

1. In **Restrictions**, enable **Restricted mode**. Create every beta account
   manually in Clerk; do not use the waitlist or public sign-up mode.
2. Configure the beta domain (for example `beta.example.com`) as the only
   production origin and redirect URL. Keep local development origins in the
   development Clerk instance, not in the production instance.
3. In Vercel, add the four values from `.env.example` to **Production** and
   Preview as appropriate. The secret key belongs in Vercel only and must never
   be committed. Use Clerk's verified `clerk.<domain>` CNAME for the Frontend
   API rather than proxying authentication through the app.
4. Protect Preview deployments with Vercel Authentication. Testers should use
   the fixed beta domain and Clerk, not random Preview URLs. If the Vercel plan
   includes Password Protection and an additional shared gate is wanted, enable
   it for production as well.

After each deploy, verify in an incognito browser that every page redirects to
sign-in and that each `/api/*` endpoint returns a non-cacheable `404` without a
session. Then sign in with one manually created Clerk account and repeat the
three API checks. A public URL or JavaScript bundle cannot be made secret on the
web; the security boundary is the authenticated server response, not obscurity
of a path name.

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
