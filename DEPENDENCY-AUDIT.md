# Dependency audit

Audited on 2026-10-14 with pnpm 10.33.2 using `pnpm audit --prod`.

The baseline production audit reported 30 findings. The production dependency
set was updated to current compatible releases, including Next.js 16.4.0,
React 19.3.1, and Tailwind CSS 4.3.3. The lockfile now resolves patched
PostCSS, sharp, and related packages. Two transitive packages still fell below
their patched versions after the direct upgrades, so pnpm overrides keep
`baseline-browser-mapping` at 2.11.0 or later and `source-map-js` at 1.2.2 or
later. Both ranges satisfy their consumers' declared semver ranges.

Final result: `pnpm audit --prod` reports no known vulnerabilities. This is a
point-in-time registry audit; rerun it as part of future dependency updates.
