// Customer payment terms (צורת תשלום) → automatic due-date calculation.
//
// "שוטף" (eom) = end of the reference month; "שוטף+N" = that month-end plus N
// days; "מיידי" (immediate) = due on the reference date itself. A null/unset
// term is treated as מיידי, so existing customers keep today's behavior.

export const PAYMENT_TERMS_OPTIONS = [
  { value: "immediate", label: "מיידי" },
  { value: "eom", label: "שוטף" },
  { value: "eom_30", label: "שוטף+30" },
  { value: "eom_40", label: "שוטף+40" },
  { value: "eom_60", label: "שוטף+60" },
  { value: "eom_90", label: "שוטף+90" },
] as const;

export type PaymentTerms = (typeof PAYMENT_TERMS_OPTIONS)[number]["value"];

export function paymentTermsLabel(value: string | null | undefined): string {
  if (!value) return "מיידי";
  return PAYMENT_TERMS_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function isPaymentTerms(value: unknown): value is PaymentTerms {
  return typeof value === "string" && PAYMENT_TERMS_OPTIONS.some((o) => o.value === value);
}

/** Normalize an incoming value to a stored term, or null (= מיידי default). */
export function normalizePaymentTerms(value: unknown): PaymentTerms | null {
  if (value === "immediate") return "immediate";
  return isPaymentTerms(value) ? value : null;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Due date for a reference date (order date / project start) given the customer's
 * payment terms. Returns an ISO date string, or null if the reference is missing.
 * null/"immediate" → the reference date; "eom" → end of that month; "eom_N" → +N days.
 */
export function computeDueDate(
  referenceDateIso: string | null | undefined,
  terms: string | null | undefined
): string | null {
  if (!referenceDateIso) return null;
  const parts = referenceDateIso.slice(0, 10).split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const ref = new Date(y, m - 1, d);
  if (Number.isNaN(ref.getTime())) return null;

  const t = terms ?? "immediate";
  if (t === "immediate") return toIso(ref);

  // End of the reference month (day 0 of the next month = last day of this one).
  const eom = new Date(y, m, 0);
  if (t === "eom") return toIso(eom);

  const match = /^eom_(\d+)$/.exec(t);
  if (match) {
    const due = new Date(eom);
    due.setDate(due.getDate() + Number(match[1]));
    return toIso(due);
  }
  return toIso(ref);
}
