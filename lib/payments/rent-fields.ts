// A property income's rent fields (owner, 2026-10-20 — the ניהול נכסים card:
// "every rent payment says which month it covers"): the lease it's rent for,
// the first period it pays (that period's due date), how many periods ("שולם
// לחודשיים" = 2), and whether it's rent at all (a refund isn't). Read the same
// way by the create and the update routes; a field that isn't sent isn't
// touched, so the general income forms — which don't know about rent — leave
// what the property page set.
//
// rent_allocation (owner, 2026-10-22: "I choose what months it will cover"):
// the months ticked and how much of the payment went to each — the first and
// how many follow from it. Months set the old way (a first and how many) drop
// it: the payment is split evenly over them again.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type RentFieldsBody = {
  lease_id?: unknown;
  rent_period_start?: unknown;
  rent_periods?: unknown;
  counts_as_rent?: unknown;
  rent_allocation?: unknown;
};

export type RentShareColumn = { period: string; amount: number };

export type RentColumns = {
  lease_id?: string | null;
  rent_period_start?: string | null;
  rent_periods?: number;
  counts_as_rent?: boolean;
  rent_allocation?: RentShareColumn[] | null;
};

/** At most two years of months, as rent_periods. */
const MAX_PERIODS = 24;

/** The months ticked and each one's amount, in order — or why not. */
function allocationFrom(value: unknown): RentShareColumn[] | null | { error: string } {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PERIODS) return { error: "Invalid rent_allocation" };
  const shares: RentShareColumn[] = [];
  for (const item of value) {
    const period = typeof item?.period === "string" ? item.period.slice(0, 10) : "";
    const amount = Number(item?.amount);
    if (!DAY.test(period) || !Number.isFinite(amount) || amount <= 0) return { error: "Invalid rent_allocation" };
    shares.push({ period, amount: Math.round(amount * 100) / 100 });
  }
  shares.sort((a, b) => a.period.localeCompare(b.period));
  if (shares.some((s, i) => i > 0 && s.period === shares[i - 1].period)) return { error: "Invalid rent_allocation" };
  return shares;
}

/** What the months were given, all together — the payment's amount when they're ticked. */
export function allocationTotal(shares: RentShareColumn[]): number {
  return Math.round(shares.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
}

/** Ticked months that don't add up to the payment: why they can't be saved; null when they do (or none were ticked). */
export function allocationMismatch(rent: RentColumns, amount: number): string | null {
  if (!rent.rent_allocation) return null;
  return Math.abs(allocationTotal(rent.rent_allocation) - amount) > 0.01 ? "rent_allocation doesn't add up to amount_total" : null;
}

/**
 * The same months, each its share of a new amount — a payment whose amount is changed somewhere that knows nothing
 * of its months (the checks page, the bank register) keeps the months it was ticked for. The last takes the agorot left.
 */
export function rescaleAllocation(value: unknown, amount: number): RentShareColumn[] | null {
  const shares = value === null || value === undefined ? null : allocationFrom(value);
  if (!shares || "error" in shares) return null;
  const total = allocationTotal(shares);
  if (total <= 0 || Math.abs(total - amount) <= 0.01) return null;
  const scaled = shares.map((s) => ({ period: s.period, amount: Math.round((s.amount * amount * 100) / total) / 100 }));
  const drift = Math.round((amount - allocationTotal(scaled)) * 100) / 100;
  scaled[scaled.length - 1].amount = Math.round((scaled[scaled.length - 1].amount + drift) * 100) / 100;
  return scaled.every((s) => s.amount > 0) ? scaled : null;
}

/** The rent columns sent, or why they can't be saved. Not rent clears the lease and the period. */
export function rentColumnsFrom(body: RentFieldsBody): RentColumns | { error: string } {
  const out: RentColumns = {};
  if (body.lease_id !== undefined) {
    if (body.lease_id !== null && typeof body.lease_id !== "string") return { error: "Invalid lease_id" };
    out.lease_id = typeof body.lease_id === "string" && body.lease_id.trim() ? body.lease_id.trim() : null;
  }
  if (body.rent_period_start !== undefined) {
    const value = typeof body.rent_period_start === "string" ? body.rent_period_start.slice(0, 10) : null;
    if (body.rent_period_start !== null && !(value && DAY.test(value))) return { error: "Invalid rent_period_start" };
    out.rent_period_start = value;
  }
  if (body.rent_periods !== undefined) {
    const n = Number(body.rent_periods);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PERIODS) return { error: "Invalid rent_periods" };
    out.rent_periods = n;
  }
  if (body.rent_allocation !== undefined) {
    const shares = allocationFrom(body.rent_allocation);
    if (shares && "error" in shares) return shares;
    out.rent_allocation = shares;
    // Ticked months say where it starts and how many.
    if (shares) {
      out.rent_period_start = shares[0].period;
      out.rent_periods = shares.length;
    }
  } else if (out.rent_period_start !== undefined || out.rent_periods !== undefined) {
    // Months set the old way: split evenly over them again.
    out.rent_allocation = null;
  }
  if (body.counts_as_rent !== undefined) {
    if (typeof body.counts_as_rent !== "boolean") return { error: "Invalid counts_as_rent" };
    out.counts_as_rent = body.counts_as_rent;
    if (!body.counts_as_rent) {
      out.lease_id = null;
      out.rent_period_start = null;
      out.rent_periods = 1;
      out.rent_allocation = null;
    }
  }
  return out;
}
