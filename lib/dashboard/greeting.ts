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

export function greetingForHour(hour: number): string {
  if (hour < 12) return "בוקר טוב";
  if (hour < 18) return "צהריים טובים";
  return "ערב טוב";
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
