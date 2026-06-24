import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePaymentMethodValue } from "@/lib/orders/paymentStatus";
import { getBusinessDomainLabel } from "@/lib/expenses";

// ════════════════════════════════════════════════════════════════════════════
// Bank-transfer activity: every payment/expense whose method is "העברה בנקאית",
// in and out. This is NOT a reconciled bank balance (there's no opening balance
// and cash/check/card movements aren't here) — it's "what moved through the bank
// by transfer", so you can see what's coming in.
// ════════════════════════════════════════════════════════════════════════════

export type BankTransaction = {
  id: string;
  date: string;
  type: "in" | "out";
  amount: number;
  label: string;
  domainLabel: string | null;
};

export type BankTransfersReport = {
  transactions: BankTransaction[]; // newest first
  totalIn: number;
  totalOut: number;
  net: number;
  monthsBack: number;
};

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

function isBankTransfer(method: unknown) {
  return normalizePaymentMethodValue(str(method)) === "bank_transfer";
}

export async function loadBankTransfers(
  supabase: SupabaseClient,
  { monthsBack = 12 }: { monthsBack?: number } = {}
): Promise<BankTransfersReport> {
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const sinceIso = since.toISOString().slice(0, 10);

  const [paymentsResult, expensesResult] = await Promise.all([
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,business_domain,notes")
      .gte("payment_date", sinceIso)
      .range(0, 20000),
    supabase
      .from("expenses")
      .select("id,expense_date,amount,payment_method,business_domain,category,description")
      .gte("expense_date", sinceIso)
      .range(0, 20000),
  ]);

  const transactions: BankTransaction[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (const row of (paymentsResult.data ?? []) as Row[]) {
    if (!isBankTransfer(row.payment_method)) continue;
    const date = str(row.payment_date);
    const amount = Math.abs(num(row.amount_total));
    if (!date || !amount) continue;
    totalIn += amount;
    transactions.push({
      id: `p:${str(row.id) ?? ""}`,
      date,
      type: "in",
      amount,
      label: str(row.notes)?.trim() || "תקבול בהעברה",
      domainLabel: row.business_domain ? getBusinessDomainLabel(str(row.business_domain)) : null,
    });
  }

  for (const row of (expensesResult.data ?? []) as Row[]) {
    if (!isBankTransfer(row.payment_method)) continue;
    const date = str(row.expense_date);
    const amount = Math.abs(num(row.amount));
    if (!date || !amount) continue;
    totalOut += amount;
    transactions.push({
      id: `e:${str(row.id) ?? ""}`,
      date,
      type: "out",
      amount,
      label: str(row.description)?.trim() || str(row.category)?.trim() || "תשלום בהעברה",
      domainLabel: row.business_domain ? getBusinessDomainLabel(str(row.business_domain)) : null,
    });
  }

  transactions.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  return { transactions, totalIn, totalOut, net: totalIn - totalOut, monthsBack };
}
