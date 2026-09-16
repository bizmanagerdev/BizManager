import type { SupabaseClient } from "@supabase/supabase-js";

// "תחילת ספירת הכספים" — the 1st of the month the business started using the
// system for real (business_settings.books_start_date). The system was in use
// before it was fully built (income was recorded, expenses weren't), so the
// reports and the dashboard money chart count only from this date on. Nothing
// earlier is deleted: the ledger, customer/order/project pages and the account
// balances (which carry their own opening date) still see every row.
// null = count everything, exactly as before the setting existed.

const FIRST_OF_MONTH = /^(\d{4})-(0[1-9]|1[0-2])(?:-(\d{2}))?$/;

/**
 * "YYYY-MM-01" for a first-of-month date (or a bare "YYYY-MM" month), else null.
 * Any other day is rejected rather than rounded — the start is a whole month.
 */
export function normalizeBooksStartDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = FIRST_OF_MONTH.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  if (day !== undefined && day !== "01") return null;
  return `${year}-${month}-01`;
}

/** A report's effective `from`: the chosen date, but never before the books start. */
export function clampFromToBooksStart(
  from: string | null | undefined,
  booksStartDate: string | null | undefined
): string | null {
  const chosen = from || null;
  if (!booksStartDate) return chosen;
  return !chosen || chosen < booksStartDate ? booksStartDate : chosen;
}

/** True when the whole "YYYY-MM" month is before the books start date. */
export function isMonthBeforeBooksStart(monthKey: string, booksStartDate: string | null | undefined): boolean {
  return Boolean(booksStartDate) && `${monthKey}-01` < (booksStartDate as string);
}

export async function getBooksStartDate(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("business_settings")
    .select("books_start_date")
    .eq("id", true)
    .maybeSingle();

  // Before the migration runs the column is missing — count everything, as before.
  if (error || !data) return null;
  return normalizeBooksStartDate((data as { books_start_date?: unknown }).books_start_date);
}

export async function setBooksStartDate(
  supabase: SupabaseClient,
  booksStartDate: string | null,
  updatedBy: string
): Promise<void> {
  const { error } = await supabase
    .from("business_settings")
    .upsert(
      { id: true, books_start_date: booksStartDate, updated_at: new Date().toISOString(), updated_by: updatedBy },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
}
