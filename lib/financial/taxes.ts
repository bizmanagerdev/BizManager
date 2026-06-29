import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { EXPENSE_TAX_CATEGORY } from "@/lib/expenses";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { isMissingColumnError } from "./utils";

// ════════════════════════════════════════════════════════════════════════════
// "Tax to pay" bucket (מע״מ). Per the decided model (see memory: vat-tax-model):
//   • Income is GROSS — VAT is NOT netted out of revenue.
//   • The VAT you collect is held until you remit it. This is that running total.
//
//   tax owed = VAT on official income − VAT already paid
//
//   VAT is on an ACCRUAL (invoice) basis — you owe it once the receipt is issued,
//   whether or not the cash has arrived ("the government doesn't care if I got the
//   money yet"). So:
//     • sales: every order flagged `needs_invoice` ("needs/created a receipt") owes
//       VAT on its FULL total, carved from the gross (total × rate/(1+rate)),
//       regardless of how much has been paid. Cancelled orders are excluded.
//     • net-priced projects / properties: the official payment IS the receipt
//       event → its stored `vat_amount` counts whether cleared or still pending
//       (only bounced/rejected is excluded).
//     • price-includes-VAT projects: their payments carry no stored split, so the
//       VAT is carved from the gross at the project's frozen rate (also accrual).
//   VAT paid = expenses in the EXPENSE_TAX_CATEGORY ("מע״מ ומסים") — these are the
//     manual tax payments that drain the bucket.
//
// NOTE: scans page through ALL rows via fetchAllPaged (no silent truncation). A
// later step may push this aggregation fully into a SQL view/RPC.
// ════════════════════════════════════════════════════════════════════════════

export type TaxToPay = {
  vatRate: number; // fraction, e.g. 0.18
  vatOnSales: number; // VAT on receipt (needs_invoice) orders' full totals
  vatOnOfficial: number; // VAT on official project/property income
  totalVat: number; // sum of the two — VAT owed on all official income
  paid: number; // sum of tax-category expenses
  owed: number; // totalVat − paid
  payments: TaxPayment[]; // history of tax-category expenses, newest first
};

export type TaxPayment = {
  id: string;
  date: string;
  amount: number;
  notes: string | null;
};

/**
 * VAT carved out of a GROSS (VAT-inclusive) amount at the given rate.
 * For sales receipts the order total includes the VAT, so the tax slice is
 * gross × rate/(1+rate) — e.g. 118 @ 0.18 → 18. Pure + tested.
 */
export function carveVatFromGross(gross: number, rate: number): number {
  if (!Number.isFinite(gross) || !Number.isFinite(rate) || rate <= 0) return 0;
  return gross * (rate / (1 + rate));
}

type Row = Record<string, unknown>;

function num(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown) {
  return typeof value === "string" ? value : null;
}

/**
 * Tax-category expenses, resilient to a DB that hasn't run the payment-confirmation
 * / paid_date migrations yet: drop the missing column and retry (same variant-ladder
 * idiom as scanExpenseRows). Without those columns every row reads as a plain paid
 * expense dated on expense_date — exactly the pre-migration behaviour.
 */
async function fetchTaxExpenseRows(supabase: SupabaseClient): Promise<Row[]> {
  const selectVariants = [
    "id,expense_date,paid_date,amount,paid_amount,payment_status,notes",
    "id,expense_date,amount,paid_amount,payment_status,notes",
    "id,expense_date,amount,payment_status,notes",
    "id,expense_date,amount,notes",
  ] as const;

  let lastError: unknown = null;
  for (const select of selectVariants) {
    try {
      return await fetchAllPaged<Row>((from, to) =>
        supabase.from("expenses").select(select).eq("category", EXPENSE_TAX_CATEGORY).range(from, to)
      );
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "paid_date") ||
        isMissingColumnError(error, "paid_amount") ||
        isMissingColumnError(error, "payment_status")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function loadTaxToPay(supabase: SupabaseClient): Promise<TaxToPay> {
  const vatRate = await getCurrentVatRate(supabase);

  const [paymentRows, orderRows, projectRows, taxExpenseRows] = await Promise.all([
    fetchAllPaged<Row>((from, to) =>
      supabase
        .from("payments")
        .select("amount_total,vat_amount,payment_status,order_id,project_id")
        .range(from, to)
    ),
    // Only orders that need a receipt are taxable on the sales side. We owe VAT
    // on the FULL order total (accrual), so pull the totals + status.
    fetchAllPaged<Row>((from, to) =>
      supabase.from("orders").select("id,total_amount,status").eq("needs_invoice", true).range(from, to)
    ),
    // Price-includes-VAT projects: payments aren't flagged "official" so they carry
    // no stored vat_amount — their VAT is carved from the gross at the project's
    // frozen rate, exactly like sales receipts.
    fetchAllPaged<Row>((from, to) =>
      supabase.from("projects").select("id,vat_rate").eq("price_includes_vat", true).range(from, to)
    ),
    fetchTaxExpenseRows(supabase),
  ]);

  // ── Sales VAT (accrual): every receipt order owes VAT on its full total ──────
  let vatOnSales = 0;
  for (const r of orderRows) {
    if ((str(r.status)?.trim().toLowerCase() ?? "") === "cancelled") continue;
    vatOnSales += carveVatFromGross(num(r.total_amount), vatRate);
  }

  // project id → its frozen VAT rate (price-includes-VAT projects; fall back to current).
  const grossVatProjectRate = new Map<string, number>();
  for (const r of projectRows) {
    const id = str(r.id);
    if (!id) continue;
    const frozen = num(r.vat_rate);
    grossVatProjectRate.set(id, frozen > 0 ? frozen : vatRate);
  }

  // ── Official project / property VAT (accrual): the official payment is the ────
  // receipt event → counts even while pending; only bounced is excluded. Order-
  // linked payments are skipped (sales is already counted via order totals above).
  let vatOnOfficial = 0;
  for (const row of paymentRows) {
    if ((str(row.payment_status)?.trim().toLowerCase() ?? "") === "rejected") continue;
    if (str(row.order_id)) continue; // sales handled via order totals
    const storedVat = num(row.vat_amount);
    if (storedVat !== 0) {
      vatOnOfficial += storedVat; // net-priced project / property official split
      continue;
    }
    const projectId = str(row.project_id);
    const projectRate = projectId ? grossVatProjectRate.get(projectId) : undefined;
    if (projectRate) {
      vatOnOfficial += carveVatFromGross(num(row.amount_total), projectRate);
    }
  }

  const payments: TaxPayment[] = [];
  let paid = 0;
  for (const row of taxExpenseRows) {
    const status = str(row.payment_status)?.trim().toLowerCase() ?? "";
    // A tax payment counts once it is actually paid (paid / no-status legacy).
    const amount =
      status === "partial" ? Math.abs(num(row.paid_amount)) : Math.abs(num(row.amount));
    if (status === "not_paid" || status === "pending") continue;
    if (!amount) continue;
    paid += amount;
    payments.push({
      id: str(row.id) ?? "",
      date: str(row.paid_date) || str(row.expense_date) || "",
      amount,
      notes: str(row.notes),
    });
  }
  payments.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const vatOnSalesR = round(vatOnSales);
  const vatOnOfficialR = round(vatOnOfficial);
  const totalVat = round(vatOnSalesR + vatOnOfficialR);
  const paidR = round(paid);

  return {
    vatRate,
    vatOnSales: vatOnSalesR,
    vatOnOfficial: vatOnOfficialR,
    totalVat,
    paid: paidR,
    owed: round(totalVat - paidR),
    payments,
  };
}
