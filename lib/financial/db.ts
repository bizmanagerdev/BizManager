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
  since?: string | null
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
    if (since) q = q.gte(dateColumn, since);
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
  const selectVariants = [
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,project_id,order_id,property_id,target_type,target_id,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,project_id,order_id,property_id,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,target_type,target_id,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,recorded_by",
    "id,payment_date,amount_total,payment_method,reference_number,business_domain,notes,recorded_by",
  ] as const;

  let lastError: unknown = null;
  for (const selectColumns of selectVariants) {
    try {
      return await scanRows<PaymentRow>(supabase, "payments", selectColumns, "payment_date", since);
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
    "id,expense_date,amount,payment_method,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by",
    "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by",
  ] as const;

  let lastError: unknown = null;
  for (const selectColumns of selectVariants) {
    try {
      const rows = await scanRows<Record<string, unknown>>(supabase, "expenses", selectColumns, "expense_date", since);
      return rows.map((row) => ({
        ...row,
        payment_method: typeof row.payment_method === "string" ? row.payment_method : null,
      })) as ExpenseRow[];
    } catch (error) {
      lastError = error;
      if (isMissingColumnError(error, "payment_method")) continue;
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
  const selectVariants = [
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,owed_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,owed_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,owed_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,owed_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost",
    "id,user_id,clock_in,business_domain,project_id,property_id",
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
