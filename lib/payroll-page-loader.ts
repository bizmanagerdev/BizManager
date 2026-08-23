import type { SupabaseClient } from "@supabase/supabase-js";
import { collectLockedSessionIds, type SalaryCenterProjectOption, type SalaryCenterUserRow, type SessionPublicRow } from "@/lib/payroll-center";
import type { PayrollPeriodRow } from "@/lib/payroll";
import { isPayrollWorkerType } from "@/lib/payroll-worker-type";

type Row = Record<string, unknown>;

function mapUsers(rows: Row[] | null | undefined): SalaryCenterUserRow[] {
  return ((rows ?? []) as Array<Row>).map((row) => ({
    id: typeof row.id === "string" ? row.id : "",
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    role: typeof row.role === "string" ? row.role : null,
    active: typeof row.active === "boolean" ? row.active : null,
    system_access: typeof row.system_access === "boolean" ? row.system_access : null,
    payroll_worker_type: isPayrollWorkerType(row.payroll_worker_type) ? row.payroll_worker_type : null,
    pay_tracking_mode:
      row.pay_tracking_mode === "session" || row.pay_tracking_mode === "payslip"
        ? row.pay_tracking_mode
        : null,
    locale: row.locale === "ar" ? "ar" : "he",
    deliveries_access: row.deliveries_access !== false,
  }));
}

function mapSessions(rows: Row[] | null | undefined, lockedIds: Set<string>): SessionPublicRow[] {
  return ((rows ?? []) as Array<Row>).map((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    return {
      id,
      user_id: typeof row.user_id === "string" ? row.user_id : "",
      clock_in: typeof row.clock_in === "string" ? row.clock_in : "",
      clock_out: typeof row.clock_out === "string" ? row.clock_out : null,
      worked_minutes:
        typeof row.worked_minutes === "number" || typeof row.worked_minutes === "string"
          ? row.worked_minutes
          : null,
      labor_cost:
        typeof row.labor_cost === "number" || typeof row.labor_cost === "string"
          ? row.labor_cost
          : null,
      is_billable_to_customer:
        typeof row.is_billable_to_customer === "boolean" ? row.is_billable_to_customer : null,
      bill_to_customer_amount:
        typeof row.bill_to_customer_amount === "number" || typeof row.bill_to_customer_amount === "string"
          ? row.bill_to_customer_amount
          : null,
      billing_status: typeof row.billing_status === "string" ? row.billing_status : null,
      notes: typeof row.notes === "string" ? row.notes : null,
      business_domain: typeof row.business_domain === "string" ? row.business_domain : null,
      project_id: typeof row.project_id === "string" ? row.project_id : null,
      property_id: typeof row.property_id === "string" ? row.property_id : null,
      locked: lockedIds.has(id),
    };
  });
}

function mapOptions(rows: Row[] | null | undefined, labelKey: "name" | "address"): SalaryCenterProjectOption[] {
  return ((rows ?? []) as Array<Row>)
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      label: typeof row[labelKey] === "string" ? String(row[labelKey]).trim() : "",
    }))
    .filter((row) => row.id && row.label);
}

export type PayrollPageData = {
  users: SalaryCenterUserRow[];
  sessions: SessionPublicRow[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  periods: PayrollPeriodRow[];
  loadError: string | null;
};

export type AttendanceRefData = {
  users: SalaryCenterUserRow[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  loadError: string | null;
};

export type AttendanceClassificationOptions = {
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  loadError: string | null;
};

/**
 * What a pending shift can be attributed to when it's approved: the projects and
 * the properties. Split out of loadAttendanceRefData because the dashboard's
 * "נוכחות עובדים" card approves reports in place and needs exactly this — and
 * nothing from the users list, which is only there to offer manual reporting.
 */
export async function loadAttendanceClassificationOptions(
  supabase: SupabaseClient
): Promise<AttendanceClassificationOptions> {
  const [projectsResult, propertiesResult] = await Promise.all([
    supabase.from("project_dashboard_view").select("id,name").order("name", { ascending: true }).range(0, 999),
    supabase.from("properties").select("id,address").order("address", { ascending: true }).range(0, 999),
  ]);

  return {
    projectOptions: mapOptions((projectsResult.data ?? []) as Row[], "name"),
    propertyOptions: mapOptions((propertiesResult.data ?? []) as Row[], "address"),
    loadError: projectsResult.error?.message ?? propertiesResult.error?.message ?? null,
  };
}

/**
 * Just the reference data the attendance queue needs — who can be clocked in,
 * and the projects / properties a shift can be attributed to. Deliberately NOT
 * loadPayrollPageData: that one scans 18 months of sessions in 1000-row chunks
 * to build the salary center, and the queue never looks at a single session.
 */
export async function loadAttendanceRefData(supabase: SupabaseClient): Promise<AttendanceRefData> {
  const [usersResult, options] = await Promise.all([
    supabase
      .from("users")
      .select("id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode,locale,deliveries_access")
      .or("role.eq.admin,role.eq.office,role.eq.worker,role.eq.worker_no_access")
      .order("full_name", { ascending: true })
      .range(0, 999),
    loadAttendanceClassificationOptions(supabase),
  ]);

  return {
    users: mapUsers((usersResult.data ?? []) as Row[]),
    projectOptions: options.projectOptions,
    propertyOptions: options.propertyOptions,
    loadError: usersResult.error?.message ?? options.loadError,
  };
}

export async function loadPayrollPageData(supabase: SupabaseClient): Promise<PayrollPageData> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 18);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  async function scanSessions(): Promise<{ data: Row[] | null; error: { message: string } | null }> {
    const CHUNK = 1000;
    const rows: Row[] = [];
    for (let start = 0; ; start += CHUNK) {
      const { data, error } = await supabase
        .from("attendance_sessions")
        .select(
          "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
        )
        .gte("clock_in", `${cutoffIso}T00:00:00`)
        .order("clock_in", { ascending: false })
        .range(start, start + CHUNK - 1);
      if (error) return { data: null, error };
      rows.push(...((data ?? []) as Row[]));
      if ((data ?? []).length < CHUNK) break;
    }
    return { data: rows, error: null };
  }

  const [
    usersResult,
    sessionsResult,
    projectsResult,
    propertiesResult,
    periodsResult,
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode,locale,deliveries_access")
      .or("role.eq.admin,role.eq.office,role.eq.worker,role.eq.worker_no_access")
      .order("full_name", { ascending: true })
      .range(0, 999),
    scanSessions(),
    supabase.from("project_dashboard_view").select("id,name").order("name", { ascending: true }).range(0, 999),
    supabase.from("properties").select("id,address").order("address", { ascending: true }).range(0, 999),
    supabase.from("payroll_periods").select("id,period_month,start_date,end_date,status").range(0, 119),
  ]);

  const loadError =
    usersResult.error?.message ??
    sessionsResult.error?.message ??
    projectsResult.error?.message ??
    propertiesResult.error?.message ??
    periodsResult.error?.message ??
    null;

  const periods = (periodsResult.data ?? []) as PayrollPeriodRow[];
  const lockedIds = collectLockedSessionIds(
    (((sessionsResult.data ?? []) as Row[]) as Array<{ id: string; clock_in: string }>).map((row) => ({
      id: row.id,
      clock_in: row.clock_in,
    })),
    periods
  );

  return {
    users: mapUsers((usersResult.data ?? []) as Row[]),
    sessions: mapSessions((sessionsResult.data ?? []) as Row[], lockedIds),
    projectOptions: mapOptions((projectsResult.data ?? []) as Row[], "name"),
    propertyOptions: mapOptions((propertiesResult.data ?? []) as Row[], "address"),
    periods,
    loadError,
  };
}
