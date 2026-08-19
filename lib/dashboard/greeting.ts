// The dashboard's greeting line — "בוקר טוב, הוכהייזר 👋" over the full date,
// "יום שלישי, 18 באוגוסט 2026".
//
// It lives in the היום card's header (user, 2026-08-18), not in the top bar: the
// bar's title slot doesn't shrink to fit, and inside the card the greeting has a
// full-width line of its own.
//
// Both halves are computed from the VIEWER's clock, so a cached / PWA-restored
// page can't be stuck on בוקר טוב all afternoon or on yesterday's date. The card
// renders the server snapshot during SSR and swaps to the client value after
// hydration, which is why these are plain functions shared by both sides rather
// than two copies that drift apart.

/** The app's default clock when the viewer's own isn't knowable — i.e. the server. */
export const DEFAULT_TIME_ZONE = "Asia/Jerusalem";

/**
 * MORNING STARTS AT 04:00 (user, 2026-08-19). Between midnight and 04:00 it is
 * still "ערב טוב": someone up at 02:00 is at the end of a long evening, not at
 * the start of a new morning, and "בוקר טוב" at that hour reads as a machine
 * that only noticed the date changed.
 */
export function greetingForHour(hour: number): string {
  if (hour < 4) return "ערב טוב";
  if (hour < 12) return "בוקר טוב";
  if (hour < 18) return "צהריים טובים";
  return "ערב טוב";
}

/**
 * The hour on the VIEWER's clock. On the client that is simply their device, so
 * someone abroad gets their own morning rather than ours. On the SERVER there is
 * no viewer clock (it runs UTC), so the SSR snapshot falls back to Israel, where
 * all but the odd traveller is — without it the pre-hydration greeting is three
 * hours behind and visibly flips after hydration.
 */
export function viewerHour(date: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date);
  return Number(hour);
}

/**
 * The date IN FULL — "יום שלישי, 18 באוגוסט 2026" (user, 2026-08-18). The short
 * numeric form ("יום שלישי · 18.8") existed only because the top bar's title slot
 * doesn't shrink, it spills; inside the card the line has room to wrap.
 */
export function formatToday(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * The greeting as one line. Deliberately the 👋 EMOJI and not a palette icon:
 * this is a greeting, not a control, and the yellow hand is the whole point.
 * (The icon-palette sweep once swapped it for a monochrome SVG; that read as a
 * "stop" hand.)
 */
export function greetingTitle(greeting: string, name: string): string {
  return `${greeting}${name ? `, ${name}` : ""} 👋`;
}

/** The viewer's FIRST name — the greeting is a greeting, not a name tag. */
export function firstNameOf(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? "";
}
