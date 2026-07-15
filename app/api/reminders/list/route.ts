import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";

// List the reminders attached to a specific entity (order / project / customer /
// task / …), regardless of who they're assigned to — this is what lets a page
// show ALL of its own reminders (the worklist only shows the viewer's). Pass
// exactly one entity filter, e.g. /api/reminders/list?order_id=<uuid>.
// ?include=all also returns closed (done/cancelled/auto_resolved) reminders.
const ENTITY_KEYS = [
  "order_id",
  "project_id",
  "customer_id",
  "task_id",
  "payment_id",
  "property_id",
  "vehicle_id",
  "invoice_id",
  "expense_id",
] as const;

type Row = Record<string, unknown>;
const s = (row: Row, key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);

export async function GET(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const url = new URL(req.url);
    let filterKey: string | null = null;
    let filterVal = "";
    for (const k of ENTITY_KEYS) {
      const v = url.searchParams.get(k);
      if (v && v.trim()) {
        filterKey = k;
        filterVal = v.trim();
        break;
      }
    }
    if (!filterKey) return NextResponse.json({ error: "Missing entity filter" }, { status: 400 });

    const includeDone = url.searchParams.get("include") === "all";
    let query = supabase
      .from("reminders")
      .select(
        "id,remind_at,content,status,assigned_to,created_by,source,behavior,severity,notified_at,next_ping_at,snoozed_until,category"
      )
      .eq(filterKey, filterVal)
      .order("remind_at", { ascending: true })
      .range(0, 199);
    if (!includeDone) query = query.eq("status", "pending");

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    const rows = (data ?? []) as Row[];
    const assigneeIds = [...new Set(rows.map((r) => s(r, "assigned_to")).filter((v): v is string => Boolean(v)))];
    const nameById = new Map<string, string>();
    if (assigneeIds.length) {
      const { data: users } = await supabase.from("users").select("id,full_name,email").in("id", assigneeIds);
      for (const u of (users ?? []) as Row[]) {
        const id = s(u, "id");
        if (id) nameById.set(id, s(u, "full_name") ?? s(u, "email") ?? id.slice(0, 8));
      }
    }

    const items = rows.map((r) => ({
      id: s(r, "id") ?? "",
      remindAt: s(r, "remind_at") ?? "",
      content: s(r, "content"),
      status: s(r, "status") ?? "pending",
      assignedTo: s(r, "assigned_to"),
      assignedToName: nameById.get(s(r, "assigned_to") ?? "") ?? null,
      source: s(r, "source") === "system" ? "system" : "manual",
      behavior: s(r, "behavior") ?? "ping_once",
      severity: s(r, "severity") ?? "info",
      notifiedAt: s(r, "notified_at"),
    }));

    return NextResponse.json({ items });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
