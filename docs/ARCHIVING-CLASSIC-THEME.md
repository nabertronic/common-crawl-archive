# Archiving the classic theme

The app now ships only the "ledger" theme (`<html data-theme="ledger">`, set statically in `app/layout.tsx`). The old dark "classic" theme and the theme switcher live on in git history only.

## Steps (run before committing the ledger-only changes)

```sh
git branch archive/classic-theme HEAD   # HEAD = last commit that still has classic
git push origin archive/classic-theme
# optional tag
git tag classic-theme-final HEAD
git push origin classic-theme-final
```

Note: the theme work is currently uncommitted. To archive a working classic switcher, commit it first (or archive that commit), then make the ledger-only changes in a separate commit.

`vercel.json` sets `git.deploymentEnabled` to `false` for `archive/*` and `classic-theme*`, so Vercel will not build those branches. Optionally protect the branch on GitHub (Settings > Branches) and mention the archive in the repo description.

## Leftover classic styles

Classic-only CSS (`.terminal-*`, `.landing-scanlines`, glow/phosphor effects, amber base colours, dark `--background` in `app/globals.css`) is still the base layer that `app/theme-ledger.css` and the `ledger:` variant override. It can be pruned in a follow-up.
