import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import type { StatusColor } from "@/lib/ui/status-colors";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";

export type PaymentStatus = "unpaid" | "partial" | "paid";

export type OrderPaymentInput = {
  amount_total?: number | string;
  payment_date?: string | null;
  payment_method?: string | null;
  account_id?: string | null;
  due_date?: string | null;
  reference_number?: string | null;
  check_number?: string | null;
  notes?: string | null;
};

export type OrderPaymentRow = {
  id?: string;
  payment_date?: string | null;
  amount_total?: number | string | null;
  payment_method?: string | null;
  reference_number?: string | null;
  check_number?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

// Shared, single source of truth (see lib/payments). Kept under this name so the
// existing order/project payment dialogs that import it stay unchanged.
export const ORDER_PAYMENT_METHOD_OPTIONS = PAYMENT_METHOD_OPTIONS;

export function normalizePaymentMethodValue(method: string | null | undefined) {
  const raw = typeof method === "string" ? method.trim() : "";
  if (!raw) return "";

  const normalized = raw.toLowerCase();

  if (normalized === "cash" || raw.includes("מזומן")) return "cash";
  if (
    normalized === "bank_transfer" ||
    normalized === "bank transfer" ||
    raw.includes("העברה בנקאית")
  ) {
    return "bank_transfer";
  }
  if (
    normalized === "credit_card" ||
    normalized === "credit card" ||
    raw.includes("אשראי") ||
    raw.includes("כרטיס")
  ) {
    return "credit_card";
  }
  if (normalized === "check" || normalized === "cheque" || raw.includes("צ'ק")) {
    return "check";
  }
  if (normalized === "bit" || raw.includes("ביט")) return "bit";
  if (raw.includes("העביר דרך חבר")) return "friend_transfer";
  if (raw.includes("דלק")) return "fuel";
  if (raw.includes("עבד")) return "labor";
  if (normalized === "other" || raw.includes("אחר")) return "other";

  return raw;
}

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
    account_id:
      typeof entry.account_id === "string" && entry.account_id.trim() ? entry.account_id.trim() : null,
    due_date:
      typeof entry.due_date === "string" && entry.due_date.trim() ? entry.due_date.trim() : null,
    reference_number:
      typeof entry.reference_number === "string" ? entry.reference_number.trim() : null,
    check_number:
      typeof entry.check_number === "string" ? entry.check_number.trim() : null,
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

// Statuses are always masculine across the app (project-wide convention).
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
  switch (normalizePaymentMethodValue(method)) {
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
    case "friend_transfer":
      return "הועבר דרך חבר";
    case "fuel":
      return "דלק";
    case "labor":
      return "עבודה";
    case "other":
      return "אחר";
    default:
      return normalizePaymentMethodValue(method) || "-";
  }
}

export function paymentStatusClasses(status: string) {
  return getStatusColorClasses(getOrderPaymentStatusColor(status));
}

function getOrderPaymentStatusColor(status: string): StatusColor {
  switch (status) {
    case "paid":
      return "success";
    case "partial":
      return "info";
    case "unpaid":
      return "danger";
    default:
      return "neutral";
  }
}

// ─── Collection status (נגבה בפועל vs צפוי) ─────────────────────────────────
// A payment with a future due_date (שוטף+30, post-dated check) is inserted with
// payment_status='pending' — the money has NOT arrived yet. "Collected" money is
// only what actually cleared. These helpers split a set of payments into what was
// collected vs what is still expected, and derive a collection status for the
// owner's גבייה (collections) worklist.
//
// EXCEPTION — credit_card: a card charge is collected from the customer
// immediately, so buildPaymentInsert (lib/payments.ts) always defaults its
// payment_status to 'cleared' regardless of due_date. A due_date on a
// credit_card payment means something else — when a clearing company (e.g.
// Growth) deposits the batched total — and only lib/accounts.ts's account
// ledger defers to it; the order/collections side never does.

export type CollectionStatus =
  | "overpaid"
  | "collected"
  | "partial"
  | "awaiting"
  | "overdue"
  | "unpaid";

export type PaymentSplitInput = {
  amount_total?: number | string | null;
  /**
   * Amount that COUNTS toward the price (net of VAT for official payments).
   * When present it is used instead of amount_total, so VAT on official payments
   * never inflates the collected/expected totals. Equals amount_total for
   * non-official payments. See lib/payments.buildPaymentInsert.
   */
  net_amount?: number | string | null;
  payment_status?: string | null;
  due_date?: string | null;
};

export type PaymentSplit = {
  collected: number; // money actually in (cleared, or legacy rows with no status)
  pending: number; // expected money still due (payment_status='pending')
  overdue: number; // pending money whose due_date has already passed
};

/** Money is "collected" unless it is still pending or was rejected (bounced). */
export function isCollectedPayment(status: string | null | undefined): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return s !== "pending" && s !== "rejected";
}

function todayIso(today: Date) {
  return today.toISOString().slice(0, 10);
}

export function splitPaymentAmounts(
  entries: PaymentSplitInput[] | undefined,
  today: Date = new Date()
): PaymentSplit {
  const reference = todayIso(today);
  return (entries ?? []).reduce<PaymentSplit>(
    (acc, entry) => {
      // Prefer the price-counting (net) amount; fall back to the gross.
      const net = toNumber(entry.net_amount);
      const amount = Number.isFinite(net) ? net : toNumber(entry.amount_total);
      if (!Number.isFinite(amount)) return acc;
      const status =
        typeof entry.payment_status === "string" ? entry.payment_status.trim().toLowerCase() : "";
      if (status === "rejected") return acc; // bounced — counts as nothing
      if (status === "pending") {
        acc.pending += amount;
        const due = typeof entry.due_date === "string" ? entry.due_date.slice(0, 10) : "";
        if (due && due <= reference) acc.overdue += amount;
      } else {
        acc.collected += amount;
      }
      return acc;
    },
    { collected: 0, pending: 0, overdue: 0 }
  );
}

export function deriveCollectionStatus(params: {
  totalAmount: number;
  collected: number;
  pending: number;
  overdue: number;
}): CollectionStatus {
  const { totalAmount, collected, pending, overdue } = params;
  if (totalAmount > 0 && collected > totalAmount + 0.009) return "overpaid"; // collected more than due — likely a mistake
  if (totalAmount > 0 && collected + 0.009 >= totalAmount) return "collected";
  if (overdue > 0.009) return "overdue"; // expected money past due — call them now
  if (pending > 0.009) return "awaiting"; // expected money, still future-dated
  if (collected > 0.009) return "partial"; // partly paid, remainder not scheduled
  return "unpaid";
}

// Collection-status wording. These describe the תשלום / חוב (masculine), so the
// labels are gender-invariant.
export function collectionStatusLabel(status: string) {
  switch (status) {
    case "overpaid":
      return "שולם יתר";
    case "collected":
      return "שולם";
    case "partial":
      return "שולם חלקית";
    case "awaiting":
      return "תשלום צפוי";
    case "overdue":
      return "באיחור";
    default:
      return "לא שולם";
  }
}

function getCollectionStatusColor(status: string): StatusColor {
  switch (status) {
    // Amber, not red. Red carries exactly one meaning in this app — "they owe you
    // / it's late". An overpayment is worth a second look (duplicate or wrong
    // amount), but it is the opposite of a debt, and sharing the alarm colour
    // between the two makes both harder to read at a glance.
    case "overpaid":
      return "warning";
    case "collected":
      return "success";
    case "partial":
      return "info";
    case "awaiting":
      return "warning";
    case "overdue":
      return "danger";
    default:
      return "danger";
  }
}

export function collectionStatusClasses(status: string) {
  return getStatusColorClasses(getCollectionStatusColor(status));
}

/** Labels for order-level payment badges. Identical to collectionStatusLabel so
 *  the same wording (תשלום צפוי / באיחור …) appears everywhere. */
export function orderCollectionStatusLabel(status: string) {
  return collectionStatusLabel(status);
}

/**
 * Badge for a single payment row, surfaced everywhere payments are listed.
 * Returns null for collected/cleared money (no badge needed), a "צפוי" warning
 * for future-dated expected money, or "באיחור" when its due_date has passed.
 */
export function paymentCollectionChip(
  payment: { payment_status?: string | null; due_date?: string | null },
  today: Date = new Date()
): { label: string; classes: string } | null {
  const status =
    typeof payment.payment_status === "string" ? payment.payment_status.trim().toLowerCase() : "";
  if (status === "rejected") {
    return { label: "נדחה", classes: getStatusColorClasses("danger") };
  }
  if (status !== "pending") return null;
  const due = typeof payment.due_date === "string" ? payment.due_date.slice(0, 10) : "";
  if (due && due <= todayIso(today)) {
    return { label: "באיחור", classes: getStatusColorClasses("danger") };
  }
  return { label: "צפוי", classes: getStatusColorClasses("warning") };
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
