// Pure helpers for pre-scheduling a lease's rent payments — no I/O. Each row
// carries TWO independent dates: paymentDate (which rental month it covers)
// and dueDate (when the actual post-dated check clears), per the owner's spec.

export type RentScheduleRow = {
  paymentDate: string;
  dueDate: string;
  amount: number;
  checkNumber: string;
};

/** dateStr + N months, clamping to the last day of a short month. */
export function stepMonthly(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, lastDayOfMonth));
  return date.toISOString().slice(0, 10);
}

/**
 * Increment a check-number string by `delta`, preserving leading-zero padding
 * (e.g. "000123" + 1 → "000124") as long as the result still fits the original
 * width — a check book's numbers are printed zero-padded, and losing the
 * padding makes the stored number not match the physical check anymore.
 */
function incrementPaddedNumber(value: string, delta: number): string {
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return trimmed;
  const next = String(n + delta);
  return next.length < trimmed.length ? next.padStart(trimmed.length, "0") : next;
}

/**
 * N monthly rent rows starting at firstMonth, one every month. dueDate
 * defaults to the same date as paymentDate — the office edits it per row to
 * the real check date once the physical checks are in hand. checkNumber
 * increments from startingCheckNumber when it parses as a number. Returns []
 * for a non-positive count rather than silently substituting 1.
 */
export function buildRentSchedule({
  firstMonth,
  count,
  monthlyAmount,
  startingCheckNumber = "",
}: {
  firstMonth: string;
  count: number;
  monthlyAmount: number;
  startingCheckNumber?: string;
}): RentScheduleRow[] {
  const n = Math.round(count);
  if (!firstMonth || !(monthlyAmount > 0) || !(n > 0)) return [];
  const hasSequence = startingCheckNumber.trim() !== "" && Number.isFinite(Number(startingCheckNumber.trim()));
  const rows: RentScheduleRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const paymentDate = stepMonthly(firstMonth, i);
    rows.push({
      paymentDate,
      dueDate: paymentDate,
      amount: monthlyAmount,
      checkNumber: hasSequence ? incrementPaddedNumber(startingCheckNumber, i) : "",
    });
  }
  return rows;
}
