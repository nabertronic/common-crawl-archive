/**
 * Ledger-only decoration for the landing hero: slowly drifting red and cool
 * glows. Purely ornamental; hidden outside the ledger theme and below md.
 * Styling and motion live in app/theme-ledger.css.
 * Render inside a `relative` hero wrapper; it fills that box and clips itself.
 */
export function HeroStamp() {
  return (
    <div aria-hidden className="ledger-hero-stamp absolute inset-0 hidden overflow-hidden pointer-events-none -z-10 ledger:md:block">
      <div className="ledger-hero-stamp__glow" />
      <div className="ledger-hero-stamp__cool-glow" />
    </div>
  );
}
