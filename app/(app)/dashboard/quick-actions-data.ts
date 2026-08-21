import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile, UserRole } from "@/lib/auth/requireProfile";
import { getScheduleEntries, type CalendarEntry } from "@/lib/projectSchedule";
import { isPayrollWorkerType } from "@/lib/payroll-worker-type";
import type { SalaryAgreementRow } from "@/lib/payroll";
import { EMPTY_QUICK_ACTIONS, type QuickActionsData } from "@/app/(app)/dashboard/quick-actions-types";

export { EMPTY_QUICK_ACTIONS, type QuickActionsData };

type Row = Record<string, unknown>;

function getString(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function firstString(row: Row | null | undefined, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value && value.trim()) return value;
  }
  return fallback;
}

function isUserRole(value: string | null): value is UserRole {
  return value === "admin" || value === "office" || value === "worker" || value === "worker_no_access";
}

/** "DD/MM/YY" out of a YYYY-MM-DD(...) prefix — disambiguates same-customer
 *  orders in the quick-create order picker, where status alone repeats. */
function formatOrderDate(value: string | null) {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1].slice(-2)}` : null;
}

/**
 * Loads the quick-action dropdown data. Resolves to EMPTY_QUICK_ACTIONS-shaped
 * data and NEVER rejects, so it can be passed unawaited from the dashboard page
 * to the client (the buttons render instantly; this streams in to fill dialogs).
 */
export async function loadQuickActionsData(
  supabase: SupabaseClient,
  profile: Pick<UserProfile, "id">
): Promise<QuickActionsData> {
  try {
    const [
      { data: projectRows },
      { data: orderRows },
      { data: propertyRows },
      { data: productRows },
      { data: customerRows },
      { data: userRows },
      { data: salaryAgreementRows },
      { data: currentOpenSessionRow },
      scheduleEntries,
    ] = await Promise.all([
      supabase
        .from("project_dashboard_view")
        .select("id,name,project_type,status,customer_id,customer_name,open_tasks,start_date,updated_at")
        .order("updated_at", { ascending: false })
        .range(0, 99),
      supabase
        .from("order_overview_view")
        .select("order_id,customer_name,order_date,status")
        .order("order_date", { ascending: false })
        .range(0, 99),
      supabase
        .from("properties")
        .select("id,name,address,is_active")
        .eq("is_active", true)
        .order("address", { ascending: true })
        .range(0, 99),
      supabase
        .from("products_with_last_used")
        .select("id,name,sku,barcode,description,base_price,base_cost,active")
        .order("order_count", { ascending: false })
        .order("name", { ascending: true })
        .range(0, 49),
      supabase
        .from("customer_overview_view")
        .select("customer_id,customer_name,name_for_invoice,phone,email,address")
        .order("customer_name", { ascending: true })
        .range(0, 49),
      supabase
        .from("users")
        .select("id,full_name,email,role,active,payroll_worker_type,pay_tracking_mode")
        .order("full_name", { ascending: true })
        .range(0, 499),
      supabase
        .from("salary_agreements")
        .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours")
        .order("valid_from", { ascending: false }),
      supabase
        .from("attendance_sessions")
        .select("id,clock_in")
        .eq("user_id", profile.id)
        .is("clock_out", null)
        .order("clock_in", { ascending: false })
        .limit(1)
        .maybeSingle(),
      getScheduleEntries(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as CalendarEntry[]),
    ]);

    const projects = ((projectRows ?? []) as Row[])
      .map((row) => ({
        id: getString(row, "id") ?? "",
        type: getString(row, "project_type") ?? "",
        name: firstString(row, ["name"], "פרויקט"),
        customerId: getString(row, "customer_id") ?? "",
        customerName: firstString(row, ["customer_name"], "לקוח"),
        startDate: getString(row, "start_date") ?? "",
      }))
      .filter((row) => row.id && row.customerId);

    const orders = ((orderRows ?? []) as Row[])
      .map((row) => {
        const status = getString(row, "status") ?? "";
        const date = formatOrderDate(getString(row, "order_date"));
        return {
          id: getString(row, "order_id") ?? "",
          name: firstString(row, ["customer_name"], "Order"),
          subtitle: [status, date].filter(Boolean).join(" · "),
        };
      })
      .filter((row) => row.id);

    const properties = ((propertyRows ?? []) as Row[])
      .map((row) => ({ id: getString(row, "id") ?? "", name: firstString(row, ["name", "address"], "Property"), subtitle: "" }))
      .filter((row) => row.id);

    const users = ((userRows ?? []) as Row[])
      .map((row) => {
        const fullName = getString(row, "full_name");
        const email = getString(row, "email");
        const role = getString(row, "role");
        const workerType = row.payroll_worker_type;
        return {
          id: getString(row, "id") ?? "",
          label: fullName && fullName.trim() ? fullName : email ?? "",
          role: isUserRole(role) ? role : undefined,
          active: row.active,
          payroll_worker_type: isPayrollWorkerType(workerType) ? workerType : null,
          pay_tracking_mode: getString(row, "pay_tracking_mode"),
        };
      })
      .filter((row) => row.id && row.label && row.active !== false)
      .map((row) => ({
        id: row.id,
        label: row.label,
        role: row.role,
        payroll_worker_type: row.payroll_worker_type,
        pay_tracking_mode: row.pay_tracking_mode,
      }));

    const currentOpenSession =
      currentOpenSessionRow && typeof currentOpenSessionRow.clock_in === "string"
        ? { id: typeof currentOpenSessionRow.id === "string" ? currentOpenSessionRow.id : "", clock_in: currentOpenSessionRow.clock_in }
        : null;

    const customers = ((customerRows ?? []) as Row[])
      .map((row) => ({
        id: getString(row, "customer_id") ?? "",
        name: firstString(row, ["customer_name"], "לקוח"),
        phone: getString(row, "phone"),
        email: getString(row, "email"),
        address: getString(row, "address"),
      }))
      .filter((row) => row.id) as unknown as Row[];

    return {
      customers,
      products: (productRows ?? []) as Row[],
      projects,
      orders,
      properties,
      users,
      currentOpenSession,
      salaryAgreements: ((salaryAgreementRows ?? []) as SalaryAgreementRow[]) ?? [],
      scheduleEntries: scheduleEntries ?? [],
    };
  } catch {
    return EMPTY_QUICK_ACTIONS;
  }
}
