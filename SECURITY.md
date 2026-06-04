# Security Architecture

This document explains the security controls in this codebase and the invariants
you (a human or AI agent) must preserve when changing it. Read it before touching
network code, the proxy/middleware, the HTML preview, or response headers.

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

**Why:** `app/api/robots/route.ts` takes a `url` query param from anyone and
fetches it on the server. Without guarding, an attacker sends
`?url=http://169.254.169.254/…` (cloud metadata), `http://localhost:6379/…`
(internal services), or a public host that **redirects** to an internal one.

**Control:** every server-side fetch of a user-influenced URL MUST go through
`safeFetch()`. It enforces, in order:

1. **Scheme allowlist** — only `http:` / `https:`. Blocks `file:`, `gopher:`, etc.
2. **DNS resolution + address validation** — the host is resolved and **every**
   returned address is checked against private/loopback/link-local/reserved
   ranges (`isBlockedAddress`). Literal-IP hosts are checked without DNS.
3. **Connection pinning (anti DNS-rebinding)** — the socket is pinned to the
   exact address that was validated, via node's `http`/`https` `lookup` option.
   Host header and TLS SNI keep the original hostname so certificates still
   validate. This closes the TOCTOU window between "validate" and "connect".
4. **Manual redirect re-validation** — redirects are followed manually
   (`MAX_REDIRECTS`), and **each hop is re-run through steps 1–3**. A public
   host cannot bounce the request to an internal one.

**Invariants — do not break these:**

- Never call bare `fetch()` / `node:http` / `node:https` on a URL whose host can
  be influenced by request input. Route it through `safeFetch`.
- Do not add `redirect: "follow"` or otherwise auto-follow redirects around the
  guard. Redirect handling lives inside `safeFetch` on purpose.
- If you extend the blocklist, keep both the IPv4 CIDR table and the IPv6 checks
  in sync, and remember IPv4-mapped IPv6 (`::ffff:a.b.c.d`).
- `SsrfError` messages are user-safe (no resolved addresses); keep them that way.

**The injectable `transport` param** exists only for tests — production always
uses the pinned node transport. Do not wire a test transport into a route.

**Tests:** `tests/safe-fetch.test.ts` (ranges, scheme/IP/redirect blocking,
pinning), `tests/robots-route.test.ts` (route refuses private hosts).

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
| `script-src` | adds `'unsafe-eval'` in **dev only** | Next HMR needs it; never in production (`NODE_ENV === "production"` gate). |

**If you add a new external origin the browser talks to, add it to
`connect-src`** — and verify in a real browser (see §5). Do not add
`'unsafe-inline'`/`'unsafe-eval'` to `script-src` to "make something work";
that defeats the whole control.

**Tests:** `tests/proxy.test.ts` (directives, nonce uniqueness, dev/prod
`unsafe-eval`, nonce forwarded to the app).

---

## 3. Static security headers — `next.config.ts`

Applied to every response (no nonce needed): `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Strict-Transport-Security`, `Permissions-Policy` (camera/mic/geo/FLoC off),
`X-DNS-Prefetch-Control: off`. The full CSP lives in `proxy.ts`, **not** here —
keep them separate so there is exactly one CSP header.

---

## 4. Rendering untrusted archived HTML — `lib/warc.ts` + `components/capture-viewer-app.tsx`

**The real control is the sandboxed iframe**, not the regex. The preview renders
archived HTML via `<iframe sandbox="" srcDoc={…}>`. `sandbox=""` (empty value)
disables scripts, same-origin access, form submission and top-level navigation,
so even if malicious markup survives, it cannot execute.

`sanitizeHtmlForPreview()` is **defense-in-depth only**: it strips
`<script>/<iframe>/<object>/<embed>/<base>`, src/href-style attributes, inline
event handlers (incl. `/`-separated and unquoted forms), and `javascript:`/
`vbscript:` URIs in attribute positions. Regex HTML sanitization is fundamentally
incomplete — **never remove the `sandbox=""` and lean on the regex**, and never
introduce `dangerouslySetInnerHTML` for archived content.

**Invariants:**
- The preview iframe keeps `sandbox=""` (empty). Adding tokens like
  `allow-scripts allow-same-origin` re-enables XSS — don't.
- Archived/remote URLs are never used directly as `href`/`src` in the main app;
  links go through internal `/view`, `/search`, `/history` routes.

**Tests:** `tests/warc.test.ts` (handler/attribute/scheme stripping, element removal).

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
