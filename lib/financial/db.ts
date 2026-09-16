import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SCAN_CHUNK_SIZE,
  ID_CHUNK_SIZE,
  type AttendanceSessionFinanceRow,
  type ExpenseRow,
  type LeaseAgreementRow,
  type OrderFinancialRow,
  type OrderRow,
  type PaymentRow,
  type ProjectExpenseLinkRow,
  type ProjectFinancialRow,
  type ProjectRow,
  type PropertyRow,
  type SalaryAgreementLiteRow,
  type WorkerDebtItemRow,
  type WorkerPaymentAllocationRow,
  type WorkerPaymentRow,
  type WorkerUserRow,
} from "./types";
import { chunkStrings, isMissingColumnError, uniqueStrings } from "./utils";

async function scanRows<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  selectColumns: string,
  dateColumn: string,
  since?: string | null,
  // A second date column that can also put a row inside the window. Payments
  // need this: a post-dated check is dated when it was HANDED OVER but is money
  // on its due_date, so scanning on payment_date alone silently drops a check
  // written more than `since` ago and cashable next month. (lib/accounts.ts has
  // always read payments this way; the ledger scan did not.)
  orDateColumn?: string
) {
  const rows: T[] = [];
  for (let rangeStart = 0; ; rangeStart += SCAN_CHUNK_SIZE) {
    const rangeEnd = rangeStart + SCAN_CHUNK_SIZE - 1;
    let q = supabase
      .from(table)
      .select(selectColumns)
      .not(dateColumn, "is", null)
      .order(dateColumn, { ascending: false })
      .order("id", { ascending: false });
    if (since) q = orDateColumn ? q.or(`${dateColumn}.gte.${since},${orDateColumn}.gte.${since}`) : q.gte(dateColumn, since);
    const { data, error } = await q.range(rangeStart, rangeEnd);
    if (error) throw error;
    const chunk = (data ?? []) as unknown as T[];
    if (chunk.length === 0) break;
    rows.push(...chunk);
    if (chunk.length < SCAN_CHUNK_SIZE) break;
  }
  return rows;
}

export async function scanPaymentRows(supabase: SupabaseClient, since?: string | null) {
  // target_type/target_id are never real columns on this table (no migration
  // anywhere defines them — confirmed live 2026-09-14 as a real, repeated
  // "column payments.target_type does not exist" under real load), but every
  // call used to try them FIRST regardless, guaranteed to fail. The variant
  // that never touches them now goes first; the two dead variants stay at
  // the end purely as a harmless safety net.
  const selectVariants = [
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,project_id,order_id,property_id,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,recorded_by",
    "id,payment_date,amount_total,payment_method,reference_number,business_domain,notes,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,project_id,order_id,property_id,target_type,target_id,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,target_type,target_id,recorded_by",
  ] as const;

  let lastError: unknown = null;
  for (const selectColumns of selectVariants) {
    try {
      // Only the variants that actually select due_date can filter on it; the
      // fallbacks below exist precisely for a schema without that column.
      const orColumn = selectColumns.includes("due_date") ? "due_date" : undefined;
      return await scanRows<PaymentRow>(supabase, "payments", selectColumns, "payment_date", since, orColumn);
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "target_type") ||
        isMissingColumnError(error, "target_id") ||
        isMissingColumnError(error, "project_id") ||
        isMissingColumnError(error, "order_id") ||
        isMissingColumnError(error, "property_id") ||
        isMissingColumnError(error, "due_date") ||
        isMissingColumnError(error, "payment_status")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function scanExpenseRows(supabase: SupabaseClient, since?: string | null) {
  const selectVariants = [
    "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by,payment_status,paid_amount,payment_method,paid_date,account_id,installment_group_id,installment_index,installment_count,recurring_expense_template_id",
    "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by,payment_status,paid_amount,payment_method,paid_date,account_id,installment_group_id,installment_index,installment_count",
    "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by,payment_status,paid_amount,payment_method,paid_date,account_id",
    "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by,payment_status,paid_amount,payment_method,paid_date",
    "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by,payment_status,paid_amount,payment_method",
    "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by,payment_status",
    "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by",
  ] as const;

  let lastError: unknown = null;
  for (const selectColumns of selectVariants) {
    try {
      const rows = await scanRows<Record<string, unknown>>(supabase, "expenses", selectColumns, "expense_date", since);
      return rows as ExpenseRow[];
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "recurring_expense_template_id") ||
        isMissingColumnError(error, "installment_group_id") ||
        isMissingColumnError(error, "installment_index") ||
        isMissingColumnError(error, "installment_count") ||
        isMissingColumnError(error, "account_id") ||
        isMissingColumnError(error, "paid_date") ||
        isMissingColumnError(error, "payment_status") ||
        isMissingColumnError(error, "paid_amount") ||
        isMissingColumnError(error, "payment_method")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function scanWorkerPaymentRows(supabase: SupabaseClient, since?: string | null) {
  return scanRows<WorkerPaymentRow>(
    supabase,
    "worker_payments",
    "id,user_id,payment_date,amount,payment_method,reference_number,notes,recorded_by",
    "payment_date",
    since
  );
}

export async function scanWorkerDebtItemRows(supabase: SupabaseClient, since?: string | null) {
  const selectVariants = [
    "source_type,source_id,user_id,project_id,source_date,due_date,period_month,owed_amount,payment_status,business_domain,property_id",
    "source_type,source_id,user_id,project_id,source_date,due_date,period_month,owed_amount,payment_status,business_domain",
    "source_type,source_id,user_id,project_id,source_date,due_date,period_month,owed_amount,payment_status",
    "source_type,source_id,user_id,project_id,source_date,period_month,owed_amount,payment_status",
    "source_type,source_id,user_id,project_id,source_date,due_date,owed_amount,payment_status",
    "source_type,source_id,user_id,project_id,source_date,owed_amount,payment_status",
    "source_type,source_id,user_id,source_date,due_date,period_month,owed_amount,payment_status",
    "source_type,source_id,user_id,source_date,period_month,owed_amount,payment_status",
    "source_type,source_id,user_id,source_date,owed_amount,payment_status",
  ] as const;

  let lastError: unknown = null;
  for (const selectColumns of selectVariants) {
    try {
      const rows: WorkerDebtItemRow[] = [];
      for (let rangeStart = 0; ; rangeStart += SCAN_CHUNK_SIZE) {
        const rangeEnd = rangeStart + SCAN_CHUNK_SIZE - 1;
        let q = supabase
          .from("worker_debt_items_view")
          .select(selectColumns)
          .not("source_date", "is", null)
          .order("source_date", { ascending: false })
          .order("source_id", { ascending: false });
        if (since) q = q.gte("source_date", since);
        const { data, error } = await q.range(rangeStart, rangeEnd);
        if (error) throw error;
        const chunk = (data ?? []) as unknown as WorkerDebtItemRow[];
        if (chunk.length === 0) break;
        rows.push(...chunk);
        if (chunk.length < SCAN_CHUNK_SIZE) break;
      }
      return rows;
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "project_id") ||
        isMissingColumnError(error, "due_date") ||
        isMissingColumnError(error, "period_month") ||
        isMissingColumnError(error, "payment_status") ||
        isMissingColumnError(error, "business_domain") ||
        isMissingColumnError(error, "property_id")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function fetchProjectsByIds(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, ProjectRow>();
  for (const chunk of chunkStrings(uniqueStrings(ids), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,customer_id,status,start_date,end_date")
      .in("id", chunk);
    if (error) throw error;
    ((data ?? []) as ProjectRow[]).forEach((row) => { if (row.id) map.set(row.id, row); });
  }
  return map;
}

export async function scanProjectRows(supabase: SupabaseClient, since?: string | null) {
  return scanRows<ProjectRow>(
    supabase,
    "projects",
    "id,name,customer_id,agreed_base_price,actual_price,created_at,start_date,end_date,status",
    "created_at",
    since
  );
}

export async function fetchOrdersByIds(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, OrderRow>();
  for (const chunk of chunkStrings(uniqueStrings(ids), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("orders")
      .select("id,customer_id,order_date,status,total_amount,payment_status")
      .in("id", chunk);
    if (error) throw error;
    ((data ?? []) as OrderRow[]).forEach((row) => { if (row.id) map.set(row.id, row); });
  }
  return map;
}

export async function scanOrderRows(supabase: SupabaseClient, since?: string | null) {
  return scanRows<OrderRow>(
    supabase,
    "orders",
    "id,customer_id,order_date,status,total_amount,payment_status",
    "order_date",
    since
  );
}

export async function fetchPropertiesByIds(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, PropertyRow>();
  for (const chunk of chunkStrings(uniqueStrings(ids), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("properties")
      .select("id,address")
      .in("id", chunk);
    if (error) throw error;
    ((data ?? []) as PropertyRow[]).forEach((row) => { if (row.id) map.set(row.id, row); });
  }
  return map;
}

export async function fetchPropertyCustomerLinks(supabase: SupabaseClient, propertyIds: string[]) {
  const map = new Map<string, Set<string>>();
  for (const chunk of chunkStrings(uniqueStrings(propertyIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("lease_agreements")
      .select("property_id,customer_id")
      .in("property_id", chunk);
    if (error) throw error;
    ((data ?? []) as LeaseAgreementRow[]).forEach((row) => {
      if (!row.property_id || !row.customer_id) return;
      const current = map.get(row.property_id) ?? new Set<string>();
      current.add(row.customer_id);
      map.set(row.property_id, current);
    });
  }
  return map;
}

export async function fetchProjectFinancialsByIds(supabase: SupabaseClient, projectIds: string[]) {
  const map = new Map<string, ProjectFinancialRow>();
  for (const chunk of chunkStrings(uniqueStrings(projectIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("project_financials_view")
      .select("id,customer_total_price,expenses_billed")
      .in("id", chunk);
    if (error) throw error;
    ((data ?? []) as ProjectFinancialRow[]).forEach((row) => { if (row.id) map.set(row.id, row); });
  }
  return map;
}

export async function fetchOrderFinancialsByIds(supabase: SupabaseClient, orderIds: string[]) {
  const safeOrderIds = uniqueStrings(orderIds);
  const map = new Map<string, OrderFinancialRow>();
  const selectVariants = [
    { select: "id,total_amount,total_paid,remaining_balance,payment_status", idColumn: "id", readId: (row: OrderFinancialRow) => row.id },
    { select: "order_id,total_amount,total_paid,remaining_balance,payment_status", idColumn: "order_id", readId: (row: OrderFinancialRow) => row.order_id ?? null },
    { select: "id,total_amount,remaining_balance,payment_status", idColumn: "id", readId: (row: OrderFinancialRow) => row.id },
    { select: "order_id,total_amount,remaining_balance,payment_status", idColumn: "order_id", readId: (row: OrderFinancialRow) => row.order_id ?? null },
    { select: "id,total_amount,remaining_balance", idColumn: "id", readId: (row: OrderFinancialRow) => row.id },
    { select: "order_id,total_amount,remaining_balance", idColumn: "order_id", readId: (row: OrderFinancialRow) => row.order_id ?? null },
  ] as const;

  let lastError: unknown = null;
  for (const variant of selectVariants) {
    try {
      for (const chunk of chunkStrings(safeOrderIds, ID_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .from("order_financials_view")
          .select(variant.select)
          .in(variant.idColumn, chunk);
        if (error) throw error;
        ((data ?? []) as unknown as OrderFinancialRow[]).forEach((row) => {
          const id = variant.readId(row);
          if (!id) return;
          map.set(id, { ...row, id });
        });
      }
      return map;
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "id") ||
        isMissingColumnError(error, "order_id") ||
        isMissingColumnError(error, "total_paid") ||
        isMissingColumnError(error, "remaining_balance") ||
        isMissingColumnError(error, "payment_status")
      ) {
        map.clear();
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function fetchProjectExpenseLinksByExpenseIds(supabase: SupabaseClient, expenseIds: string[]) {
  const map = new Map<string, string>();
  for (const chunk of chunkStrings(uniqueStrings(expenseIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("project_expenses")
      .select("expense_id,project_id")
      .in("expense_id", chunk);
    if (error) throw error;
    ((data ?? []) as ProjectExpenseLinkRow[]).forEach((row) => {
      if (!row.expense_id || !row.project_id || map.has(row.expense_id)) return;
      map.set(row.expense_id, row.project_id);
    });
  }
  return map;
}

export async function fetchWorkerUsersByIds(supabase: SupabaseClient, userIds: string[]) {
  const map = new Map<string, WorkerUserRow>();
  for (const chunk of chunkStrings(uniqueStrings(userIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("users")
      .select("id,pay_tracking_mode")
      .in("id", chunk);
    if (error) throw error;
    ((data ?? []) as WorkerUserRow[]).forEach((row) => { if (row.id) map.set(row.id, row); });
  }
  return map;
}

export async function fetchSalaryAgreementsByUserIds(supabase: SupabaseClient, userIds: string[]) {
  const rows: SalaryAgreementLiteRow[] = [];
  for (const chunk of chunkStrings(uniqueStrings(userIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("salary_agreements")
      .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to")
      .in("user_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as SalaryAgreementLiteRow[]));
  }
  return rows;
}

export async function fetchWorkerPaymentAllocationsByPaymentIds(
  supabase: SupabaseClient,
  workerPaymentIds: string[]
) {
  const rows: WorkerPaymentAllocationRow[] = [];
  for (const chunk of chunkStrings(uniqueStrings(workerPaymentIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("worker_payment_allocations")
      .select("id,worker_payment_id,source_type,attendance_session_id,payslip_id,amount")
      .in("worker_payment_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as WorkerPaymentAllocationRow[]));
  }
  return rows;
}

export async function scanAttendanceSessionRows(supabase: SupabaseClient, since?: string | null) {
  // paid_amount/owed_amount/payment_status are NEVER real columns on this table
  // (confirmed live 2026-09-14: worker_debt_items_view and
  // session_effective_payment_view compute them by JOINing worker_payments/
  // worker_payment_allocations — a plain column here couldn't do that) — but
  // every call used to try all 6 combinations of them FIRST regardless,
  // guaranteed to fail every time. That was dozens of wasted round-trips
  // within seconds under real load, landing in the same window as actual
  // Postgres statement timeouts on unrelated views. The two variants that
  // never touch those three columns now go first; the old payment-field
  // variants stay at the end purely as a harmless safety net.
  const selectVariants = [
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost",
    "id,user_id,clock_in,business_domain,project_id,property_id",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,owed_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,owed_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,owed_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,owed_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,payment_status",
  ] as const;

  let lastError: unknown = null;
  for (const selectColumns of selectVariants) {
    try {
      return await scanRows<AttendanceSessionFinanceRow>(supabase, "attendance_sessions", selectColumns, "clock_in", since);
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "paid_amount") ||
        isMissingColumnError(error, "owed_amount") ||
        isMissingColumnError(error, "payment_status") ||
        isMissingColumnError(error, "labor_cost") ||
        isMissingColumnError(error, "project_id") ||
        isMissingColumnError(error, "property_id") ||
        isMissingColumnError(error, "business_domain")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function resolveCustomerProjectIds(supabase: SupabaseClient, customerId: string | null) {
  if (!customerId) return [] as string[];
  const { data, error } = await supabase.from("projects").select("id").eq("customer_id", customerId);
  if (error) throw error;
  return ((data ?? []) as Array<{ id?: string | null }>)
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((value): value is string => Boolean(value));
}

export type RecurringTemplateMeta = { name: string; variable: boolean };

/**
 * Recurring template id → { name, variable }, for the expense rows a template
 * generated: the name labels them (it is what the הוצאות קבועות list and the
 * payments calendar show; many generated rows carry no description of their
 * own), and `variable` marks a row whose amount is only an ESTIMATE until it is
 * confirmed with the real figure. Empty on any error — a label fallback must
 * never fail the scan.
 */
export async function fetchRecurringTemplateMeta(supabase: SupabaseClient): Promise<Map<string, RecurringTemplateMeta>> {
  try {
    const { data, error } = await supabase.from("recurring_expense_templates").select("id,template_name,is_variable_amount");
    if (error) return new Map();
    const meta = new Map<string, RecurringTemplateMeta>();
    for (const row of (data ?? []) as Array<{ id: string | null; template_name: string | null; is_variable_amount: boolean | null }>) {
      const name = row.template_name?.trim();
      if (row.id && name) meta.set(row.id, { name, variable: row.is_variable_amount === true });
    }
    return meta;
  } catch {
    return new Map();
  }
}
