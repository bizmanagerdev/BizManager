import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { israelWallClockToUtc } from "@/lib/timezone";
import type { WeekMetric, WeekStats } from "@/lib/meetings/types";

// "מספרי השבוע" — the header strip on ישיבה שבועית.
//
// ── The period is the GAP, not a fixed week ────────────────────────────────
// The meeting is meant to be weekly, but a holiday, a shutdown or a plain busy
// fortnight means it sometimes isn't. So the period a meeting reviews runs from
// the day AFTER the previous meeting through the meeting's own date — whatever
// that turns out to be. Skip two weeks and the numbers cover both of them;
// nothing falls down the gap between meetings, which is the only way "since we
// last spoke" can mean anything.
//
// The comparison is the SAME NUMBER OF DAYS immediately before that period, not
// "the previous meeting's period": comparing 21 days against 7 would make every
// figure look like a triumph. Equal-length or it isn't a comparison.
//
// The first meeting ever has no previous one to measure from, so it falls back
// to 7 days.
//
// ── Where each number comes from ──────────────────────────────────────────
//   פרויקטים שנסגרו  projects.completed_at
//   פרויקטים חדשים   projects.created_at
//   הזמנות שנסגרו    orders.closed_at
//   נגבה             payments.payment_date, non-pending/rejected
//   צ׳קים שהופקדו    payments.cleared_at, method = check
//   משימות שהושלמו   tasks.completed_at
//   משימות באיחור    tasks.due_date < today, still open  (a snapshot, not a window)
//
// The four completion columns are maintained by triggers and were backfilled
// from audit_logs — see 20260923140000_completion_timestamps.sql. This file
// used to derive three of these figures from audit_logs directly at query time;
// it no longer touches that table, so switching audit logging off (or pruning
// the log) can't take the business numbers with it.

type Row = Record<string, unknown>;

/** Israel-midnight instant at the start of the given YYYY-MM-DD. */
function startOfDayIso(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return israelWallClockToUtc(y, m, d, 0, 0).toISOString();
}

/** dateKey shifted by `days`, still as YYYY-MM-DD. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `fromKey` to `toKey` inclusive of both ends (same day = 1). */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.floor(diff / 86_400_000) + 1;
}

const DEFAULT_PERIOD_DAYS = 7;

type Window = { fromKey: string; toKey: string; days: number; fromIso: string; untilIso: string };

function makeWindow(fromKey: string, toKey: string): Window {
  return {
    fromKey,
    toKey,
    days: daysBetweenKeys(fromKey, toKey),
    fromIso: startOfDayIso(fromKey),
    // Exclusive upper bound = midnight at the START of the next day, so the
    // meeting day itself is fully included however late the meeting runs.
    untilIso: startOfDayIso(shiftDateKey(toKey, 1)),
  };
}

/**
 * The period a meeting reviews: everything since the last one.
 *
 * `previousMeetingKey` is EXCLUSIVE — the previous meeting's own date. The day
 * it was held belonged to that meeting's period, so this one starts the morning
 * after. A missing (or out-of-order) previous date falls back to seven days.
 */
export function meetingPeriod(previousMeetingKey: string | null, toKey: string): Window {
  if (!previousMeetingKey || previousMeetingKey >= toKey) {
    return makeWindow(shiftDateKey(toKey, -(DEFAULT_PERIOD_DAYS - 1)), toKey);
  }
  return makeWindow(shiftDateKey(previousMeetingKey, 1), toKey);
}

/** The same number of days, immediately before `window`. */
function precedingWindow(window: Window): Window {
  const toKey = shiftDateKey(window.fromKey, -1);
  return makeWindow(shiftDateKey(toKey, -(window.days - 1)), toKey);
}

function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Rows of `table` whose `column` falls inside the window. Head-only: no payload. */
async function countInWindow(
  supabase: SupabaseClient,
  table: string,
  column: string,
  window: Window,
  equals?: Record<string, string>
): Promise<number> {
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .not(column, "is", null)
    .gte(column, window.fromIso)
    .lt(column, window.untilIso);
  for (const [key, value] of Object.entries(equals ?? {})) {
    query = query.eq(key, value);
  }
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

/** Money that actually came in during the window. */
async function sumCollected(supabase: SupabaseClient, window: Window): Promise<number> {
  // Paged rather than capped: a long gap between meetings means a long period,
  // and a `.limit()` here would silently under-report the total — the one
  // failure mode a money figure must not have.
  const rows = await fetchAllPaged<Row>((from, to) =>
    supabase
      .from("payments")
      .select("amount_total,payment_status")
      .gte("payment_date", window.fromIso)
      .lt("payment_date", window.untilIso)
      .range(from, to)
  ).catch(() => [] as Row[]);

  let sum = 0;
  for (const row of rows) {
    // The app's standing definition of "collected" (see
    // lib/financial/earnedRevenue.ts): anything not still pending and not
    // bounced. A post-dated check counts on the day it clears, not the day it
    // was handed over.
    const status = String(row.payment_status ?? "").trim().toLowerCase();
    if (status === "pending" || status === "rejected") continue;
    sum += toNum(row.amount_total);
  }
  return sum;
}

/** Everything that is open and whose due date has passed — as of right now. */
async function countOverdueTasks(supabase: SupabaseClient, todayKey: string): Promise<number> {
  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .not("due_date", "is", null)
    .lt("due_date", startOfDayIso(todayKey))
    .not("status", "in", "(done,cancelled)");
  if (error) return 0;
  return count ?? 0;
}

async function gatherWindow(supabase: SupabaseClient, window: Window) {
  const [projectsClosed, projectsNew, ordersClosed, collected, checksDeposited, tasksDone] =
    await Promise.all([
      countInWindow(supabase, "projects", "completed_at", window),
      countInWindow(supabase, "projects", "created_at", window),
      countInWindow(supabase, "orders", "closed_at", window),
      sumCollected(supabase, window),
      countInWindow(supabase, "payments", "cleared_at", window, { payment_method: "check" }),
      countInWindow(supabase, "tasks", "completed_at", window),
    ]);

  return { projectsClosed, projectsNew, ordersClosed, collected, checksDeposited, tasksDone };
}

export async function loadWeekStats(
  supabase: SupabaseClient,
  options: {
    /** The meeting's date — the last day of the period being reviewed. */
    toKey: string;
    /** The PREVIOUS meeting's date (exclusive). null on the first meeting ever. */
    previousMeetingKey?: string | null;
    /** The goal agreed at the previous meeting, for the "נגבה vs היעד" line. */
    collectionTarget?: number | null;
    /** Last meeting's frozen numbers, for metrics that can't be recomputed backwards. */
    previousStats?: WeekStats | null;
  }
): Promise<WeekStats> {
  const { toKey, previousMeetingKey = null, collectionTarget = null, previousStats = null } = options;
  const current = meetingPeriod(previousMeetingKey, toKey);
  const preceding = precedingWindow(current);
  const isWeek = current.days === DEFAULT_PERIOD_DAYS;

  const [now, before, overdueNow] = await Promise.all([
    gatherWindow(supabase, current),
    gatherWindow(supabase, preceding),
    countOverdueTasks(supabase, toKey),
  ]);

  // "Overdue right now" is a snapshot, not a window — it cannot be recomputed
  // for an earlier period (a task overdue then may since have been done, or its
  // date moved). The only truthful comparison is against what the previous
  // meeting actually recorded, so we read it back off the frozen snapshot.
  const previousOverdue = previousStats?.metrics.find((m) => m.key === "tasks_overdue")?.value ?? null;

  const metrics: WeekMetric[] = [
    {
      key: "projects_closed",
      label: "פרויקטים שנסגרו",
      value: now.projectsClosed,
      previous: before.projectsClosed,
      format: "count",
      href: "/projects?view=closed&sort=recent",
    },
    {
      key: "projects_new",
      label: "פרויקטים חדשים",
      value: now.projectsNew,
      previous: before.projectsNew,
      format: "count",
      href: "/projects?sort=recent",
    },
    {
      key: "orders_closed",
      label: "הזמנות שנסגרו",
      value: now.ordersClosed,
      previous: before.ordersClosed,
      format: "count",
      href: "/sales?tab=orders",
    },
    {
      key: "collected",
      // "השבוע" would be a lie about a period that isn't one.
      label: isWeek ? "נגבה השבוע" : "נגבה מאז הישיבה הקודמת",
      value: now.collected,
      previous: before.collected,
      format: "currency",
      caption:
        collectionTarget && collectionTarget > 0
          ? `יעד שנקבע: ${Math.round(collectionTarget).toLocaleString("he-IL")} ₪`
          : "לא נקבע יעד בישיבה הקודמת",
      // The target was agreed for a week. Over a longer gap the two figures are
      // not comparable, and saying so is the whole job of this line.
      captionNote:
        collectionTarget && collectionTarget > 0 && !isWeek
          ? `היעד נקבע לשבוע · התקופה ${current.days} ימים`
          : undefined,
      href: "/collections",
    },
    {
      key: "checks_deposited",
      label: "צ׳קים שהופקדו",
      value: now.checksDeposited,
      previous: before.checksDeposited,
      format: "count",
      href: "/checks",
    },
    {
      key: "tasks_done",
      label: "משימות שהושלמו",
      value: now.tasksDone,
      previous: before.tasksDone,
      format: "count",
      href: "/tasks?scope=all",
    },
    {
      key: "tasks_overdue",
      label: "משימות באיחור",
      value: overdueNow,
      previous: previousOverdue,
      format: "count",
      // More overdue tasks is worse, so the arrow must not be green when it rises.
      invertTrend: true,
      href: "/tasks?scope=all",
    },
  ];

  return { from: current.fromKey, to: current.toKey, days: current.days, metrics };
}

/** The goal share actually hit, or null when no goal was set. */
export function collectionTargetProgress(stats: WeekStats | null, target: number | null): number | null {
  if (!stats || !target || target <= 0) return null;
  const collected = stats.metrics.find((m) => m.key === "collected")?.value ?? 0;
  return collected / target;
}
