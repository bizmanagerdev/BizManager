import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToRecipients } from "@/lib/push";
import type { AlertRow, AlertSchedule } from "@/lib/notifications/types";

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const v = row[key];
  return typeof v === "string" ? v : null;
}

function israelHourNow(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Number.isFinite(h) ? h % 24 : 0;
}

function israelDayNow(): AlertSchedule {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
  }).formatToParts(new Date());
  const day = parts.find((p) => p.type === "weekday")?.value?.toLowerCase().slice(0, 3) ?? "sun";
  return day as AlertSchedule;
}

function scheduleMatchesNow(schedule: AlertSchedule): boolean {
  if (schedule === "daily") return true;
  const day = israelDayNow();
  if (schedule === "weekdays") return ["sun", "mon", "tue", "wed", "thu"].includes(day);
  return schedule === day;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const currentHour = israelHourNow();

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  const { data: alertRows } = await supabase
    .from("push_alert_config")
    .select("*")
    .eq("enabled", true);

  const allAlerts = (alertRows ?? []) as AlertRow[];

  const due = allAlerts.filter(
    (a) => (force || a.send_hour_israel === currentHour) && scheduleMatchesNow(a.schedule)
  );

  if (due.length === 0) {
    return NextResponse.json({ ok: true, hour: currentHour, skipped: true, reason: "no alerts due this hour" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  const in7Days = new Date(today); in7Days.setDate(today.getDate() + 7);
  const in7DaysIso = in7Days.toISOString().slice(0, 10);
  const in3Days = new Date(today); in3Days.setDate(today.getDate() + 3);
  const in3DaysIso = in3Days.toISOString().slice(0, 10);
  const INACTIVE = '("quote","done","completed","cancelled","canceled","archived","closed")';

  type PushNote = { title: string; body: string; url: string; tag: string; recipients: string[] };
  const notifications: PushNote[] = [];

  for (const alert of due) {
    const recipients = alert.recipient_user_ids ?? [];
    const tag = alert.alert_type ?? alert.id;

    // Custom static alert — just send as-is
    if (!alert.alert_type) {
      notifications.push({ title: alert.title, body: alert.body, url: alert.url, tag, recipients });
      continue;
    }

    // Data-driven built-in alerts
    switch (alert.alert_type) {
      case "overdue_tasks": {
        const { data } = await supabase.from("task_overview_view").select("subject")
          .in("status", ["todo", "in_progress", "blocked"]).lt("due_date", todayIso).range(0, 99);
        const rows = (data ?? []) as Row[];
        if (rows.length > 0) {
          const names = rows.slice(0, 3).map((r) => getString(r, "subject") ?? "משימה").join(", ");
          notifications.push({ title: `⚠️ ${rows.length} ${alert.title}`, body: rows.length <= 3 ? names : `${names} ועוד ${rows.length - 3}`, url: alert.url, tag, recipients });
        }
        break;
      }
      case "today_tasks": {
        const { data } = await supabase.from("task_overview_view").select("subject")
          .in("status", ["todo", "in_progress", "blocked"]).eq("due_date", todayIso).range(0, 99);
        const rows = (data ?? []) as Row[];
        if (rows.length > 0) {
          const names = rows.slice(0, 3).map((r) => getString(r, "subject") ?? "משימה").join(", ");
          notifications.push({ title: `📋 ${rows.length} ${alert.title}`, body: rows.length <= 3 ? names : `${names} ועוד ${rows.length - 3}`, url: alert.url, tag, recipients });
        }
        break;
      }
      case "tomorrow_tasks": {
        const { data } = await supabase.from("task_overview_view").select("subject")
          .in("status", ["todo", "in_progress", "blocked"]).eq("due_date", tomorrowIso).range(0, 49);
        const rows = (data ?? []) as Row[];
        if (rows.length > 0) {
          const names = rows.slice(0, 3).map((r) => getString(r, "subject") ?? "משימה").join(", ");
          notifications.push({ title: `📋 ${rows.length} ${alert.title}`, body: rows.length <= 3 ? names : `${names} ועוד ${rows.length - 3}`, url: alert.url, tag, recipients });
        }
        break;
      }
      case "projects_starting": {
        const { data } = await supabase.from("project_dashboard_view").select("id,name,customer_name,start_date")
          .not("status", "in", INACTIVE).gte("start_date", todayIso).lte("start_date", in7DaysIso).range(0, 29);
        const rows = (data ?? []) as Row[];
        if (rows.length > 0) {
          const lines = rows.slice(0, 4).map((r) => {
            const start = getString(r, "start_date");
            const label = start === todayIso ? "היום" : start === tomorrowIso ? "מחר" : start ?? "";
            const customer = getString(r, "customer_name");
            const name = getString(r, "name") ?? "פרויקט";
            return customer ? `${name} (${customer}) — ${label}` : `${name} — ${label}`;
          });
          notifications.push({ title: `🚀 ${rows.length} ${alert.title}`, body: lines.join("\n"), url: alert.url, tag, recipients });
        }
        break;
      }
      case "projects_deadline": {
        const { data } = await supabase.from("project_dashboard_view").select("id,name,customer_name,end_date")
          .not("status", "in", INACTIVE).gte("end_date", todayIso).lte("end_date", in3DaysIso).range(0, 29);
        const rows = (data ?? []) as Row[];
        if (rows.length > 0) {
          const lines = rows.slice(0, 4).map((r) => {
            const end = getString(r, "end_date");
            const label = end === todayIso ? "היום" : end === tomorrowIso ? "מחר" : `ב-${end}`;
            const name = getString(r, "name") ?? "פרויקט";
            const customer = getString(r, "customer_name");
            return customer ? `${name} (${customer}) — מסתיים ${label}` : `${name} — מסתיים ${label}`;
          });
          notifications.push({ title: `⏰ ${rows.length} ${alert.title}`, body: lines.join("\n"), url: alert.url, tag, recipients });
        }
        break;
      }
      case "deliveries": {
        const { data } = await supabase.from("delivery_overview_view").select("customer_city,customer_address")
          .in("status", ["out_for_delivery", "confirmed", "processing"]).range(0, 99);
        const rows = (data ?? []) as Row[];
        if (rows.length > 0) {
          const cityMap = new Map<string, number>();
          for (const r of rows) {
            const city = getString(r, "customer_city") ?? getString(r, "customer_address") ?? "לא ידוע";
            cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
          }
          const cityLines = [...cityMap.entries()].slice(0, 4).map(([city, count]) => `${city}: ${count}`);
          notifications.push({ title: `🚚 ${rows.length} ${alert.title}`, body: cityLines.join(" | "), url: alert.url, tag, recipients });
        }
        break;
      }
      case "weekly_summary": {
        const { data } = await supabase.from("project_dashboard_view").select("name")
          .not("status", "in", INACTIVE).lte("start_date", in7DaysIso).range(0, 99);
        const rows = (data ?? []) as Row[];
        if (rows.length > 0) {
          const names = rows.slice(0, 5).map((r) => getString(r, "name") ?? "פרויקט").join(", ");
          notifications.push({ title: `📅 ${rows.length} ${alert.title}`, body: rows.length <= 5 ? names : `${names} ועוד ${rows.length - 5}`, url: alert.url, tag, recipients });
        }
        break;
      }
    }
  }

  if (notifications.length === 0) {
    return NextResponse.json({ ok: true, hour: currentHour, message: "אין נתונים לשלוח", sent: 0 });
  }

  const results = await Promise.all(
    notifications.map((n) => sendPushToRecipients(supabase, n.recipients, { title: n.title, body: n.body, url: n.url, tag: n.tag }))
  );

  return NextResponse.json({
    ok: true,
    hour: currentHour,
    notifications: notifications.length,
    sent: results.reduce((s, r) => s + r.sent, 0),
    failed: results.reduce((s, r) => s + r.failed, 0),
  });
}
