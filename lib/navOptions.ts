import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type NavOption = { id: string; label: string; url: string };

type Row = Record<string, unknown>;

/**
 * Deep-link option lists for the alert-recipient picker (a specific project/
 * customer/task/order to notify about). RLS matches the old /api/nav-options
 * route's admin/office-only gate: `project_dashboard_view`/`order_overview_view`
 * are security_invoker=on views over `projects`/`orders` (admin/office ALL),
 * `customers` is admin/office ALL, `task_overview_view` is security_invoker=on
 * over `tasks` (open to any authenticated user — but this route is admin/office
 * only anyway).
 */
export async function fetchNavOptions(type: string, signal?: AbortSignal): Promise<NavOption[]> {
  const supabase = createSupabaseBrowserClient();

  if (type === "projects") {
    let query = supabase
      .from("project_dashboard_view")
      .select("id,name,customer_name")
      .order("updated_at", { ascending: false })
      .range(0, 499);
    if (signal) query = query.abortSignal(signal);
    const { data } = await query;
    return ((data ?? []) as Row[])
      .map((r) => {
        const id = typeof r.id === "string" ? r.id : "";
        const name = typeof r.name === "string" ? r.name : "";
        const customer = typeof r.customer_name === "string" ? r.customer_name : "";
        return { id, label: customer ? `${name} (${customer})` : name, url: `/projects/${id}` };
      })
      .filter((o) => o.id && o.label);
  }

  if (type === "customers") {
    let query = supabase.from("customers").select("id,name").order("name", { ascending: true }).range(0, 499);
    if (signal) query = query.abortSignal(signal);
    const { data } = await query;
    return ((data ?? []) as Row[])
      .map((r) => ({
        id: typeof r.id === "string" ? r.id : "",
        label: typeof r.name === "string" ? r.name : "",
        url: `/customers/${typeof r.id === "string" ? r.id : ""}`,
      }))
      .filter((o) => o.id && o.label);
  }

  if (type === "tasks") {
    let query = supabase
      .from("task_overview_view")
      .select("id,subject,due_date,status")
      .in("status", ["todo", "in_progress", "blocked"])
      .order("due_date", { ascending: true })
      .range(0, 299);
    if (signal) query = query.abortSignal(signal);
    const { data } = await query;
    return ((data ?? []) as Row[])
      .map((r) => {
        const id = typeof r.id === "string" ? r.id : "";
        const subject = typeof r.subject === "string" ? r.subject : "";
        const due = typeof r.due_date === "string" ? ` — ${r.due_date.slice(0, 10)}` : "";
        return { id, label: `${subject}${due}`, url: "/tasks" };
      })
      .filter((o) => o.id && o.label);
  }

  if (type === "orders") {
    let query = supabase
      .from("order_overview_view")
      .select("order_id,customer_name,order_date")
      .order("order_date", { ascending: false })
      .range(0, 299);
    if (signal) query = query.abortSignal(signal);
    const { data } = await query;
    return ((data ?? []) as Row[])
      .map((r) => {
        const id = typeof r.order_id === "string" ? r.order_id : "";
        const customer = typeof r.customer_name === "string" ? r.customer_name : "";
        const date = typeof r.order_date === "string" ? r.order_date.slice(0, 10) : "";
        return { id, label: customer ? `${customer} — ${date}` : id, url: `/sales/${id}` };
      })
      .filter((o) => o.id && o.label);
  }

  return [];
}
