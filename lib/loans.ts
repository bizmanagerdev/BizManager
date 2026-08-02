import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";

// ════════════════════════════════════════════════════════════════════════════
// Loans & repayments (הלוואות והחזרות). Shared between the loans UI and the
// financial engine. See db/sql/create_loans.sql.
//
//   direction 'taken' = the business BORROWED (cash in now, we owe)
//   direction 'given' = the business LENT   (cash out now, owed to us)
//
// outstanding = amount − principal repaid. Principal repaid = Σ(repayment.amount
// − repayment.interest_amount). Only interest hits P&L (see buildLoanEntries).
//
// A loan_repayments row is either a PLANNED installment (status 'planned' — a
// future obligation on a date; forecast only, does NOT reduce outstanding) or an
// actual repayment (status 'paid' — cash moved). See the installment-plan
// migration (supabase/migrations/20260802000000_loan_installment_plan.sql).
// ════════════════════════════════════════════════════════════════════════════

export type LoanDirection = "taken" | "given";
export type LoanStatus = "active" | "partially_repaid" | "repaid" | "written_off";
export type LoanRepaymentStatus = "planned" | "paid";

export type LoanRepayment = {
  id: string;
  loan_id: string;
  /** Planned rows: the date the installment is due. Paid rows: the date it moved. */
  repayment_date: string;
  amount: number;
  interest_amount: number;
  method: string | null;
  account_id: string | null;
  notes: string | null;
  created_at: string | null;
  status: LoanRepaymentStatus;
  /** "תשלום 2 מתוך 5" — position in the plan this row came from (nullable). */
  installment_index: number | null;
  installment_count: number | null;
};

export type Loan = {
  id: string;
  direction: LoanDirection;
  lender: string | null;
  borrower: string | null;
  loan_date: string;
  loan_method: string | null;
  repayment_method: string | null;
  account_id: string | null;
  documentation: string | null;
  amount: number;
  due_date: string | null;
  interest_amount: number;
  business_domain: string;
  counterparty_customer_id: string | null;
  counterparty_phone: string | null;
  status: LoanStatus;
  notes: string | null;
  created_at: string | null;
  // derived
  /** Every row (planned + paid), oldest first. */
  repayments: LoanRepayment[];
  /** Repayments that actually moved cash (status 'paid'), oldest first. */
  paidRepayments: LoanRepayment[];
  /** Future obligations that haven't been paid yet (status 'planned'), by due date. */
  plannedInstallments: LoanRepayment[];
  repaidPrincipal: number;
  repaidInterest: number;
  repaidTotal: number;
  outstanding: number;
  /** Principal covered by the plan (planned installments, interest excluded). */
  scheduledPrincipal: number;
  /** Total cash the plan still expects to move (principal + planned interest). */
  scheduledTotal: number;
  /** Outstanding principal with no installment planned for it yet. */
  unscheduledPrincipal: number;
  /** The nearest planned installment (earliest due date), if any. */
  nextInstallment: LoanRepayment | null;
  derivedStatus: LoanStatus;
};

export type LoansSummary = {
  borrowedOutstanding: number; // taken loans we still owe (a liability)
  lentOutstanding: number; // given loans still owed to us (an asset)
  borrowedCount: number;
  lentCount: number;
  borrowedActiveCount: number;
  lentActiveCount: number;
  netPosition: number; // lentOutstanding − borrowedOutstanding (asset − debt)
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

function intOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function normalizeRepayment(row: Row): LoanRepayment {
  return {
    id: str(row.id) ?? "",
    loan_id: str(row.loan_id) ?? "",
    repayment_date: str(row.repayment_date) ?? "",
    amount: num(row.amount),
    interest_amount: num(row.interest_amount),
    method: str(row.method),
    account_id: str(row.account_id),
    notes: str(row.notes),
    created_at: str(row.created_at),
    // Anything that isn't explicitly 'planned' is a real repayment — keeps rows
    // written before the installment-plan migration behaving exactly as before.
    status: str(row.status) === "planned" ? "planned" : "paid",
    installment_index: intOrNull(row.installment_index),
    installment_count: intOrNull(row.installment_count),
  };
}

function byDate(a: LoanRepayment, b: LoanRepayment) {
  return a.repayment_date.localeCompare(b.repayment_date);
}

export function deriveLoan(row: Row, repayments: LoanRepayment[]): Loan {
  const amount = num(row.amount);
  const paidRepayments = repayments.filter((r) => r.status !== "planned").sort(byDate);
  const plannedInstallments = repayments.filter((r) => r.status === "planned").sort(byDate);

  const repaidPrincipal = paidRepayments.reduce(
    (sum, r) => sum + Math.max(r.amount - r.interest_amount, 0),
    0
  );
  const repaidInterest = paidRepayments.reduce((sum, r) => sum + r.interest_amount, 0);
  const repaidTotal = paidRepayments.reduce((sum, r) => sum + r.amount, 0);
  const outstanding = Math.max(amount - repaidPrincipal, 0);

  const scheduledPrincipal = plannedInstallments.reduce(
    (sum, r) => sum + Math.max(r.amount - r.interest_amount, 0),
    0
  );
  const scheduledTotal = plannedInstallments.reduce((sum, r) => sum + r.amount, 0);

  const storedStatus = (str(row.status) ?? "active") as LoanStatus;
  const derivedStatus: LoanStatus =
    storedStatus === "written_off"
      ? "written_off"
      : outstanding <= 0.009
        ? "repaid"
        : repaidPrincipal > 0.009
          ? "partially_repaid"
          : "active";

  return {
    id: str(row.id) ?? "",
    direction: (str(row.direction) ?? "taken") as LoanDirection,
    lender: str(row.lender),
    borrower: str(row.borrower),
    loan_date: str(row.loan_date) ?? "",
    loan_method: str(row.loan_method),
    repayment_method: str(row.repayment_method),
    account_id: str(row.account_id),
    documentation: str(row.documentation),
    amount,
    due_date: str(row.due_date),
    interest_amount: num(row.interest_amount),
    business_domain: str(row.business_domain) ?? "general_business",
    counterparty_customer_id: str(row.counterparty_customer_id),
    counterparty_phone: null,
    status: storedStatus,
    notes: str(row.notes),
    created_at: str(row.created_at),
    repayments: repayments.slice().sort(byDate),
    paidRepayments,
    plannedInstallments,
    repaidPrincipal,
    repaidInterest,
    repaidTotal,
    outstanding,
    scheduledPrincipal,
    scheduledTotal,
    unscheduledPrincipal: Math.max(outstanding - scheduledPrincipal, 0),
    nextInstallment: plannedInstallments[0] ?? null,
    derivedStatus,
  };
}

/** Planned installments whose due date has already passed (nothing recorded yet). */
export function overdueInstallments(loan: Loan, todayIso: string): LoanRepayment[] {
  return loan.plannedInstallments.filter((i) => i.repayment_date < todayIso);
}

/**
 * Build an installment plan: `count` payments of `total / count` starting at
 * `firstDate`, one every `intervalMonths` months (or every `intervalDays` days).
 * Rounding drift lands on the LAST installment so the plan sums to `total` exactly.
 */
export function buildInstallmentSchedule({
  total,
  count,
  firstDate,
  intervalMonths = 1,
  intervalDays = 0,
}: {
  total: number;
  count: number;
  firstDate: string;
  intervalMonths?: number;
  intervalDays?: number;
}): Array<{ date: string; amount: number }> {
  const n = Math.max(1, Math.round(count));
  if (!firstDate || !(total > 0)) return [];
  const each = Math.round((total / n) * 100) / 100;
  const rows: Array<{ date: string; amount: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const amount = i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each;
    rows.push({ date: addInterval(firstDate, i, intervalMonths, intervalDays), amount });
  }
  return rows;
}

/** firstDate + step × (months | days), clamping to the last day of a short month. */
function addInterval(firstDate: string, step: number, months: number, days: number): string {
  const [y, m, d] = firstDate.split("-").map(Number);
  if (!y || !m || !d) return firstDate;
  if (days > 0) {
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days * step);
    return date.toISOString().slice(0, 10);
  }
  const targetMonth = m - 1 + months * step;
  const year = y + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Fetch every loan with its repayments and derived totals. Resilient: returns an
 * empty list if the loans tables don't exist yet (before the SQL is run) or the
 * caller lacks access.
 */
export async function fetchLoans(supabase: SupabaseClient): Promise<Loan[]> {
  try {
    const [loanRows, repaymentRows] = await Promise.all([
      fetchAllPaged<Row>((from, to) =>
        supabase
          .from("loans")
          .select(
            "id,direction,lender,borrower,loan_date,loan_method,repayment_method,documentation,amount,due_date,interest_amount,business_domain,counterparty_customer_id,status,notes,account_id,created_at"
          )
          .order("loan_date", { ascending: false })
          .range(from, to)
      ),
      // `*` on purpose: the installment columns (status / installment_index /
      // installment_count) may not exist yet on a database where the plan
      // migration hasn't run — an explicit list would error the whole page.
      fetchAllPaged<Row>((from, to) =>
        supabase
          .from("loan_repayments")
          .select("*")
          .order("repayment_date", { ascending: true })
          .range(from, to)
      ),
    ]);

    const repaymentsByLoan = new Map<string, LoanRepayment[]>();
    for (const row of repaymentRows) {
      const repayment = normalizeRepayment(row);
      if (!repayment.loan_id) continue;
      const list = repaymentsByLoan.get(repayment.loan_id) ?? [];
      list.push(repayment);
      repaymentsByLoan.set(repayment.loan_id, list);
    }

    const loans = loanRows.map((row) =>
      deriveLoan(row, repaymentsByLoan.get(str(row.id) ?? "") ?? [])
    );

    // Enrich loans linked to a customer with that customer's phone so the list
    // can show a number next to the name (project rule).
    const counterpartyIds = Array.from(
      new Set(loans.map((loan) => loan.counterparty_customer_id).filter((id): id is string => Boolean(id)))
    );
    if (counterpartyIds.length > 0) {
      const { data: phoneRows } = await supabase
        .from("customer_overview_view")
        .select("customer_id,phone")
        .in("customer_id", counterpartyIds);
      const phoneByCustomerId = new Map<string, string | null>();
      ((phoneRows ?? []) as Row[]).forEach((row) => {
        const id = str(row.customer_id);
        if (id) phoneByCustomerId.set(id, str(row.phone));
      });
      for (const loan of loans) {
        if (loan.counterparty_customer_id) {
          loan.counterparty_phone = phoneByCustomerId.get(loan.counterparty_customer_id) ?? null;
        }
      }
    }

    return loans;
  } catch {
    return [];
  }
}

export function summarizeLoans(loans: Loan[]): LoansSummary {
  const summary: LoansSummary = {
    borrowedOutstanding: 0,
    lentOutstanding: 0,
    borrowedCount: 0,
    lentCount: 0,
    borrowedActiveCount: 0,
    lentActiveCount: 0,
    netPosition: 0,
  };

  for (const loan of loans) {
    // Written-off loans carry no live debt/asset.
    const outstanding = loan.derivedStatus === "written_off" ? 0 : loan.outstanding;
    const isOpen = outstanding > 0.009;
    if (loan.direction === "taken") {
      summary.borrowedCount += 1;
      summary.borrowedOutstanding += outstanding;
      if (isOpen) summary.borrowedActiveCount += 1;
    } else {
      summary.lentCount += 1;
      summary.lentOutstanding += outstanding;
      if (isOpen) summary.lentActiveCount += 1;
    }
  }

  summary.netPosition = summary.lentOutstanding - summary.borrowedOutstanding;
  return summary;
}

export function loanStatusLabel(status: LoanStatus): string {
  switch (status) {
    case "repaid":
      return "נפרע";
    case "partially_repaid":
      return "נפרע חלקית";
    case "written_off":
      return "נמחק";
    default:
      return "פעיל";
  }
}

export function loanDirectionLabel(direction: LoanDirection): string {
  return direction === "taken" ? "הלוואה שלקחתי" : "הלוואה שנתתי";
}
