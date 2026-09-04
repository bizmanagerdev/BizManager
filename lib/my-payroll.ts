import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMonthlyHoursSummary,
  toNumber,
  WORK_SESSIONS_TABLE,
  type MonthlyHoursSummary,
  type WorkSessionRow,
} from "@/lib/payroll";

/** Numeric coercion for view rows, which arrive as unknown-typed JSON. */
function num(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? toNumber(value) : 0;
}

/**
 * "השעות שלי" — everything the signed-in worker may see about his OWN work and
 * pay, and nothing about anyone else's.
 *
 * Every query filters on the caller's app user id AND is read through the
 * RLS-bound client, so the filter and the database agree; the self-scoped
 * policies live in supabase/migrations/20260810000000_worker_self_service.sql.
 * Amounts come from worker_debt_items_view — the same view the salary centre
 * uses — so the worker and the boss can never be looking at different numbers.
 */

export type MyDebtItem = {
  sourceType: "session" | "payslip";
  sourceId: string;
  periodMonth: string | null;
  sourceDate: string | null;
  workedMinutes: number;
  earned: number;
  paid: number;
  owed: number;
  status: string;
};

/** One `worker_payments` row — a payment recorded against the worker, however it's allocated. */
export type MyPaymentRow = {
  id: string;
  paymentDate: string | null;
  amount: number;
  method: string | null;
  referenceNumber: string | null;
  notes: string | null;
};

/** One `worker_payment_allocations` row — which session/payslip a payment (or part of it) settles. */
export type MyPaymentAllocationRow = {
  workerPaymentId: string;
  sourceType: "session" | "payslip";
  attendanceSessionId: string | null;
  payslipId: string | null;
  amount: number;
};

export type MyPayrollData = {
  sessions: WorkSessionRow[];
  months: MonthlyHoursSummary[];
  debtItems: MyDebtItem[];
  totals: { earned: number; paid: number; owed: number };
  payments: MyPaymentRow[];
  paymentAllocations: MyPaymentAllocationRow[];
  /** True when the pay figures couldn't be read — the UI says so instead of showing ₪0. */
  payUnavailable: boolean;
};

const SESSION_COLUMNS =
  "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id";

export async function loadMyPayroll(
  supabase: SupabaseClient,
  userId: string,
  opts?: { sessionLimit?: number }
): Promise<MyPayrollData> {
  const sessionLimit = opts?.sessionLimit ?? 300;

  const [sessionsResult, debtResult, paymentsResult, allocationsResult] = await Promise.all([
    supabase
      .from(WORK_SESSIONS_TABLE)
      .select(SESSION_COLUMNS)
      .eq("user_id", userId)
      .order("clock_in", { ascending: false })
      .range(0, sessionLimit - 1),
    supabase
      .from("worker_debt_items_view")
      .select("source_type,source_id,period_month,source_date,worked_minutes,earned_amount,paid_amount,owed_amount,payment_status")
      .eq("user_id", userId)
      .order("source_date", { ascending: false })
      .range(0, 499),
    supabase
      .from("worker_payments")
      .select("id,payment_date,amount,payment_method,reference_number,notes")
      .eq("user_id", userId)
      .order("payment_date", { ascending: false })
      .range(0, 199),
    // Not filtered by worker_payment_id: the RLS policy on this table already
    // restricts rows to allocations of THIS caller's own payments, so a plain
    // select reads exactly the same set a `.in(...)` on the payment ids above
    // would — without a second round trip to get those ids first.
    supabase
      .from("worker_payment_allocations")
      .select("worker_payment_id,source_type,attendance_session_id,payslip_id,amount")
      .range(0, 999),
  ]);

  const sessions = ((sessionsResult.data ?? []) as WorkSessionRow[]).filter((row) => row.id);

  const debtItems: MyDebtItem[] = ((debtResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    sourceType: row.source_type === "payslip" ? "payslip" : "session",
    sourceId: String(row.source_id ?? ""),
    periodMonth: typeof row.period_month === "string" ? row.period_month : null,
    sourceDate: typeof row.source_date === "string" ? row.source_date : null,
    workedMinutes: num(row.worked_minutes),
    earned: num(row.earned_amount),
    paid: num(row.paid_amount),
    owed: num(row.owed_amount),
    status: typeof row.payment_status === "string" ? row.payment_status : "unpaid",
  }));

  const totals = debtItems.reduce(
    (acc, item) => ({
      earned: acc.earned + item.earned,
      paid: acc.paid + item.paid,
      owed: acc.owed + item.owed,
    }),
    { earned: 0, paid: 0, owed: 0 }
  );

  const payments: MyPaymentRow[] = ((paymentsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id ?? ""),
    paymentDate: typeof row.payment_date === "string" ? row.payment_date : null,
    amount: num(row.amount),
    method: typeof row.payment_method === "string" ? row.payment_method : null,
    referenceNumber: typeof row.reference_number === "string" ? row.reference_number : null,
    notes: typeof row.notes === "string" ? row.notes : null,
  }));

  const paymentAllocations: MyPaymentAllocationRow[] = ((allocationsResult.data ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      workerPaymentId: String(row.worker_payment_id ?? ""),
      sourceType: row.source_type === "payslip" ? "payslip" : "session",
      attendanceSessionId: typeof row.attendance_session_id === "string" ? row.attendance_session_id : null,
      payslipId: typeof row.payslip_id === "string" ? row.payslip_id : null,
      amount: num(row.amount),
    })
  );

  return {
    sessions,
    months: buildMonthlyHoursSummary(sessions),
    debtItems,
    totals,
    payments,
    paymentAllocations,
    payUnavailable: Boolean(debtResult.error),
  };
}
