export type PaymentStatus = "unpaid" | "partial" | "paid";

export type OrderPaymentInput = {
  amount_total?: number | string;
  payment_date?: string | null;
  payment_method?: string | null;
  reference_number?: string | null;
  notes?: string | null;
};

export type OrderPaymentRow = {
  id?: string;
  target_type?: string;
  target_id?: string;
  payment_date?: string | null;
  amount_total?: number | string | null;
  payment_method?: string | null;
  reference_number?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export const ORDER_PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "מזומן" },
  { value: "bank_transfer", label: "העברה בנקאית" },
  { value: "credit_card", label: "כרטיס אשראי" },
  { value: "check", label: "צ'ק" },
  { value: "bit", label: "ביט" },
  { value: "other", label: "אחר" },
] as const;

export function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

export function normalizePaymentEntries(entries: OrderPaymentInput[] | undefined) {
  const rows = Array.isArray(entries) ? entries : [];
  return rows.map((entry) => ({
    amount_total: toNumber(entry.amount_total),
    payment_date: typeof entry.payment_date === "string" ? entry.payment_date : null,
    payment_method:
      typeof entry.payment_method === "string" ? entry.payment_method.trim() : "",
    reference_number:
      typeof entry.reference_number === "string" ? entry.reference_number.trim() : null,
    notes: typeof entry.notes === "string" ? entry.notes.trim() : null,
  }));
}

export function hasInvalidPaymentEntry(
  entries: ReturnType<typeof normalizePaymentEntries>
) {
  return entries.some(
    (entry) =>
      !Number.isFinite(entry.amount_total) ||
      entry.amount_total <= 0 ||
      !entry.payment_date ||
      !entry.payment_method
  );
}

export function sumPayments(
  entries: Array<{ amount_total?: number | string | null }> | undefined
) {
  return (entries ?? []).reduce((sum, entry) => {
    const amount = toNumber(entry.amount_total);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export function derivePaymentStatus(totalAmount: number, paidAmount: number): PaymentStatus {
  if (!(paidAmount > 0)) return "unpaid";
  if (paidAmount + 0.009 >= totalAmount) return "paid";
  return "partial";
}

export function paymentStatusLabel(status: string) {
  switch (status) {
    case "paid":
      return "שולם";
    case "partial":
      return "שולם חלקית";
    default:
      return "לא שולם";
  }
}

export function paymentMethodLabel(method: string | null | undefined) {
  switch (method) {
    case "cash":
      return "מזומן";
    case "bank_transfer":
      return "העברה בנקאית";
    case "credit_card":
      return "כרטיס אשראי";
    case "check":
      return "צ'ק";
    case "bit":
      return "ביט";
    case "other":
      return "אחר";
    default:
      return method || "-";
  }
}

export function paymentStatusClasses(status: string) {
  switch (status) {
    case "paid":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partial":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-rose-200 bg-rose-50 text-rose-700";
  }
}

export function validateRequestedPaymentStatus(params: {
  requestedStatus: string;
  totalAmount: number;
  paidAmount: number;
}) {
  const { requestedStatus, totalAmount, paidAmount } = params;

  switch (requestedStatus) {
    case "paid":
      if (!(paidAmount > 0) || paidAmount + 0.009 < totalAmount) {
        return "כדי לסמן הזמנה כשולמה צריך להזין תשלום מלא.";
      }
      return null;
    case "partial":
      if (!(paidAmount > 0) || paidAmount + 0.009 >= totalAmount) {
        return "כדי לסמן הזמנה כשולמה חלקית צריך להזין תשלום חלקי שקטן מהסכום הכולל.";
      }
      return null;
    case "unpaid":
      if (paidAmount > 0) {
        return "אי אפשר להשאיר הזמנה כלא שולמה כשכבר קיימים בה תשלומים.";
      }
      return null;
    default:
      return null;
  }
}
