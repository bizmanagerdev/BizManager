import type { SupabaseClient } from "@supabase/supabase-js";
import { israelDateKey } from "@/lib/timezone";

/**
 * The seven-day series behind the cards' sparklines — a count per day, oldest
 * first, always exactly `days` long (a day with nothing is a 0, not a gap: a
 * sparkline that skips empty days lies about the shape).
 *
 * Deliberately counts ROWS rather than summing amounts: the spark is there to
 * show a shape, and the board's rule is that it never puts a ₪ figure on screen.
 */

export const SPARK_DAYS = 7;

/**
 * The last `days` dates, oldest first — Israel's calendar, whatever clock this
 * runs on (the server's is UTC, a phone's is Israel's; the dashboard's device
 * version works the same series out on the phone and they must agree).
 */
function recentDays(days: number): string[] {
  const [y, m, d] = israelDateKey().split("-").map(Number);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

/** Where to start reading: a day before the first, so nothing just after Israel's midnight is cut off. */
function readFrom(days: number): string {
  const [y, m, d] = recentDays(days)[0].split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** A value's day: a timestamp by Israel's clock, a plain date as it is. */
function israelDayOf(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : israelDateKey(date);
}

/** Bucket ISO timestamps/dates into a count per (Israel) day, oldest first. */
function countByDay(values: (string | null | undefined)[], days: number): number[] {
  const buckets = new Map(recentDays(days).map((day) => [day, 0]));
  for (const value of values) {
    const day = value ? israelDayOf(value) : null;
    if (!day) continue;
    const current = buckets.get(day);
    if (current !== undefined) buckets.set(day, current + 1);
  }
  return [...buckets.values()];
}

/**
 * One query per series, each a narrow select over a week — cheap enough to sit
 * on the dashboard, and each is gated on its card being visible by the caller.
 * Any failure resolves to an empty series, and an empty series draws nothing:
 * a sparkline is never worth failing a board over.
 */

/** Shifts started per day — the shape behind "N נוכחים". */
export async function loadAttendanceSpark(supabase: SupabaseClient, days = SPARK_DAYS): Promise<number[]> {
  const since = readFrom(days);
  const { data, error } = await supabase
    .from("attendance_sessions")
    .select("clock_in")
    .gte("clock_in", since)
    .range(0, 999);
  if (error) return [];
  return countByDay((data ?? []).map((row) => (row as { clock_in?: string | null }).clock_in), days);
}

/** Orders dated per day — the shape behind "N משלוחים קרובים". */
export async function loadDeliveriesSpark(supabase: SupabaseClient, days = SPARK_DAYS): Promise<number[]> {
  const since = readFrom(days);
  const { data, error } = await supabase
    .from("delivery_overview_view")
    .select("order_date")
    .gte("order_date", since)
    .range(0, 999);
  if (error) return [];
  return countByDay((data ?? []).map((row) => (row as { order_date?: string | null }).order_date), days);
}
