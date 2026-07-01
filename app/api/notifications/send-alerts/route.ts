import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToAll } from "@/lib/push";

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const v = row[key];
  return typeof v === "string" ? v : null;
}

function getNumber(row: Row, key: string) {
  const v = row[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// This endpoint is called by a scheduled job (or the user manually from settings).
// Only admins can trigger it.
export async function POST() {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;

  // Use the service-role client: RLS on push_subscriptions (auth.uid() = user_id)
  // would otherwise limit the send to the admin's own devices, so no other user
  // would ever receive the manually-triggered alerts. Data views are read with
  // the same client (service role sees everything an admin would).
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const in3Days = new Date(today);
  in3Days.setDate(in3Days.getDate() + 3);
  const in3DaysIso = in3Days.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);

  const notifications: { title: string; body: string; url: string; tag: string }[] = [];

  const [
    { data: overdueTasks },
    { data: tomorrowTasks },
    { data: upcomingProjects },
    { data: unpaidInvoices },
  ] = await Promise.all([
    supabase
      .from("task_overview_view")
      .select("task_id,subject,due_date")
      .in("status", ["todo", "in_progress", "blocked"])
      .lt("due_date", todayIso)
      .range(0, 49),
    supabase
      .from("task_overview_view")
      .select("task_id,subject,due_date")
      .in("status", ["todo", "in_progress", "blocked"])
      .eq("due_date", tomorrowIso)
      .range(0, 49),
    supabase
      .from("project_dashboard_view")
      .select("id,name,start_date,customer_name")
      .not("status", "in", '("quote","done","completed","cancelled","canceled","archived","closed")')
      .gte("start_date", todayIso)
      .lte("start_date", in3DaysIso)
      .range(0, 19),
    supabase
      .from("invoices")
      .select("id,payment_status,balance_due")
      .in("payment_status", ["unpaid", "partial", "overdue"])
      .range(0, 199),
  ]);

  const overdueCount = (overdueTasks ?? []).length;
  if (overdueCount > 0) {
    const names = (overdueTasks as Row[])
      .slice(0, 3)
      .map((r) => getString(r, "subject") ?? "משימה")
      .join(", ");
    notifications.push({
      title: `${overdueCount} משימות באיחור`,
      body: overdueCount <= 3 ? names : `${names} ועוד ${overdueCount - 3}`,
      url: "/tasks",
      tag: "overdue-tasks",
    });
  }

  const tomorrowCount = (tomorrowTasks ?? []).length;
  if (tomorrowCount > 0) {
    const names = (tomorrowTasks as Row[])
      .slice(0, 3)
      .map((r) => getString(r, "subject") ?? "משימה")
      .join(", ");
    notifications.push({
      title: `${tomorrowCount} משימות ל${tomorrowCount === 1 ? "מחר" : "מחר"}`,
      body: tomorrowCount <= 3 ? names : `${names} ועוד ${tomorrowCount - 3}`,
      url: "/tasks",
      tag: "tomorrow-tasks",
    });
  }

  for (const row of (upcomingProjects ?? []) as Row[]) {
    const name = getString(row, "name") ?? "פרויקט";
    const customer = getString(row, "customer_name") ?? "";
    const startDate = getString(row, "start_date") ?? "";
    const id = getString(row, "id") ?? "";
    const isToday = startDate === todayIso;
    const isTomorrow = startDate === tomorrowIso;
    const dateLabel = isToday ? "היום" : isTomorrow ? "מחר" : `ב-${startDate}`;
    notifications.push({
      title: `פרויקט מתחיל ${dateLabel}`,
      body: customer ? `${name} — ${customer}` : name,
      url: `/projects/${id}`,
      tag: `project-start-${id}`,
    });
  }

  const totalUnpaid = (unpaidInvoices ?? []).length;
  if (totalUnpaid > 0) {
    const total = ((unpaidInvoices ?? []) as Row[]).reduce((sum, r) => {
      return sum + (getNumber(r, "balance_due") ?? 0);
    }, 0);
    const ILS = new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      maximumFractionDigits: 0,
    });
    notifications.push({
      title: `${totalUnpaid} חשבוניות לא משולמות`,
      body: `סה"כ לגבייה: ${ILS.format(total)}`,
      url: "/invoices",
      tag: "unpaid-invoices",
    });
  }

  const results = await Promise.all(
    notifications.map((n) =>
      sendPushToAll(supabase, { title: n.title, body: n.body, url: n.url, tag: n.tag })
    )
  );

  const totalSent = results.reduce((s, r) => s + r.sent, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);

  return NextResponse.json({
    ok: true,
    notifications: notifications.length,
    sent: totalSent,
    failed: totalFailed,
  });
}
