# Security Architecture

This document explains the security controls in this codebase and the invariants
you (a human or AI agent) must preserve when changing it. Read it before touching
network code, the proxy/middleware, the HTML preview, or response headers.

## Public access and local data

All app pages and API routes are publicly accessible without an account.
Search history, settings, and cached captures are stored in the user's browser;
there is no server-side account data or analytics integration.

API routes retain per-client IP request limits and non-cacheable responses.
These in-memory limits apply per server instance, not globally across deployments.

Client identity for those limits comes from `x-real-ip` (set by Vercel), then the
first entry of `x-forwarded-for`, and otherwise a shared `local` bucket.
`cf-connecting-ip` is **not** trusted by default: Vercel neither sets nor overwrites
it, so any client can rotate it per request to escape the limit. Set
`TRUST_CLOUDFLARE_HEADERS=1` only when the deployment is actually behind Cloudflare
and Cloudflare overwrites that header; it then takes precedence. Each limiter caps
retained buckets at 10,000; once full, new clients share a single overflow bucket
(fail-closed) instead of growing memory without bound.
The `robots` endpoint accepts the target as a JSON POST body rather than a URL
query parameter so the target is not put into the endpoint path or browser referrer.

## Threat model in one paragraph

This is a **client-heavy Next.js app** that deliberately handles **untrusted
remote content**: it lets a user point at an arbitrary URL, fetches that site's
`robots.txt` **server-side**, downloads archived pages (WARC records) from
Common Crawl **in the browser**, and renders that archived HTML back to the user.
The two dangerous surfaces are therefore (1) **server-side fetches of
user-influenced URLs** (SSRF) and (2) **rendering attacker-controlled HTML**
(XSS). Everything below exists to contain those two.

---

## 1. SSRF guard — `lib/safe-fetch.ts`

**Why:** `app/api/robots/route.ts` takes a `url` JSON body field from anyone and
fetches it on the server. Without guarding, an attacker sends
`{"url":"http://169.254.169.254/…"}` (cloud metadata), `http://localhost:6379/…`
(internal services), or a public host that **redirects** to an internal one.

**Control:** every server-side fetch of a user-influenced URL MUST go through
`safeFetch()`. It enforces, in order:

1. **Scheme and port allowlist** — only `http:` / `https:`, and only the default
   ports (80 / 443). Blocks `file:`, `gopher:`, etc., and port probing of internal
   services such as `http://host:6379/`. Checked on every redirect hop.
2. **DNS resolution + address validation** — the host is resolved and **every**
   returned address is checked against private/loopback/link-local/reserved
   ranges (`isBlockedAddress`). Literal-IP hosts are checked without DNS.
   IPv6 is parsed into its 16 bytes (handling `::` compression, `%zone` and
   dotted-quad tails), not matched by regex; unparseable input is blocked.
   IPv4-mapped (`::ffff:0:0/96`), IPv4-compatible (`::/96`) and 6to4
   (`2002::/16`) addresses are judged by their embedded IPv4 address. NAT64
   (`64:ff9b::/96`, `64:ff9b:1::/48`), `100::/64`, `2001::/23` (incl. Teredo),
   `2001:db8::/32`, `fc00::/7`, `fe80::/10`, `fec0::/10` and `ff00::/8` are blocked
   outright.
3. **Connection pinning (anti DNS-rebinding)** — the socket is pinned to the
   exact address that was validated, via node's `http`/`https` `lookup` option.
   Host header and TLS SNI keep the original hostname so certificates still
   validate. This closes the TOCTOU window between "validate" and "connect".
   The socket has a 10 s idle timeout, and every failure path (size cap,
   timeout, abort, socket error) rejects the promise.
4. **Manual redirect re-validation** — redirects are followed manually
   (`MAX_REDIRECTS`), and **each hop is re-run through steps 1–3**. A public
   host cannot bounce the request to an internal one.

**Invariants — do not break these:**

- Never call bare `fetch()` / `node:http` / `node:https` on a URL whose host can
  be influenced by request input. Route it through `safeFetch`.
- Do not add `redirect: "follow"` or otherwise auto-follow redirects around the
  guard. Redirect handling lives inside `safeFetch` on purpose.
- If you extend the blocklist, add IPv4 ranges to `IPV4_BLOCKED_RANGES` and IPv6
  ranges to `IPV6_BLOCKED_PREFIXES` (or `IPV6_EMBEDDED_IPV4` for ranges that carry
  an IPv4 address). Do not reintroduce string or regex matching of IPv6 forms:
  WHATWG URLs rewrite `::ffff:a.b.c.d` as `::ffff:xxxx:xxxx`.
- Keep the 80/443-only port check and the socket timeout. Both apply to every
  redirect hop because they live in `resolveAllowedTarget` and the node transport.
- `SsrfError` messages are user-safe (no resolved addresses); keep them that way.
- The pinned node transport caps buffered response bodies at `MAX_RESPONSE_BYTES`
  (2 MiB) and aborts past it. The target host is user-supplied, so never remove
  the cap — an unbounded body is a memory-exhaustion DoS.

**The injectable `transport` param** exists only for tests — production always
uses the pinned node transport. Do not wire a test transport into a route.

**Tests:** `tests/safe-fetch.test.ts` (IPv4/IPv6 ranges including hex-mapped and
NAT64/6to4 forms, scheme/port/IP/redirect blocking, pinning),
`tests/robots-route.test.ts` (route refuses private hosts and non-standard ports).

---

## 2. Content-Security-Policy — `proxy.ts` + `app/layout.tsx`

**Why:** defense-in-depth against XSS and data exfiltration.

**How it works (read this before editing either file):**

- `proxy.ts` generates a **fresh nonce per request** and sets the full CSP on
  both the forwarded request headers and the response.
- `script-src` uses `'nonce-…' 'strict-dynamic'`. With `strict-dynamic`, only
  nonced scripts (and what they load) run — host allowlists are ignored. So
  **every** framework `<script>` must carry the nonce.
- Next.js only stamps the nonce onto its scripts when the page is **dynamically
  rendered**. `app/layout.tsx` calls `await headers()` precisely to force that.
  **If you make the layout static again, `strict-dynamic` will block all
  scripts and the app goes blank.** This is the single most important CSP
  invariant.

**Allowances (each is required, not decorative):**

| Directive | Value | Reason |
|---|---|---|
| `style-src` | `'self' 'unsafe-inline'` | React `style={}` produces inline style attributes that a nonce cannot cover. Styles are not a script-execution vector. |
| `connect-src` | `'self' https://index.commoncrawl.org https://data.commoncrawl.org` | The browser fetches the Common Crawl index/data **directly**. Narrow this and search/preview break. |
| `frame-src` | `'self'` | Allows the sandboxed `srcdoc` preview iframe. |
| `manifest-src` | `'self'` | Web app manifest is same-origin only (explicit rather than relying on `default-src`). |
| `worker-src` | `'self' blob:` | Same-origin service worker and bundled compute worker; `blob:` for bundlers that instantiate workers from blob URLs. |
| `script-src` | adds `'unsafe-eval'` in **dev only** | Next HMR needs it; never in production (`NODE_ENV === "production"` gate). |

**Trusted Types (report-only).** `proxy.ts` also sends a separate
`Content-Security-Policy-Report-Only: require-trusted-types-for 'script'`
header. It is deliberately report-only and carries only this one directive:
React/Next DOM sinks have not been verified against Trusted Types, and an
enforcing policy would break the app silently. Violations are logged to the
console and reported to browsers' CSP reporting, not blocked. Promote it to an
enforcing header only after a prod-build check in a real browser (§5) shows
zero violations. There must still be exactly one **enforcing** CSP header.

**If you add a new external origin the browser talks to, add it to
`connect-src`** — and verify in a real browser (see §5). Do not add
`'unsafe-inline'`/`'unsafe-eval'` to `script-src` to "make something work";
that defeats the whole control.

**Tests:** `tests/proxy.test.ts` (directives incl. `manifest-src`, nonce
uniqueness, dev/prod `unsafe-eval`, nonce forwarded to the app, report-only
Trusted Types present and separate, exactly one enforcing CSP header).

---

## 3. Static security headers — `next.config.ts`

Applied to every response (no nonce needed): `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
`Permissions-Policy` (camera/mic/geo/FLoC off), `X-DNS-Prefetch-Control: off`,
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Resource-Policy: same-origin`. The full CSP lives in `proxy.ts`,
**not** here — keep them separate so there is exactly one enforcing CSP header.

**Invariants:**
- **Do not add `Cross-Origin-Embedder-Policy`.** COEP would block the
  cross-origin Common Crawl fetches (`index.commoncrawl.org`,
  `data.commoncrawl.org`) that the app depends on. COOP and CORP are safe
  because they only constrain this app's own documents and resources.
- `preload` on HSTS is a commitment: removing it later requires going through
  the HSTS preload list removal process. Only keep it if every subdomain is
  HTTPS-only.
- Do not set a second enforcing `Content-Security-Policy` here.

**Service worker prefetch (`public/sw.js`).** The worker accepts a
`scan:prefetch` message from a consented client and only fetches what it is
allowed to:
- URLs must parse as `https:` with hostname exactly `index.commoncrawl.org`;
  anything else (other hosts, `http:`, lookalike suffixes, non-strings) is
  dropped, so the worker cannot be used as an open fetch proxy.
- At most 500 URLs per message.
- `spacingMs` is clamped to 1000–60000 ms (default 1100 ms when missing or
  invalid), so a page cannot make the worker hammer the index.
- Consent gating (`consent:grant` / `consent:revoke`) is unchanged; a client
  that has not granted consent is ignored.

**Tests:** `tests/service-worker-consent.test.ts` (URL filter, cap, spacing
clamp, consent gating, cache expiry and caps).

---

## 4. Rendering untrusted archived HTML — `lib/warc.ts` + `components/capture-viewer-app.tsx`

**The real control is the sandboxed iframe**, not the regex. The preview renders
archived HTML via `<iframe sandbox="" srcDoc={…}>`. `sandbox=""` (empty value)
disables scripts, same-origin access, form submission and top-level navigation,
so even if malicious markup survives, it cannot execute.

`sanitizeHtmlForPreview()` is **defense-in-depth only**. It strips:
- elements: `<script>`, `<noscript>`, `<iframe>`, `<object>`, `<embed>`,
  `<base>`, `<meta>` (incl. `http-equiv="refresh"`), `<link>`, `<form>`/`</form>`
  tags (form content is kept), `<applet>`, `<frame>`, `<frameset>`;
- `@import` rules inside `<style>` blocks;
- src/href-style attributes (`src`, `srcset`, `href`, `xlink:href`, `action`,
  `formaction`, `poster`), whether quoted or unquoted;
- inline event handlers (incl. `/`-separated and unquoted forms);
- `style` attributes whose value contains `url(` or `expression(`, regardless
  of quote style;
- `javascript:`/`vbscript:` URIs in attribute positions.

Regex HTML sanitization is fundamentally incomplete — **never remove the
`sandbox=""` and lean on the regex**, and never introduce
`dangerouslySetInnerHTML` for archived content.

**Fetch bounds.** Archived bodies are read through `readBounded()`, which
enforces the byte limit and a 60 s total read timeout. The timeout and the
caller's abort both cancel the stream and reject the pending read, so a stalled
body cannot hang the viewer. Keep that behaviour when changing the reader.

**Invariants:**
- The preview iframe keeps `sandbox=""` (empty). Adding tokens like
  `allow-scripts allow-same-origin` re-enables XSS — don't.
- Archived/remote URLs are never used directly as `href`/`src` in the main app;
  links go through internal `/view`, `/search`, `/history` routes.

**Tests:** `tests/warc.test.ts` (handler/attribute/scheme stripping, element
removal, form/applet/frame/`@import`/style-url cases, stalled-body timeout and
caller abort).

---

## 5. How to verify CSP / preview changes in a browser

Unit tests cannot catch a CSP that silently blocks scripts. For any change to
`proxy.ts`, `app/layout.tsx`, `next.config.ts`, or the preview iframe:

1. `npx next build` (must keep all routes `ƒ` dynamic, not `○` static).
2. Start prod (`next start`) and load in a real browser.
3. Confirm **every** `<script>` has a `nonce` and `window.next` is defined
   (scripts executed → React hydrated).
4. Confirm no `securitypolicyviolation` / console errors, that an allowed
   `connect-src` origin (`index.commoncrawl.org`) succeeds, and a disallowed
   origin is blocked.

A `.claude/launch.json` (`prod` config) exists for the preview tooling.

---

## 6. Client-side trust boundaries

`localStorage` caches (robots results, opt-out registry, scan store) are treated
as **untrusted input**: every read is validated through a type guard
(`isRobotsCheckResult`, `isOptOutEntry`, …) and falls back safely on malformed
data. Preserve this — never `JSON.parse` a cache and use it without validation.

---

## Change checklist for agents

- [ ] New server-side fetch of a user-influenced URL → routed through `safeFetch`.
- [ ] New browser-side external origin → added to `connect-src` in `proxy.ts`.
- [ ] Layout still `await headers()` and all routes still render dynamically.
- [ ] Preview iframe still `sandbox=""`; no `dangerouslySetInnerHTML` for remote HTML.
- [ ] No `'unsafe-inline'`/`'unsafe-eval'` added to `script-src` (prod).
- [ ] localStorage reads still validated by a type guard.
- [ ] Tests added/updated; `npx vitest run` and `npx tsc --noEmit` green.
- [ ] CSP/preview changes verified in a real browser (§5).
