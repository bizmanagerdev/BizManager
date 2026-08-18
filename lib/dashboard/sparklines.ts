import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The seven-day series behind the cards' sparklines — a count per day, oldest
 * first, always exactly `days` long (a day with nothing is a 0, not a gap: a
 * sparkline that skips empty days lies about the shape).
 *
 * Deliberately counts ROWS rather than summing amounts: the spark is there to
 * show a shape, and the board's rule is that it never puts a ₪ figure on screen.
 */

export const SPARK_DAYS = 7;

/** The last `days` ISO dates, oldest first, on the server's clock. */
function recentDays(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  }
  return out;
}

/** Bucket ISO timestamps/dates into a count per day, oldest first. */
function countByDay(values: (string | null | undefined)[], days: number): number[] {
  const buckets = new Map(recentDays(days).map((day) => [day, 0]));
  for (const value of values) {
    const day = value?.slice(0, 10);
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
  const since = recentDays(days)[0];
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
  const since = recentDays(days)[0];
  const { data, error } = await supabase
    .from("delivery_overview_view")
    .select("order_date")
    .gte("order_date", since)
    .range(0, 999);
  if (error) return [];
  return countByDay((data ?? []).map((row) => (row as { order_date?: string | null }).order_date), days);
}
