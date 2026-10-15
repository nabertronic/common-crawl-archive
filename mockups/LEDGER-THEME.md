# Ledger theme: implementation brief

The experimental "ledger" theme is the redesign shown in the static mockups in this folder
(`index.html`, `landing.html`, `search.html`, `viewer.html`, `history.html`, `settings.html`, `mockup.css`).
It ships next to the existing dark "classic" theme. Users switch with the floating Theme switch
(`components/theme-switcher.tsx`) or with `?theme=ledger` in the URL.

## How the theme system works

- `<html data-theme="classic|ledger">` is set before first paint by `THEME_BOOTSTRAP_SCRIPT` (`lib/theme.ts`).
- `app/theme-ledger.css` **remaps Tailwind colour tokens** under `[data-theme="ledger"]`. Every existing
  utility class is recoloured automatically. Do not add `ledger:` classes just to recolour things.
- `ledger:` is a Tailwind custom variant (`app/globals.css`). It applies a utility only in the ledger theme.
  Use it for anything that should *look different* (type, radius, borders, shadows, spacing, layout).
- Both themes render **the same DOM**. Never branch JSX on the theme in JS. To show something only in one
  theme, use CSS: `hidden ledger:block` (ledger only) or `ledger:hidden` (classic only).

### Token cheat sheet (what a class means in ledger)

| class | classic | ledger |
|---|---|---|
| `zinc-50`, `zinc-100`, `white` | brightest text | **ink** `#17150f` |
| `zinc-300` | secondary text | ink-2 `#4b463b` |
| `zinc-400`, `zinc-500` | muted text | ink-3 `#5a5447`/`#6e685a` |
| `zinc-600`, `zinc-700` | borders/disabled | rule-strong `#a99f86` / `#c4bba4` |
| `zinc-800` | border | rule `#d3cbb6` |
| `zinc-900` | raised surface | paper-2 `#ebe5d5` |
| `zinc-950` | darkest surface | **card** `#fbf9f3` |
| `amber-300/400` | accent | **stamp red** `#c4321a` |
| `amber-100/200` | accent text | dark stamp red |
| `red-*`, `emerald-*`, `sky-*` | status | darkened for text on paper |

So an **ink button** in ledger is `ledger:bg-zinc-50 ledger:text-zinc-950 ledger:border-zinc-50`, and
a **stamp-red** element is `ledger:bg-amber-300 ledger:text-zinc-950`.

### Ready-made classes (`app/theme-ledger.css`)

- `ledger-label`: sans, 13px, bold, sentence case, ink-3. For table heads and field names only.
  Only use it inside `ledger:`-only markup, or in a `className` you add only for ledger elements.
- `font-serif` = Instrument Serif. Use `ledger:font-serif ledger:font-normal` for headlines and big numbers.

### Cascade gotcha

Hand-written classes in `globals.css` (`archive-panel`, `landing-mini-header`, `landing-glow-card`,
`menu-popover`, `landing-scroll-top`, `history-grid`) and their ledger overrides in `theme-ledger.css`
are **unlayered**, so they beat any layered Tailwind utility. To override border, background,
box-shadow or backdrop-filter on such an element, use the important form: `ledger:!border-0`,
`ledger:!bg-transparent`, `ledger:!shadow-none`. Padding, radius, type and other properties work as usual.

## Visual rules (from the mockups)

1. **Type.** Headlines and large numbers: `ledger:font-serif ledger:font-normal ledger:tracking-[-0.02em]`
   and usually larger than classic. Italic serif + stamp red for one emphasised word (`<em>` styled
   `not-italic` in classic, `ledger:italic ledger:text-amber-300`). Body stays Atkinson Hyperlegible Next.
   URLs, dates and data stay mono. Labels are sans, sentence case, normal tracking.
2. **Shape.** Square corners: `ledger:rounded-[3px]` for controls, `ledger:rounded-none` for panels and rules.
   Pills only for the theme switch.
3. **No glow.** Remove coloured shadows, blur and glow: `ledger:shadow-none ledger:backdrop-blur-none`.
   Allowed depth: hard offset shadow `ledger:shadow-[6px_6px_0_rgba(23,21,15,0.08)]`.
4. **Rules over boxes.** Prefer 1px rules (`border-zinc-800`) and a 1.5px ink rule (`ledger:border-zinc-50`)
   under section headings. Tables and lists are ledgers: rows separated by hairlines.
5. **Primary actions** are ink (`ledger:bg-zinc-50 ledger:text-zinc-950`), hover turns stamp red
   (`ledger:hover:bg-amber-300 ledger:hover:border-amber-300`). Secondary buttons are outlined ink.
   Danger is outlined stamp red.
6. **Stamp red is rare.** Use it for the one thing that matters on screen: the active state, the selected
   capture, a date stamp, the emphasised headline word.
7. **Motion.** Keep it restrained: one entrance per page. Respect `prefers-reduced-motion`.

## Avoid generic "AI design" tells

The ledger theme should read like an edited publication, not a template. In ledger-only styling:

- **No eyebrows or kickers.** No small label above a heading ("Common Crawl archive search",
  "Scan target", "Capture record", "Stored in this browser only", "Request · new scan", "§ 01 · Method").
  A heading stands on its own. If the label carried real information, fold it into the heading or the
  sentence below it.
- **No all-caps with wide letter-spacing.** Labels, table heads, legends, buttons and nav are sentence
  case with normal tracking: `ledger:normal-case ledger:tracking-normal`. Where a classic class adds
  `uppercase`/`tracking-[…]`, neutralise it with those ledger utilities. Exception: HTTP status codes.
- **Mono only for data.** URLs, timestamps, digests, collection ids, counts in tables. Labels, legends,
  nav and buttons use the sans face: `ledger:font-sans`.
- **No section numbering or decorative symbols:** no "§", no "01/02/03" numbers next to nav items or
  headings, no "// " prefixes, no "→ " decorations in labels.
- **No middle-dot chains** ("A · B · C") in labels. Write a short phrase instead.
- **Accent word in italic red at most once per page** (the landing hero). Other headings are plain.
- **Status words, not slogans.** Prefer "Sandboxed: scripts and external requests are blocked" over
  "Sandboxed · scripts off · no external requests".

## No paper metaphor (decided 15 Oct 2026)

The first draft imitated paper: beige grain, ruled index cards, rubber date stamps, hatched
backgrounds, hard offset "paper" shadows. That is gone. The theme is now a plain, neutral light UI:
white cards on a very light grey page, near-black text, cool greys, one red accent.

- No textures, grain, ruled lines, hatching or diagonal stripes as decoration.
- No rubber stamps, rotated labels, index-card tabs or margin lines.
- No hard offset shadows (`shadow-[6px_6px_0_…]`). Flat surfaces with 1px borders. Overlays
  (menus, dialogs, popovers) may use one soft shadow: `ledger:shadow-[0_10px_30px_rgba(20,20,22,0.08)]`.
- No decorative pseudo-data (e.g. a bar strip that "represents" crawls under the hero).
- Copy: no "It's not X, it's Y" / "isn't X. It's Y." constructions or struck-through words. Say the
  plain thing ("Find archived versions of web pages.").

## Hard constraints for every change

- Do **not** change or remove existing classic classes, behaviour, props, state, text content,
  `aria-*` attributes, roles, or test ids. Only **add** `ledger:` utilities or ledger-only elements.
- Do not duplicate an existing visible text string in a new ledger-only element. Tests use `getByText`
  and would find two matches. New ledger-only copy must use different wording, or be decorative and
  `aria-hidden="true"` *and* still a different string.
- Keep accessibility: contrast ≥ 4.5:1 for text, visible focus (`focus-visible:outline` stays; in ledger
  the outline colour is stamp red automatically), touch targets ≥ 44px where they were before.
- Do not touch `lib/` logic, API routes, `proxy.ts`, tests, or files owned by another agent.
- After editing, run `pnpm typecheck` and the related tests (`pnpm vitest run tests/<file>.test.tsx`).
