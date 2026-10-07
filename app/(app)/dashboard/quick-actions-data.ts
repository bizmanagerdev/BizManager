import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/requireProfile";
import { isPayrollWorkerType } from "@/lib/payroll-worker-type";
import type { SalaryAgreementRow } from "@/lib/payroll";
import { EMPTY_QUICK_ACTIONS, type QuickActionsData } from "@/app/(app)/dashboard/quick-actions-types";
import { attachProductStock } from "@/lib/orders/productStock";

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
 *
 * Runs on the server (/api/quick-actions/data) and on the device copy
 * (components/layout/QuickCreateMenu, through lib/powersync/local-supabase).
 * `strict`: a list that can't be read is an error, not an empty list — the
 * device's caller then asks the server instead.
 */
export async function loadQuickActionsData(
  supabase: SupabaseClient,
  { strict = false }: { strict?: boolean } = {}
): Promise<QuickActionsData> {
  const read = <T extends { data: unknown; error: unknown }>(result: T): T => {
    if (strict && result.error) throw new Error(String((result.error as { message?: unknown }).message ?? result.error));
    return result;
  };
  try {
    // One round of queries, all at once. (The viewer's schedule and open shift
    // used to ride along too — three more round trips one after another — but
    // no + dialog reads them.)
    const [
      { data: projectRows },
      { data: orderRows },
      { data: propertyRows },
      productsWithStock,
      { data: customerRows },
      { data: userRows },
      { data: payrollTypeRows },
      { data: salaryAgreementRows },
      { data: taskCustomerRows },
    ] = await Promise.all([
      supabase
        .from("project_dashboard_view")
        .select("id,name,project_type,status,customer_id,customer_name,open_tasks,start_date,updated_at")
        .order("updated_at", { ascending: false })
        .range(0, 99)
        .then(read),
      supabase
        .from("order_overview_view")
        .select("order_id,customer_name,order_date,status")
        .order("order_date", { ascending: false })
        .range(0, 99)
        .then(read),
      supabase
        .rpc("property_directory")
        .eq("is_active", true)
        .order("address", { ascending: true })
        .range(0, 99)
        .then(read),
      // Live stock (on-hand − reserved) is attached as soon as the products
      // arrive, still inside this round, so the quick-create order dialog's
      // catalog tiles can warn on shortfalls the same way the full
      // /sales/orders/new page does.
      supabase
        .from("products_with_last_used")
        .select("id,name,sku,barcode,description,base_price,base_cost,active")
        .order("order_count", { ascending: false })
        .order("name", { ascending: true })
        .range(0, 49)
        .then(read)
        .then(({ data: productRows }) => attachProductStock(supabase, (productRows ?? []) as Row[])),
      supabase
        .from("customer_overview_view")
        .select("customer_id,customer_name,name_for_invoice,phone,email,address")
        .order("customer_name", { ascending: true })
        .range(0, 49)
        .then(read),
      // Everyone's name, role and whether they log shifts — all a worker may
      // see of other people.
      supabase.rpc("user_directory").order("full_name", { ascending: true }).range(0, 499).then(read),
      // Pay types for the shift editor: admins and office read everyone's, a
      // worker only their own.
      supabase.from("users").select("id,payroll_worker_type,pay_tracking_mode").range(0, 499).then(read),
      supabase
        .from("salary_agreements")
        .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours")
        .order("valid_from", { ascending: false })
        .then(read),
      // The task form's customer picker — the same list as the tasks board's
      // (app/(app)/tasks/loadTasks.ts loadTaskPickerOptions).
      supabase
        .from("customers")
        .select("id,name,phone,active")
        .eq("active", true)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 1999)
        .then(read),
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

    const payrollTypeById = new Map(((payrollTypeRows ?? []) as Row[]).map((row) => [getString(row, "id"), row] as const));
    const users = ((userRows ?? []) as Row[])
      .map((row) => {
        const id = getString(row, "id") ?? "";
        const fullName = getString(row, "full_name");
        const role = getString(row, "role");
        const payrollType = payrollTypeById.get(id);
        const workerType = payrollType?.payroll_worker_type;
        return {
          id,
          label: fullName && fullName.trim() ? fullName : "",
          role: isUserRole(role) ? role : undefined,
          active: row.active,
          payroll_worker_type: isPayrollWorkerType(workerType) ? workerType : null,
          pay_tracking_mode: payrollType ? getString(payrollType, "pay_tracking_mode") : null,
          logs_shifts: row.logs_shifts === true,
        };
      })
      .filter((row) => row.id && row.label && row.active !== false)
      .map((row) => ({
        id: row.id,
        label: row.label,
        role: row.role,
        payroll_worker_type: row.payroll_worker_type,
        pay_tracking_mode: row.pay_tracking_mode,
        logs_shifts: row.logs_shifts,
      }));

    const customers = ((customerRows ?? []) as Row[])
      .map((row) => ({
        id: getString(row, "customer_id") ?? "",
        name: firstString(row, ["customer_name"], "לקוח"),
        phone: getString(row, "phone"),
        email: getString(row, "email"),
        address: getString(row, "address"),
      }))
      .filter((row) => row.id) as unknown as Row[];

    const taskCustomers = ((taskCustomerRows ?? []) as Row[])
      .map((row) => {
        const name = getString(row, "name") ?? "";
        const phone = getString(row, "phone");
        return { id: getString(row, "id") ?? "", label: phone ? `${name} · ${phone}` : name };
      })
      .filter((row) => row.id && row.label);

    return {
      customers,
      taskCustomers,
      products: productsWithStock,
      projects,
      orders,
      properties,
      users,
      salaryAgreements: ((salaryAgreementRows ?? []) as SalaryAgreementRow[]) ?? [],
    };
  } catch (error) {
    if (strict) throw error;
    return EMPTY_QUICK_ACTIONS;
  }
}
