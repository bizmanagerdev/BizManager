import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function GET(req: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const type = new URL(req.url).searchParams.get("type");

  if (type === "projects") {
    const { data } = await supabase
      .from("project_dashboard_view")
      .select("id,name,customer_name")
      .order("updated_at", { ascending: false })
      .range(0, 499);
    const options = ((data ?? []) as Record<string, unknown>[]).map((r) => {
      const id = typeof r.id === "string" ? r.id : "";
      const name = typeof r.name === "string" ? r.name : "";
      const customer = typeof r.customer_name === "string" ? r.customer_name : "";
      return { id, label: customer ? `${name} (${customer})` : name, url: `/projects/${id}` };
    }).filter((o) => o.id && o.label);
    return NextResponse.json({ options });
  }

  if (type === "customers") {
    const { data } = await supabase
      .from("customers")
      .select("id,name")
      .order("name", { ascending: true })
      .range(0, 499);
    const options = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: typeof r.id === "string" ? r.id : "",
      label: typeof r.name === "string" ? r.name : "",
      url: `/customers/${typeof r.id === "string" ? r.id : ""}`,
    })).filter((o) => o.id && o.label);
    return NextResponse.json({ options });
  }

  if (type === "tasks") {
    const { data } = await supabase
      .from("task_overview_view")
      .select("id,subject,due_date,status")
      .in("status", ["todo", "in_progress", "blocked"])
      .order("due_date", { ascending: true })
      .range(0, 299);
    const options = ((data ?? []) as Record<string, unknown>[]).map((r) => {
      const id = typeof r.id === "string" ? r.id : "";
      const subject = typeof r.subject === "string" ? r.subject : "";
      const due = typeof r.due_date === "string" ? ` — ${r.due_date.slice(0, 10)}` : "";
      return { id, label: `${subject}${due}`, url: `/tasks` };
    }).filter((o) => o.id && o.label);
    return NextResponse.json({ options });
  }

  if (type === "orders") {
    const { data } = await supabase
      .from("order_overview_view")
      .select("order_id,customer_name,order_date")
      .order("order_date", { ascending: false })
      .range(0, 299);
    const options = ((data ?? []) as Record<string, unknown>[]).map((r) => {
      const id = typeof r.order_id === "string" ? r.order_id : "";
      const customer = typeof r.customer_name === "string" ? r.customer_name : "";
      const date = typeof r.order_date === "string" ? r.order_date.slice(0, 10) : "";
      return { id, label: customer ? `${customer} — ${date}` : id, url: `/sales/${id}` };
    }).filter((o) => o.id && o.label);
    return NextResponse.json({ options });
  }

  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}
