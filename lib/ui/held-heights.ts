// How tall each dashboard card last stood on this device's phone layout —
// so its loading placeholder takes exactly that height and the card fills a
// box already the right size, instead of every card that loads pushing the
// ones below it down (the "jumpy" phone dashboard; desktop has fixed cells and
// never moved). Kept in a small cookie, so the server draws the placeholders
// at those heights from the very first paint.

export const HELD_HEIGHTS_COOKIE = "bizh-held";

/** Below this width the board is a plain stack of natural-height cards (DashboardSections). */
export const HELD_HEIGHTS_MAX_WIDTH = 1280;

/**
 * Each card's usual height on a phone (the owner's board, 2026-10-07) — the
 * placeholder's height on a device that hasn't kept its own yet, so even the
 * very first opening lands close to right instead of 64px boxes that every
 * card then pushes down.
 */
export const USUAL_HELD_HEIGHTS: Readonly<Record<string, number>> = {
  todaySchedule: 196,
  activityDigest: 196,
  todayAlerts: 200,
  myTasks: 272,
  deliveries: 380,
  payments: 360,
  collections: 300,
  attendanceQueue: 344,
  properties: 260,
  domainChart: 388,
  workerShift: 180,
};

const MIN_PX = 40;
const MAX_PX = 2000;
const MAX_ENTRIES = 24;

/** The cookie's value → card id → height (px). */
export function parseHeldHeights(raw: string | null | undefined): Record<string, number> {
  const heights: Record<string, number> = {};
  if (!raw) return heights;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // Not encoded.
  }
  for (const part of text.split(";")) {
    const [id, value] = part.split(":");
    const px = Number(value);
    if (id && /^[A-Za-z0-9_-]+$/.test(id) && Number.isFinite(px) && px >= MIN_PX && px <= MAX_PX) heights[id] = px;
  }
  return heights;
}

function serialize(heights: Record<string, number>): string {
  return Object.entries(heights)
    .slice(-MAX_ENTRIES)
    .map(([id, px]) => `${id}:${px}`)
    .join(";");
}

/** Remember card `id`'s height on this device (phone layout only; rounded, so tiny changes don't rewrite the cookie). */
export function rememberHeldHeight(id: string, px: number): void {
  if (typeof document === "undefined" || window.innerWidth >= HELD_HEIGHTS_MAX_WIDTH) return;
  const rounded = Math.round(px / 4) * 4;
  if (rounded < MIN_PX || rounded > MAX_PX || !/^[A-Za-z0-9_-]+$/.test(id)) return;
  const current = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${HELD_HEIGHTS_COOKIE}=`))
    ?.slice(HELD_HEIGHTS_COOKIE.length + 1);
  const heights = parseHeldHeights(current);
  if (heights[id] === rounded) return;
  delete heights[id];
  heights[id] = rounded;
  document.cookie = `${HELD_HEIGHTS_COOKIE}=${encodeURIComponent(serialize(heights))}; path=/; max-age=${60 * 60 * 24 * 60}; samesite=lax`;
}
