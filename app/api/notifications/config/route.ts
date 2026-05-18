import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import type { AlertRow } from "@/lib/notifications/types";

// Re-export so existing server imports still work
export type { AlertSchedule, AlertRow } from "@/lib/notifications/types";
export { BUILTIN_ALERT_TYPES } from "@/lib/notifications/types";

export async function GET() {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const { data, error } = await supabase
    .from("push_alert_config")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ alerts: [], error: error.message });
  return NextResponse.json({ alerts: (data ?? []) as AlertRow[] });
}

export async function POST(req: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json()) as Partial<AlertRow>;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("push_alert_config")
    .insert({
      title: body.title.trim(),
      body: body.body ?? "",
      url: body.url ?? "/alerts",
      alert_type: body.alert_type ?? null,
      enabled: body.enabled ?? true,
      send_hour_israel: body.send_hour_israel ?? 8,
      schedule: body.schedule ?? "daily",
      recipient_user_ids: body.recipient_user_ids ?? [],
      sort_order: body.sort_order ?? 0,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
