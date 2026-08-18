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
  | "deliveries"
  | "attendanceQueue"
  | "domainChart";

/**
 * Width in QUARTERS of the widget grid: 1 = a quarter, 2 = a half, 4 = the full
 * row. The grid used to be two columns (half / full); it became four so the
 * "היום" pair can sit at a quarter each with a half-width widget flowing up
 * beside them instead of opening a row of its own.
 */
export type WidgetSpan = 1 | 2 | 4;

export type WidgetMeta = {
  id: WidgetId;
  /** Hebrew label shown in the customizer. */
  label: string;
  /** Roles allowed to see this widget. */
  roles: UserRole[];
  span: WidgetSpan;
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
  // EVERY widget is a quarter (2026-08-17): the board reads as one grid of
  // equal cards, four to a row, instead of a stack of differently-sized blocks.
  // The cards' own contents respond to the card's width via container queries,
  // not the viewport's — see the @container grids in the widget components.
  // ORDER IS PRIORITY (2026-08-18), and the RIGHT is the important side: the
  // order decides both where a card lands — the first cards are the top row,
  // dealt right to left, the next ones on the row beneath — and how much of its
  // column it gets. So the list runs most-important first: the day, what needs
  // handling in it, your own work, then everyone else's, then the numbers.
  { id: "todaySchedule", label: "היום — יומן", roles: ALL, span: 1 },
  { id: "todayAlerts", label: "התראות", roles: ALL, span: 1 },
  { id: "myTasks", label: "המשימות שלי", roles: ALL, span: 1 },
  // Money that LEAVES in the next few days, off the payments calendar: what is
  // late, what is due today, what is coming. Per-row amounts, no total — the
  // board says what needs doing, not what the business is worth.
  { id: "payments", label: "תשלומים קרובים", roles: BACK_OFFICE, span: 1 },
  // Workers see this one too — the delivery run IS their work, and /deliveries
  // is one of the four routes they can open.
  { id: "deliveries", label: "אספקות קרובות", roles: ALL, span: 1 },
  // Shift reports waiting to be approved into payroll — someone else's day is
  // blocked on it, but it's not the viewer's own work, so it sits after it.
  { id: "attendanceQueue", label: "נוכחות עובדים לאישור", roles: BACK_OFFICE, span: 1 },
  { id: "domainChart", label: "הכנסות והוצאות", roles: BACK_OFFICE, span: 1 },
];

/**
 * The board is four COLUMNS, each a full-height stack of cards (not a grid of
 * row-spans: whole rows can't divide evenly, so the tallest column dictates the
 * rest and the shortest ends in a hole — which is exactly the gap that showed up
 * under "המשימות שלי"). Cards divide their column in proportion to their weight,
 * so every column ends FLUSH with the others, whatever mix of cards the day
 * brings. A card missing (nothing pending, nothing missed) just means its column
 * splits between the rest.
 *
 * The height is the viewport, because the board fits the screen with NO PAGE
 * SCROLL (user, twice) — a card whose list outgrows its share scrolls inside
 * itself rather than lengthening the page.
 *
 * The subtraction, in the units each part is actually built from — mixing them
 * is the point, not sloppiness: the top bar is 60px of fixed chrome PLUS its 1px
 * bottom border, while the page's own `lg:p-8` padding is 4rem, which stretches
 * with the viewer's font-scale (0.9–1.5×). Written as `7.75rem` it was a pixel
 * short at scale 1 and further off at every other scale — that pixel is a
 * scrollbar. Keep it in step with AppShell's content wrapper and TopBar's height.
 */
/**
 * The board cell's view-transition name for a card — unique, and stable across
 * repacks, which is what lets the browser pair a card's before and after and
 * slide it to its new column (see lib/ui/view-transition).
 *
 * Lives HERE, not beside withViewTransition: that module is "use client", and a
 * client module's exports can't be CALLED from a server component — the grid
 * that renders the cells is one. (Same trap as hebrewWeekday.)
 */
export function cardTransitionName(id: string) {
  return `card-${id}`;
}

export const DASHBOARD_BOARD_CLASS =
  // `board-flush` is the PHONE half of this (see globals.css): below md the cards
  // stop being cards and become full-bleed sections. A card is a device for
  // separating things that sit side by side, and on a 390px screen nothing does —
  // so the rounded box, the two side borders and the 12px gutter were paying for
  // a separation the single column already had, out of the width the content
  // needed. Above md they're cards again, because there they earn it.
  "board-flush flex flex-col gap-4 xl:grid xl:h-[calc(100dvh-61px-4rem)] xl:gap-4";

/**
 * The board uses the WHOLE width, so the column count follows the cards rather
 * than being fixed at four: three cards make three columns, not three columns
 * and a hole. Static classes — Tailwind can't see one built at runtime.
 */
export const BOARD_COLUMNS_CLASS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
};

/** The most columns the board will ever open. */
export const MAX_BOARD_COLUMNS = 4;

/**
 * A column is a full-height stack of cards on desktop — and NOTHING on a phone:
 * `display: contents` takes the wrapper out of the layout so every card becomes a
 * direct child of the board and can be ordered on its own. Without that, a phone
 * shows column 1's cards, then column 2's — and since cards are dealt ACROSS the
 * columns, that comes out as 1, 5, 2, 6, 3… rather than the viewer's order.
 */
export const BOARD_COLUMN_CLASS = "contents xl:flex xl:min-h-0 xl:flex-col xl:gap-4";

/**
 * WHAT A CARD DOES WITH ITS COLUMN — three sizes, and a card picks its own from
 * its own content. That's the whole contract.
 *
 *   quiet  — exactly as tall as it is. The one-line QuietCard, and anything that
 *            draws at a fixed size (the chart: stretching it only adds white
 *            space under the axis).
 *   normal — takes a share of whatever the quiet cards left over.
 *   tall   — takes twice that share, for a card actually holding a long list.
 *
 * THREE, not a weight from 1 to 6. The weights were computed from a pixel
 * estimate of each card's content times a bonus for its place in the viewer's
 * order, and the result was six subtly different heights that read as accidental
 * rather than chosen — and a card could change size because a list gained one
 * row. A card is normal or tall; that's a decision you can see.
 *
 * The sizes stay CLASSES, not spans: the board is a flex column measured to the
 * viewport, so cards divide the leftover height between them. Declared spans
 * (grid-auto-rows + span N) would give each card an intrinsic height and hand
 * the page its scrollbar back — the opposite of what the board is for.
 *
 * `min-h` is a floor so a card sharing with a much bigger neighbour is still
 * usable. `basis-auto`, NOT `basis-0`: each card starts at the height its content
 * wants and the shares divide only what's LEFT. That's what lets a card react to
 * being folded — collapse a day in the attendance card and the space it gives up
 * goes to its neighbours instead of staying a hole. Content that outgrows the
 * column still shrinks (min-h-0 is on the cell) and scrolls inside its card.
 *
 * Only at xl — on a phone every card is its content's height, in one column.
 */
export type CardSize = "quiet" | "normal" | "tall";

export const CARD_SIZE_CLASS: Record<CardSize, string> = {
  quiet: "xl:shrink-0 xl:grow-0 xl:basis-auto",
  normal: "xl:min-h-[9rem] xl:grow xl:basis-auto",
  tall: "xl:min-h-[9rem] xl:grow-[2] xl:basis-auto",
};

/** Kept for the cell that has nothing to stretch — same class, clearer name. */
export const CARD_NATURAL_CLASS = CARD_SIZE_CLASS.quiet;

/**
 * How many rows a card has to hold before it's worth twice the room. One number,
 * one place: a card asks `cardSize(n)` and gets its size.
 */
const TALL_FROM_ROWS = 6;

/**
 * A card's size from the one thing it knows: how many rows it holds. Nothing
 * with no rows takes a share (it renders as a QuietCard), and past
 * TALL_FROM_ROWS a card is long enough that a normal share would make it a
 * keyhole to scroll through.
 *
 * `tallFrom` is per-card because a "row" isn't the same height everywhere — an
 * attendance report is a form, a delivery is two lines.
 */
export function cardSize(rows: number, { tallFrom = TALL_FROM_ROWS } = {}): CardSize {
  if (rows <= 0) return "quiet";
  return rows >= tallFrom ? "tall" : "normal";
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
