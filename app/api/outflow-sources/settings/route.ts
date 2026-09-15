import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isOutflowSourceKind } from "@/lib/outflow-sources";

// Per-source planning settings for the payments board ("מקורות נוספים" on the
// תשלומים קבועים tab): how many WORK days before a salary / loan instalment /
// card charge to be alerted, and which account it leaves from. One row per
// (kind, key); saving replaces the row. Admin/office only.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissingTable(message: string | undefined) {
  const value = (message ?? "").toLowerCase();
  return value.includes("does not exist") || value.includes("could not find") || value.includes("schema cache");
}
// The table exists but predates a column added to the migration later.
function isMissingColumn(message: string | undefined) {
  const value = (message ?? "").toLowerCase();
  return value.includes("column") && value.includes("does not exist");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      source_kind?: unknown;
      source_key?: unknown;
      reminder_work_days_before?: unknown;
      account_id?: unknown;
      is_active?: unknown;
    };

    const kind = body.source_kind;
    const key = typeof body.source_key === "string" ? body.source_key.trim() : "";
    if (!isOutflowSourceKind(kind) || !key) {
      return NextResponse.json({ error: "חסר מזהה המקור." }, { status: 400 });
    }

    // null = "use the default"; 0 = off; 1..30 = N work days before.
    const rawDays = body.reminder_work_days_before;
    const parsedDays = typeof rawDays === "number" ? rawDays : typeof rawDays === "string" && rawDays.trim() ? Number(rawDays) : null;
    if (parsedDays !== null && !(Number.isFinite(parsedDays) && parsedDays >= 0 && parsedDays <= 30)) {
      return NextResponse.json({ error: "ימי התזכורת חייבים להיות בין 0 ל-30." }, { status: 400 });
    }
    const reminderWorkDaysBefore = parsedDays === null ? null : Math.floor(parsedDays);

    const rawAccount = typeof body.account_id === "string" ? body.account_id.trim() : "";
    if (rawAccount && !UUID.test(rawAccount)) {
      return NextResponse.json({ error: "מזהה החשבון אינו תקין." }, { status: 400 });
    }
    const accountId = rawAccount || null;
    // Off = not on the board and never alerts. Absent → active.
    const isActive = body.is_active !== false;

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("outflow_source_settings")
      .upsert(
        {
          source_kind: kind,
          source_key: key,
          reminder_work_days_before: reminderWorkDaysBefore,
          account_id: accountId,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source_kind,source_key" }
      )
      .select("source_kind,source_key,reminder_work_days_before,account_id,is_active")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          error: isMissingColumn(error.message)
            ? "טבלת ההגדרות ישנה — הריצו שוב את המיגרציה outflow_source_settings כדי להוסיף את העמודות החדשות."
            : isMissingTable(error.message)
              ? "צריך להריץ קודם את המיגרציה outflow_source_settings."
              : toHebrewError(error.message),
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, setting: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "שמירת ההגדרה נכשלה.") }, { status: 500 });
  }
}
