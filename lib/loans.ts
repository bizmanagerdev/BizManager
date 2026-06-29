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
// ════════════════════════════════════════════════════════════════════════════

export type LoanDirection = "taken" | "given";
export type LoanStatus = "active" | "partially_repaid" | "repaid" | "written_off";

export type LoanRepayment = {
  id: string;
  loan_id: string;
  repayment_date: string;
  amount: number;
  interest_amount: number;
  method: string | null;
  account_id: string | null;
  notes: string | null;
  created_at: string | null;
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
  status: LoanStatus;
  notes: string | null;
  created_at: string | null;
  // derived
  repayments: LoanRepayment[];
  repaidPrincipal: number;
  repaidInterest: number;
  repaidTotal: number;
  outstanding: number;
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
  };
}

export function deriveLoan(row: Row, repayments: LoanRepayment[]): Loan {
  const amount = num(row.amount);
  const repaidPrincipal = repayments.reduce(
    (sum, r) => sum + Math.max(r.amount - r.interest_amount, 0),
    0
  );
  const repaidInterest = repayments.reduce((sum, r) => sum + r.interest_amount, 0);
  const repaidTotal = repayments.reduce((sum, r) => sum + r.amount, 0);
  const outstanding = Math.max(amount - repaidPrincipal, 0);

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
    status: storedStatus,
    notes: str(row.notes),
    created_at: str(row.created_at),
    repayments,
    repaidPrincipal,
    repaidInterest,
    repaidTotal,
    outstanding,
    derivedStatus,
  };
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
      fetchAllPaged<Row>((from, to) =>
        supabase
          .from("loan_repayments")
          .select("id,loan_id,repayment_date,amount,interest_amount,method,account_id,notes,created_at")
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

    return loanRows.map((row) =>
      deriveLoan(row, repaymentsByLoan.get(str(row.id) ?? "") ?? [])
    );
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
