// "ביטול החודש" — one month of a recurring bill that didn't happen (owner,
// 2026-10-26: Tefahot charged nothing in August). Pure, client-safe.
//
// A month can't simply be deleted: the generator walks every period from the
// template's start date and would create it again as not paid. So a cancelled
// month KEEPS its row — at ₪0, marked paid, with a note saying why. Every money
// view already reads that correctly (nothing posted, nothing open, nothing to
// forecast, nothing to remind about); only the labels need to know it's a
// cancellation and not a ₪0 payment.

/** What the note on a cancelled month starts with. */
export const CANCELLED_MONTH_PREFIX = "בוטל";

/** The reason when none is typed. */
export const CANCELLED_MONTH_DEFAULT_REASON = "לא היה חיוב החודש";

export function cancelledMonthNote(reason: string | null | undefined, previousNotes?: string | null): string {
  const note = `${CANCELLED_MONTH_PREFIX} – ${reason?.trim() || CANCELLED_MONTH_DEFAULT_REASON}`;
  const previous = previousNotes?.trim();
  return previous ? `${note}\n${previous}` : note;
}

/** A recurring month that was cancelled: its row kept, paid, at ₪0. */
export function isCancelledRecurringMonth(row: {
  recurringTemplateId: string | null | undefined;
  paymentStatus: string | null | undefined;
  amount: number | string | null | undefined;
}): boolean {
  if (!row.recurringTemplateId) return false;
  if ((row.paymentStatus ?? "").trim().toLowerCase() !== "paid") return false;
  return Math.abs(Number(row.amount) || 0) < 0.005;
}

/**
 * Whether a recurring month can still be cancelled: it isn't paid, and nothing
 * has been paid toward it. A paid month is corrected by editing the payment.
 */
export function canCancelRecurringMonth(row: {
  recurringTemplateId: string | null | undefined;
  paymentStatus: string | null | undefined;
  paidAmount: number | string | null | undefined;
}): boolean {
  if (!row.recurringTemplateId) return false;
  if ((row.paymentStatus ?? "").trim().toLowerCase() === "paid") return false;
  return !(Math.abs(Number(row.paidAmount) || 0) > 0.005);
}

/** "אוגוסט 2026" for a monthly key, "2026" for a yearly one. */
export function recurrenceKeyLabel(key: string | null | undefined): string {
  const value = key?.trim() ?? "";
  if (/^\d{4}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${value}-01T00:00:00Z`)
    );
  }
  return value;
}
