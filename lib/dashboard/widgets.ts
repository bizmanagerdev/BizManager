import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/requireProfile";

/**
 * The catalog of dashboard widgets a user can show/hide/reorder via the "התאמת
 * לוח" customizer. ROLE is the security boundary: `roles` lists which roles may
 * ever see a widget, and `resolveWidgets` re-applies that filter AFTER the user's
 * saved prefs — so a stored/injected id can never surface a widget the viewer's
 * role isn't allowed to load (those panels are RLS-protected anyway).
 *
 * Shared by the server (DashboardPanels render + data-fetch gating) and the
 * client customizer, so this module stays framework-neutral.
 */

export type WidgetId =
  | "todaySchedule"
  | "todayAlerts"
  | "myTasks"
  | "payments"
  | "collections"
  | "deliveries"
  | "attendanceQueue"
  | "properties"
  | "domainChart";

export type WidgetMeta = {
  id: WidgetId;
  /** Hebrew label shown in the customizer. */
  label: string;
  /** Roles allowed to see this widget. */
  roles: UserRole[];
};

const ALL: UserRole[] = ["admin", "office", "worker"];
const BACK_OFFICE: UserRole[] = ["admin", "office"];

/**
 * Registry in DEFAULT top-to-bottom order (matches the legacy hand-coded
 * dashboard order). The order here is the fallback whenever the user hasn't set
 * an explicit order.
 */
export const DASHBOARD_WIDGETS: WidgetMeta[] = [
  // "היום" is the morning landing, and it means TODAY: the calendar's tasks /
  // projects / reminders for the day plus the alerts genuinely dated today.
  // It absorbed three earlier widgets — "התראות" + "תזכורות" (two views of one
  // inbox) and "מבט על היום" (registered as `week`), which showed the same day
  // from the other side. Backlog alerts stay in /inbox; a card called היום that
  // lists everything open is just the inbox wearing a date.
  //
  // Those two halves are now two CARDS (2026-08-17) — the day's schedule and the
  // things that need handling are read differently and get looked at at different
  // moments, so each is a card of its own rather than two sections of one card.
  // Toggling/reordering them separately falls out of that.
  //
  // ORDER IS PRIORITY (2026-08-18): the order below decides where a card lands
  // AND how big it is (2026-08-19) — #1 is the hero (see HERO_GRID_CLASS), the
  // next 2–3 are the secondary row, everything after is the small, uniform
  // "everything else" row. So the list runs most-important first: the day, what
  // needs handling in it, your own work, then everyone else's, then the numbers.
  { id: "todaySchedule", label: "היום — יומן", roles: ALL },
  { id: "todayAlerts", label: "התראות", roles: ALL },
  { id: "myTasks", label: "המשימות שלי", roles: ALL },
  // Money that LEAVES in the next few days, off the payments calendar: what is
  // late, what is due today, what is coming. Per-row amounts, no total — the
  // board says what needs doing, not what the business is worth.
  { id: "payments", label: "תשלומים קרובים", roles: BACK_OFFICE },
  // Money that COMES IN — the mirror of the card above it, and deliberately
  // right after it: the two answer the same question in opposite directions, so
  // they belong together both in the order and in the reading.
  { id: "collections", label: "גבייה", roles: BACK_OFFICE },
  // Workers see this one too — the delivery run IS their work, and /deliveries
  // is one of the four routes they can open.
  { id: "deliveries", label: "אספקות קרובות", roles: ALL },
  // Shift reports waiting to be approved into payroll — someone else's day is
  // blocked on it, but it's not the viewer's own work, so it sits after it.
  { id: "attendanceQueue", label: "נוכחות עובדים לאישור", roles: BACK_OFFICE },
  // Vacancy + expiring leases — a status board, not a money card, so it sits
  // after the money cards and attendance queue and before the pure numbers.
  { id: "properties", label: "נכסים", roles: BACK_OFFICE },
  { id: "domainChart", label: "הכנסות והוצאות", roles: BACK_OFFICE },
];

/**
 * The board cell's view-transition name for a card — unique, and stable across
 * repacks, which is what lets the browser pair a card's before and after and
 * slide it to its new position when the tiers are replanned (see
 * lib/ui/view-transition).
 *
 * Lives HERE, not beside withViewTransition: that module is "use client", and a
 * client module's exports can't be CALLED from a server component — the grid
 * that renders the cells is one. (Same trap as hebrewWeekday.)
 */
export function cardTransitionName(id: string) {
  return `card-${id}`;
}

/**
 * The board fills the viewport with NO PAGE SCROLL (user, twice) — a card whose
 * content outgrows its cell scrolls inside itself rather than lengthening the
 * page. The subtraction is in the units each part is actually built from, which
 * is the point, not sloppiness: the top bar is 60px of fixed chrome plus its 1px
 * bottom border, and the page's own `lg:p-8` padding is 4rem top+bottom — MINUS
 * the 1rem the dashboard page claws back off the top (`lg:-mt-4` in page.tsx,
 * see the comment there) since this page has no heading of its own to spend
 * that padding on, leaving 3rem. Written as one rem figure this was a pixel
 * short at scale 1 and further off at every other scale (font-scale, 0.9–1.5×)
 * — that pixel is a scrollbar. Keep this in step with page.tsx's own margin
 * and AppShell's content wrapper and TopBar's height.
 */
export const DASHBOARD_BOARD_CLASS =
  // `board-flush` is the PHONE half of this (see globals.css): below md the cards
  // stop being cards and become full-bleed sections. A card is a device for
  // separating things that sit side by side, and on a 390px screen nothing does —
  // so the rounded box, the two side borders and the 12px gutter were paying for
  // a separation the single column already had, out of the width the content
  // needed. Above md they're cards again, because there they earn it.
  "board-flush flex flex-col gap-4 xl:grid xl:h-[calc(100dvh-61px-3rem)] xl:gap-4";

/**
 * THE BOARD IS A HERO PLUS A REST COLUMN (2026-08-19b) — the hero is TALL, the
 * full height of the board, but narrow, and everything else lives in a wider
 * column beside it: secondary cards on top, the tertiary row underneath,
 * sharing that column's height (user, after seeing the hero share just the top
 * row: "it should be a tall card full height but not so wide").
 *
 * The hero's own width is the one knob that trades against the rest column's —
 * narrower hero, wider rest, which is what keeps the tertiary row's cards
 * readable (an earlier cut had the hero at 40% width and the rest squeezed to
 * 60%, with a tertiary row THEN also splitting THAT into a further sliver —
 * "theyre all garbled"; at 25%/75% the rest column has noticeably more to work
 * with, on top of the min-width fixes below actually being in place this time).
 *
 * xl only. Below it every card is full-width, in the viewer's order, one
 * column — see DASHBOARD_BOARD_CLASS. Every cell here goes `display: contents`
 * on a phone, so its cards fall straight into that one column instead of
 * nesting.
 */

// `minmax(0,…)` on every track, both axes, both grids (the board's own columns
// below, and the rest column's own rows further down): a grid track's
// automatic minimum size is its content's own natural size, not 0. One long
// line anywhere on the board was enough to push its track past its fr share,
// and a grid — unlike flex — does not wrap to absorb that; it just overflows.
// `minmax(0, …)` lets the track shrink to 0 first, so the fr split actually
// holds and long content wraps or scrolls INSIDE its card instead (every card
// already does this — see CARD_FILL_CLASS's `min-w-0`).
export const BOARD_GRID_CLASS =
  "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] xl:grid-rows-1 xl:gap-4";
/** When nothing follows the hero: it simply takes the whole board. */
export const HERO_ONLY_CLASS = "xl:grid xl:grid-cols-1 xl:grid-rows-1";

// Shared by every cell below: a grid/flex item's own default minimum size is
// its content's natural size too (the same trap as the tracks above, one layer
// in) — without `min-w-0`/`min-h-0` a cell refuses to shrink below its widest
// or tallest child no matter what the track allows. `contents` on a phone, so
// the cell disappears and its cards fall straight into the board's one column.
const CELL_BASE = "contents xl:flex xl:min-h-0 xl:min-w-0 xl:gap-4";

/**
 * The hero's own cell: the hero card (fills it), and — worker only — the
 * clock-in strip UNDER it (user, 2026-08-18: "I want the clock under today").
 * Column 1, the board's only row — always the full board height.
 */
export const HERO_CELL_CLASS = `${CELL_BASE} xl:flex-col xl:col-start-1 xl:row-start-1`;

/**
 * The rest column: secondary above tertiary, SHARING the hero's full height —
 * its own nested grid, not a nested flex-col. `flex-grow` only means anything
 * once every ancestor in the chain has resolved to a definite size, and this
 * is the second cell deep; one nested grid inside another, both built from
 * `minmax(0,…fr)` rows off the board's own `xl:h-[calc(...)]`, resolves
 * deterministically instead of depending on that chain holding — which is the
 * more likely reason the FIRST tall-hero attempt this session quietly
 * collapsed to content-sized rows rather than any single class being wrong.
 * `col-start-2`, matching BOARD_GRID_CLASS's second track; two row templates
 * for whether a tertiary row exists, same idea as the board used to have.
 */
// 1fr:1fr (even), not 3fr:2fr — 60/40 still read as too small on the tertiary
// row (user: "the point was to make the bottom cards bigger", after the first
// bump). The cards were already uniform (flex-grow + stretch guarantees that);
// what they needed was more height, so this gives secondary and tertiary the
// rest column's height straight down the middle instead of favoring either.
export const REST_COLUMN_BOTH_CLASS =
  "contents xl:grid xl:min-h-0 xl:min-w-0 xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-4 xl:col-start-2 xl:row-start-1";
export const REST_COLUMN_SECONDARY_ONLY_CLASS =
  "contents xl:grid xl:min-h-0 xl:min-w-0 xl:grid-rows-1 xl:gap-4 xl:col-start-2 xl:row-start-1";

/** The secondary row: a few cards, the rest column's top share. */
export const SECONDARY_CELL_CLASS = `${CELL_BASE} xl:flex-row xl:row-start-1`;
/** The tertiary row: everything else, the rest column's bottom share. Only
 *  rendered when tierCounts() gives it cards; pair with REST_COLUMN_BOTH_CLASS,
 *  not the …_SECONDARY_ONLY variant (there is no row 2 to land in otherwise). */
export const TERTIARY_CELL_CLASS = `${CELL_BASE} xl:flex-row xl:row-start-2`;

/**
 * The secondary row's own emphasis — one step down from the hero's border
 * (TodayScheduleCard's own `border-secondary`), applied here rather than in
 * each widget: WHICH widgets land in secondary changes with the viewer's own
 * «התאמת לוח» order, so the treatment has to live at the CELL, not in any one
 * card component. A `ring`, not a heavier `border`: a ring is a box-shadow,
 * not the `border` property Card already sets, so it layers on top instead of
 * fighting Card's own border/shadow classes for which one wins — the same
 * cascade-order uncertainty that caused this session's earlier `contents`
 * bugs, avoided here by not needing to win a specificity fight at all.
 * `ring-inset`, not the default outside ring: inset hugs the card's own
 * rounded corners exactly like a border would, so next to the hero's actual
 * `border-2 border-secondary` this reads as the same stroke turned down a
 * notch (ring-secondary/60), not an unrelated softer effect. xl only, like
 * every tier class — mobile cards are flat board-flush sections with no
 * chrome of their own to ring.
 */
// The FILL is the board's old tint, moved (user, 2026-08-19: "make the
// background white instead of blue and use the blue in the top row of cards").
// A tinted board under white cards spent the colour on the whole page and told
// you nothing; the same blue on the secondary row alone says which cards those
// are. Kept well under the row-hover inside these cards (`bg-secondary/10`, a
// translucent overlay that stacks on top of this) so hovering a row still
// registers as a step darker rather than landing on the same value.
// TURNED DOWN twice over (user, 2026-08-19: "the blue is too strong"): the
// fill is a tint, not a colour, and the RING came down with it (ring-2/60 ->
// ring-1/25). The ring used to be this row's only marking, so it had to
// shout; now the fill says "this row" on its own and a heavy stroke over it
// is the same message twice.
// `!` for the same reason TERTIARY_MUTE_CLASS needs it: Card already paints a
// background (`surface-panel`), so this has to override rather than layer.
// No shadow here either (user, 2026-08-19: "i dont need the shadow on the top
// three cards") — same reasoning as tertiary's: the shadow was one more thing
// saying "this row is different" when the tint + ring already say it, and the
// hero is the only card that should read as visually LIFTED off the board.
//
// `color-mix()`, not a plain `bg-secondary/[0.04]` — an alpha colour here
// doesn't LAYER on top of surface-panel's opaque white the way it would on a
// transparent element: `!important` makes it WIN the background-color
// property outright, so a 4%-alpha value made the whole card 96% see-through
// and the board's own texture showed straight through it (user: "take the
// texture out of the cards it effects the readability"). `color-mix` pre-
// blends the same 4% secondary into opaque white AT THE PAINT STEP, so the
// result is a solid near-white with a hint of blue — the intended look, just
// actually opaque.
export const SECONDARY_EMPHASIS_CLASS =
  "xl:rounded-[1.125rem] xl:ring-1 xl:ring-inset xl:ring-secondary/25 xl:[&>*]:bg-[color-mix(in_srgb,rgb(var(--secondary))_4%,white)]!";

/**
 * The tertiary row's own note, the opposite direction from secondary's: NO
 * shadow at all (user: "get rid of the shadow completely from the bottom
 * ones"), against every card's default `shadow-card`. Unlike the ring above,
 * this genuinely has to WIN a specificity fight — you can't layer your way to
 * "no shadow," only override the one that's already there — so it's the one
 * place in this tier system that reaches for `!important` on purpose rather
 * than avoiding the fight. `[&>*]`, not a class on Card itself: which widgets
 * land in tertiary changes with the viewer's own order, same reason
 * SECONDARY_EMPHASIS_CLASS lives here and not in any one card component.
 */
export const TERTIARY_MUTE_CLASS = "xl:[&>*]:shadow-none!";

/**
 * "Six or less" (Sari & Faigy's own words) — the point below which the board
 * is sparse enough that the secondary row's blue tint reads as MORE important
 * than the hero it's supposed to defer to: with fewer cards there's less
 * "everything else" for the tint to stand out FROM, so it started winning the
 * eye instead of the hero (Faigy: "i feel like the light blue catches the eye
 * more then the king"; Sari: "yeah because here they are the same [size] and
 * they are blue"). Below the threshold the colour swaps sides instead of
 * running on both — see HERO_EMPHASIS_FILL_CLASS/HERO_EMPHASIS_HEADER_CLASS
 * and the `few` gate on SECONDARY_EMPHASIS_CLASS's own use in
 * DashboardSections.tsx.
 */
export const FEW_CARDS_THRESHOLD = 6;

/**
 * The hero wears EXACTLY ONE of a dark header or a blue fill — never both,
 * never neither (user: "when the card has a fill, it doesn't need the
 * border. when the card doesn't have a fill, then it needs the border" —
 * then, seeing the bordered version: "instead of the border I want to make
 * this part dark and the words light", pointing at the header band). Sparse
 * board (at/under FEW_CARDS_THRESHOLD): the blue FILL is the signal on the
 * whole card. Crowded board: the DARK HEADER is the signal instead (the fill
 * moved to the secondary row, see SECONDARY_EMPHASIS_CLASS) — foreground
 * background, background-coloured text/icon, so the title band itself reads
 * as the mark rather than an outline around the card. Shadow-2xl is the one
 * constant either way — elevation isn't the colour argument, so it doesn't
 * take sides.
 *
 * Neither lives in TodayScheduleCard's own className: that component is built
 * before the board's final card count is known (see the comment on its Card
 * there), so both variants live here and are picked at the CELL, in
 * DashboardSections.tsx (`tier="hero-fill"` vs `"hero-header"`).
 * `[&_[data-card-header]]`, not `[&>*]`: the header is nested three levels
 * inside Card (see DASHBOARD_CARD_HEADER's own `data-card-header` hook), and
 * a descendant selector reaches it regardless of exactly how deep.
 *
 * `!` throughout for the same reason TERTIARY_MUTE_CLASS needs it — each is
 * overriding a property Card (or its header) already sets, not layering
 * beside it. The fill is the same opaque color-mix technique as secondary's —
 * a shade stronger (8% vs 4%) since it's now the one card meant to read as
 * "the colour on this board."
 */
export const HERO_EMPHASIS_FILL_CLASS =
  "xl:[&>*]:border-0! xl:[&>*]:shadow-2xl! xl:[&>*]:bg-[color-mix(in_srgb,rgb(var(--secondary))_8%,white)]!";
export const HERO_EMPHASIS_HEADER_CLASS =
  "xl:[&>*]:shadow-2xl! xl:[&_[data-card-header]]:bg-foreground! xl:[&_[data-card-header]]:border-foreground! xl:[&_[data-card-header]_h3]:text-background! xl:[&_[data-card-header]_svg]:text-background!";

/**
 * WHAT A CARD DOES WITH ITS CELL — two answers, not a weight from 1 to 6:
 *
 *   fill    — the hero, and every secondary/tertiary card. Stretches to fill
 *             whatever its slot (the hero column, or a band's row) gives it, and
 *             shares that space EVENLY with any row-mates. `min-h` is a floor so
 *             a tertiary band on a short screen never gets so thin the card
 *             inside it is unusable. Content past that height scrolls inside the
 *             card (`min-h-0` is what lets the cell shrink to allow that).
 *   natural — exactly as tall as it is: the worker's clock-in strip, and nothing
 *             else right now. A card that stretched here would either fight the
 *             hero for height it doesn't need or stand there full of white space.
 *
 * Both only at xl — on a phone every card is its own content's height, in one
 * scrolling column.
 */
export const CARD_FILL_CLASS = "xl:min-h-[8rem] xl:min-w-0 xl:grow xl:basis-0";
export const CARD_NATURAL_CLASS = "xl:shrink-0 xl:grow-0 xl:basis-auto";

/**
 * How many of the cards AFTER the hero go in the secondary band vs the tertiary
 * band — from the one number that varies: how many are left (`remaining`).
 * Every viewer shows a different set of widgets (role, and what they've hidden
 * in «התאמת לוח»), so this has to hold together from 0 cards left (hero alone)
 * to 7 (the full back-office catalog plus the digest).
 *
 * Secondary is capped at 3 and tertiary is nudged away from 1 (an orphan card
 * alone in its row looks like a mistake, not a tier) — past that, more cards
 * just means a wider tertiary row, which is exactly what "everything else" is
 * for. See __tests__/lib/dashboardWidgets.test.ts for the table this was tuned
 * against.
 */
export function tierCounts(remaining: number): { secondary: number; tertiary: number } {
  if (remaining <= 0) return { secondary: 0, tertiary: 0 };
  if (remaining <= 3) return { secondary: remaining, tertiary: 0 };

  let secondary = 2;
  let tertiary = remaining - secondary;
  // An orphan tertiary card (exactly one, alone in its row) reads as a mistake —
  // fold it into secondary instead, up to secondary's own cap of 3.
  if (tertiary === 1) {
    secondary = 3;
    tertiary = remaining - secondary;
  }
  // A tertiary row past 4 cards is dense enough to be worth trading for a third
  // secondary card instead, same cap.
  if (tertiary > 4 && secondary < 3) {
    secondary = 3;
    tertiary = remaining - secondary;
  }
  return { secondary, tertiary };
}

export type DashboardPrefs = {
  order: WidgetId[];
  hidden: WidgetId[];
};

const KNOWN_IDS = new Set<WidgetId>(DASHBOARD_WIDGETS.map((w) => w.id));

function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && KNOWN_IDS.has(value as WidgetId);
}

/**
 * A SPLIT id → the ids that replaced it, expanded in place so a saved board that
 * still names the old widget keeps its position and its shown/hidden choice.
 * Only for splits/renames: an id that was simply RETIRED belongs nowhere here,
 * so it's dropped by isWidgetId like any other junk (see the "week" case).
 */
const SPLIT_IDS: Record<string, WidgetId[]> = {
  // The one "היום" card became a calendar card + an alerts card (2026-08-17).
  // Both sides inherit the old card's slot, so a user who had moved היום to the
  // bottom (or hidden it) gets exactly that for the pair.
  today: ["todaySchedule", "todayAlerts"],
};

function toWidgetIds(value: unknown): WidgetId[] {
  if (!Array.isArray(value)) return [];
  const out: WidgetId[] = [];
  for (const raw of value) {
    const split = typeof raw === "string" ? SPLIT_IDS[raw] : undefined;
    if (split) out.push(...split);
    else if (isWidgetId(raw)) out.push(raw);
  }
  return out;
}

/**
 * Coerce arbitrary JSON (from the DB or a request body) into a clean
 * DashboardPrefs containing only known widget ids. Returns null for "no prefs".
 */
export function sanitizePrefs(value: unknown): DashboardPrefs | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { order?: unknown; hidden?: unknown };
  const order = toWidgetIds(raw.order);
  const hidden = toWidgetIds(raw.hidden);
  // De-dupe while preserving order.
  const seen = new Set<WidgetId>();
  const dedupedOrder = order.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  return { order: dedupedOrder, hidden: [...new Set(hidden)] };
}

/** The widgets a role is allowed to see, in default order. */
export function catalogForRole(role: UserRole): WidgetMeta[] {
  return DASHBOARD_WIDGETS.filter((w) => w.roles.includes(role));
}

/**
 * The full role catalog reordered by the user's saved `order` — but WITHOUT
 * hiding anything. This is what the customizer lists (so hidden widgets can be
 * toggled back on). Unknown/new ids keep their default-catalog position.
 * Role-safe: only widgets the role already allows are ever included.
 */
export function orderedCatalog(role: UserRole, prefs: DashboardPrefs | null): WidgetMeta[] {
  const catalog = catalogForRole(role);
  const order = prefs?.order ?? [];

  const orderIndex = new Map<WidgetId, number>();
  order.forEach((id, i) => orderIndex.set(id, i));

  // Stable sort: explicitly-ordered widgets first (by saved order), then any
  // widget without a saved position keeps its default-catalog order after them.
  const withDefault = catalog.map((w, defaultIdx) => ({ w, defaultIdx }));
  withDefault.sort((a, b) => {
    const ai = orderIndex.has(a.w.id) ? orderIndex.get(a.w.id)! : Number.POSITIVE_INFINITY;
    const bi = orderIndex.has(b.w.id) ? orderIndex.get(b.w.id)! : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.defaultIdx - b.defaultIdx;
  });

  return withDefault.map((e) => e.w);
}

/**
 * The widgets to actually render, in order, for a viewer. Pure + role-safe:
 * the role catalog, reordered by saved prefs, with `hidden` ids dropped. Role
 * filtering is intrinsic to the catalog, so prefs can only ever hide/reorder
 * widgets the role already allows — never reveal a forbidden one.
 */
export function resolveWidgets(role: UserRole, prefs: DashboardPrefs | null): WidgetMeta[] {
  const hidden = new Set(prefs?.hidden ?? []);
  const shown = orderedCatalog(role, prefs).filter((w) => !hidden.has(w.id));
  // A WORKER always leads with "היום", and always has it. He has no customizer
  // («התאמת לוח» is staff-only), so any saved order or hidden id on his account
  // is a leftover from some other role or an older board — it must not be what
  // decides whether the one card that answers "what am I doing today" is there.
  if (role !== "worker") return shown;
  const today = catalogForRole(role).find((w) => w.id === "todaySchedule");
  if (!today) return shown;
  return [today, ...shown.filter((w) => w.id !== "todaySchedule")];
}

/**
 * Read the viewer's saved dashboard prefs. Tolerant of the column not existing
 * yet (returns null before add_dashboard_prefs.sql runs) — exactly like the
 * font-scale GET — so the dashboard keeps working on role defaults pre-migration.
 */
export const getDashboardPrefs = cache(async function getDashboardPrefs(
  supabase: SupabaseClient,
  userId: string
): Promise<DashboardPrefs | null> {
  // cache(): the page shell and the streamed DashboardPanels both read prefs for
  // the same (supabase, userId) within one request — requireProfile() is itself
  // cached so both get the identical supabase instance, letting this dedupe to a
  // single `users` round-trip instead of two.
  const { data, error } = await supabase
    .from("users")
    .select("dashboard_prefs")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return sanitizePrefs((data as { dashboard_prefs?: unknown } | null)?.dashboard_prefs);
});
