// A property income's rent fields (owner, 2026-10-20 — the ניהול נכסים card:
// "every rent payment says which month it covers"): the lease it's rent for,
// the first period it pays (that period's due date), how many periods ("שולם
// לחודשיים" = 2), and whether it's rent at all (a refund isn't). Read the same
// way by the create and the update routes; a field that isn't sent isn't
// touched, so the general income forms — which don't know about rent — leave
// what the property page set.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type RentFieldsBody = {
  lease_id?: unknown;
  rent_period_start?: unknown;
  rent_periods?: unknown;
  counts_as_rent?: unknown;
};

export type RentColumns = {
  lease_id?: string | null;
  rent_period_start?: string | null;
  rent_periods?: number;
  counts_as_rent?: boolean;
};

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
    if (!Number.isInteger(n) || n < 1 || n > 24) return { error: "Invalid rent_periods" };
    out.rent_periods = n;
  }
  if (body.counts_as_rent !== undefined) {
    if (typeof body.counts_as_rent !== "boolean") return { error: "Invalid counts_as_rent" };
    out.counts_as_rent = body.counts_as_rent;
    if (!body.counts_as_rent) {
      out.lease_id = null;
      out.rent_period_start = null;
      out.rent_periods = 1;
    }
  }
  return out;
}
