// Where a property's rent stands this month — one rule for the property's
// own page (the שכירות החודש card) and the properties list (owner's card,
// note 17: "להראות על כל נכס בחוץ אם השכירות של החודש שולם").

import { israelDateKey } from "@/lib/timezone";

/** "2026-11-01T00:00:00+00:00" → "2026-11-01" — payment_date is a timestamp. */
export function dayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

export type RentMonthState = "paid" | "partial" | "check" | "late" | "upcoming" | "none";

export type RentLease = {
  status: string | null;
  monthlyRentAmount: number;
  rentDayOfMonth: number | null;
  startDate: string | null;
};

export type RentPayment = {
  date: string | null;
  paymentStatus: string | null;
  amount: number;
};

export type RentMonthStatus = {
  state: RentMonthState;
  collected: number;
  pending: number;
  rent: number;
  dueDay: number | null;
};

/**
 * A scheduled check is dated the month it's for; any other payment counts in
 * the month it came in — until each payment says which month it covers (the
 * next step on the card).
 */
export function rentThisMonth(
  lease: RentLease | null,
  payments: RentPayment[],
  today: string = israelDateKey()
): RentMonthStatus {
  if (!lease || lease.status !== "active") return { state: "none", collected: 0, pending: 0, rent: 0, dueDay: null };
  const month = today.slice(0, 7);
  let collected = 0;
  let pending = 0;
  for (const payment of payments) {
    if (dayKey(payment.date)?.slice(0, 7) !== month) continue;
    if (payment.paymentStatus === "pending") pending += payment.amount;
    else if (payment.paymentStatus !== "rejected") collected += payment.amount;
  }
  const rent = lease.monthlyRentAmount;
  const dueDay = lease.rentDayOfMonth ?? (lease.startDate ? Number(lease.startDate.slice(8, 10)) || null : null);
  const state: RentMonthState =
    rent > 0 && collected >= rent - 0.5
      ? "paid"
      : collected > 0
        ? "partial"
        : pending > 0
          ? "check"
          : dueDay !== null && Number(today.slice(8, 10)) > dueDay
            ? "late"
            : "upcoming";
  return { state, collected, pending, rent, dueDay };
}

/** Its words, and how each reads: as the card's big value, and as a chip on the list. */
export const RENT_STATE: Record<
  RentMonthState,
  { label: string; className: string; badge: "success" | "warning" | "info" | "destructive" | "neutral" | "outline" }
> = {
  paid: { label: "שולם", className: "text-success", badge: "success" },
  partial: { label: "שולם חלקית", className: "text-warning-strong", badge: "warning" },
  check: { label: "צ׳ק ממתין לפירעון", className: "text-secondary", badge: "info" },
  late: { label: "לא שולם", className: "text-destructive", badge: "destructive" },
  upcoming: { label: "טרם שולם", className: "text-foreground", badge: "outline" },
  none: { label: "אין שוכר", className: "text-muted-foreground", badge: "neutral" },
};
