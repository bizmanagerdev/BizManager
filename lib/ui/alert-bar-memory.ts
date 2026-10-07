import type { AlertLevel } from "@/lib/reminders/alert-bar";

// The alert strip under the top bar (components/reminders/AlertBar) only knows
// what to show once its alerts arrive — a moment after the page — and it then
// pushed the whole page down by its height (phone layout shift on /projects,
// /sales and a project's page, 2026-10-07). So each section's strip is
// remembered on the device as it last stood (its level and count) in a small
// cookie: the server draws it from the very first paint, and the real one takes
// its place without moving anything. A section whose strip has gone (nothing
// left, or closed) is forgotten, so it doesn't hold an empty strip next time.

export const ALERT_BAR_MEMORY_COOKIE = "bizh-alertbar";

export type RememberedAlertBar = { level: AlertLevel; count: number };

const LEVELS: ReadonlySet<string> = new Set(["danger", "warning", "info"]);
const MAX_ENTRIES = 16;

/** The cookie's value → section → its strip as it last stood. */
export function parseAlertBarMemory(raw: string | null | undefined): Record<string, RememberedAlertBar> {
  const bars: Record<string, RememberedAlertBar> = {};
  if (!raw) return bars;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // Not encoded.
  }
  for (const part of text.split(",")) {
    const [module, level, count] = part.split(".");
    const n = Number(count);
    if (module && /^[a-z0-9-]+$/.test(module) && LEVELS.has(level ?? "") && Number.isInteger(n) && n > 0 && n < 1000) {
      bars[module] = { level: level as AlertLevel, count: n };
    }
  }
  return bars;
}

/** Remember section `module`'s strip as it stands now (null: none). Browser only. */
export function rememberAlertBar(module: string, bar: RememberedAlertBar | null): void {
  if (typeof document === "undefined" || !/^[a-z0-9-]+$/.test(module)) return;
  const current = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${ALERT_BAR_MEMORY_COOKIE}=`))
    ?.slice(ALERT_BAR_MEMORY_COOKIE.length + 1);
  const bars = parseAlertBarMemory(current);
  const before = bars[module];
  if (bar ? before?.level === bar.level && before.count === bar.count : !before) return;
  delete bars[module];
  if (bar) bars[module] = bar;
  const value = Object.entries(bars)
    .slice(-MAX_ENTRIES)
    .map(([m, b]) => `${m}.${b.level}.${b.count}`)
    .join(",");
  document.cookie = value
    ? `${ALERT_BAR_MEMORY_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
    : `${ALERT_BAR_MEMORY_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
