// How tall the accounts page's account strip stood on this device — its tiles
// stretch to the tallest one, and how tall that is depends on the accounts'
// names (one that wraps to a second line makes them all taller) and the text
// size. The loading screen's strip takes this height, so the register under it
// doesn't move down when the page comes in (owner, 2026-10-20: "a big jump on
// going to the accounts page" — 23px at phone width). A small cookie, so the
// server draws the loading screen at it from the first paint.

export const BANK_STRIP_COOKIE = "bizh-bank-strip";

const MIN_PX = 60;
const MAX_PX = 400;

/** The cookie's value → px, or null when there's none (or it's nonsense). */
export function parseBankStripHeight(raw: string | null | undefined): number | null {
  const px = Number(raw);
  return Number.isFinite(px) && px >= MIN_PX && px <= MAX_PX ? Math.round(px) : null;
}

/** The style that hands the kept height to the loading screen's strip (BankSkeleton). */
export function bankStripStyle(raw: string | null | undefined): Record<string, string> | undefined {
  const px = parseBankStripHeight(raw);
  return px ? { "--bank-strip-h": `${px}px` } : undefined;
}

/** Keep the strip's height on this device (rewritten only when it changes). */
export function rememberBankStripHeight(px: number): void {
  if (typeof document === "undefined") return;
  const rounded = Math.round(px);
  if (rounded < MIN_PX || rounded > MAX_PX) return;
  const current = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${BANK_STRIP_COOKIE}=`))
    ?.slice(BANK_STRIP_COOKIE.length + 1);
  if (parseBankStripHeight(current) === rounded) return;
  document.cookie = `${BANK_STRIP_COOKIE}=${rounded}; path=/; max-age=${60 * 60 * 24 * 60}; samesite=lax`;
}
