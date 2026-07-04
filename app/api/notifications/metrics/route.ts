import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";
import type { AlertReadMetric, AlertRuleMetric } from "@/lib/notifications/metrics";

// Alert-quality metrics for the admin panel. Derived read-only aggregates over
// reminders + notifications via SECURITY DEFINER RPCs (which aggregate across
// all users; the RPCs themselves re-check admin, and so does this route).
export async function GET(req: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const daysParam = Number(new URL(req.url).searchParams.get("days"));
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;

  const [rulesRes, readRes] = await Promise.all([
    supabase.rpc("get_alert_rule_metrics", { days }),
    supabase.rpc("get_alert_read_metrics", { days }),
  ]);

  if (rulesRes.error) return NextResponse.json({ error: toHebrewError(rulesRes.error.message) }, { status: 500 });

  return NextResponse.json({
    days,
    rules: (rulesRes.data ?? []) as AlertRuleMetric[],
    read: (readRes.error ? [] : (readRes.data ?? [])) as AlertReadMetric[],
  });
}
