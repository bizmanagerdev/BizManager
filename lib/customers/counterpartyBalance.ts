import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLoans, type Loan } from "@/lib/loans";

/**
 * Everything one person owes the business and the business owes them, gathered
 * from the places it actually lives.
 *
 * The case this exists for: a worker who is also a customer. He can be on both
 * sides at once — an unpaid order (he owes us), a loan the business took FROM
 * him (we owe him), a loan the business lent him (he owes us), and his salary.
 * Each of those lives in a different table, and until now nothing put them on
 * one screen.
 *
 * WHAT IS NETTED AND WHAT ISN'T. Loans and unpaid orders are standing balances:
 * they sit where they are until somebody settles them, so netting them answers
 * a real question — "if we squared up today, who'd hand over what". Salary is
 * different: it accrues daily and clears on payday, so folding it into the same
 * net would make the number mean one thing on the 1st and another on the 28th.
 * It is carried here as its own field and deliberately left OUT of `net`.
 *
 * Nothing here writes anything or moves money between the two sides. The
 * financial engine still counts a receivable, a loan and a payroll liability
 * separately, exactly as before — this is a reading.
 */
export type CounterpartyBalance = {
  /** Open receivable on orders + projects. */
  salesOwedToUs: number;
  /** Outstanding principal on loans the business LENT this person. */
  loansOwedToUs: number;
  /** Outstanding principal on loans the business TOOK FROM this person. */
  loansOwedByUs: number;
  /** salesOwedToUs + loansOwedToUs */
  totalOwedToUs: number;
  /** loansOwedByUs (salary is not included — see above). */
  totalOwedByUs: number;
  /** totalOwedToUs − totalOwedByUs. Positive ⇒ they owe us on balance. */
  net: number;
  /**
   * Open payroll liability, when this person is also a worker. Reported beside
   * the net, never inside it. `null` when they aren't a worker.
   */
  payrollOwed: number | null;
};

function isOpen(loan: Loan) {
  return loan.derivedStatus !== "written_off" && loan.outstanding > 0.009;
}

/**
 * Outstanding loan principal for one counterparty, split by direction.
 * Best-effort: `fetchLoans` already returns [] when the loans tables are absent.
 */
export async function getCustomerLoanPositions(
  supabase: SupabaseClient,
  customerId: string
): Promise<{ owedToUs: number; owedByUs: number; loans: Loan[] }> {
  const loans = (await fetchLoans(supabase)).filter(
    (loan) => loan.counterparty_customer_id === customerId && isOpen(loan)
  );

  let owedToUs = 0;
  let owedByUs = 0;
  for (const loan of loans) {
    // 'given' = the business lent the money out, so it's owed back to us.
    // 'taken' = the business borrowed it, so we owe it.
    if (loan.direction === "given") owedToUs += loan.outstanding;
    else owedByUs += loan.outstanding;
  }

  return { owedToUs, owedByUs, loans };
}

export function buildCounterpartyBalance({
  salesOwedToUs,
  loansOwedToUs,
  loansOwedByUs,
  payrollOwed,
}: {
  salesOwedToUs: number;
  loansOwedToUs: number;
  loansOwedByUs: number;
  payrollOwed: number | null;
}): CounterpartyBalance {
  const sales = Math.max(salesOwedToUs, 0);
  const lent = Math.max(loansOwedToUs, 0);
  const borrowed = Math.max(loansOwedByUs, 0);
  const totalOwedToUs = sales + lent;
  const totalOwedByUs = borrowed;

  return {
    salesOwedToUs: sales,
    loansOwedToUs: lent,
    loansOwedByUs: borrowed,
    totalOwedToUs,
    totalOwedByUs,
    net: totalOwedToUs - totalOwedByUs,
    payrollOwed: payrollOwed === null ? null : Math.max(payrollOwed, 0),
  };
}

/** True when there is anything at all worth drawing the card for. */
export function hasAnyPosition(balance: CounterpartyBalance): boolean {
  return (
    balance.totalOwedToUs > 0.009 ||
    balance.totalOwedByUs > 0.009 ||
    (balance.payrollOwed ?? 0) > 0.009
  );
}
