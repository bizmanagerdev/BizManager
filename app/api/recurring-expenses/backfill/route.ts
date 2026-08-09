import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// "השלמת חיובים חסרים" — create the occurrences a recurring template should have
// produced but never did. The daily generator only runs for TODAY, and for a
// MANUAL (non-standing-order) template it only ever materializes the current
// period, so months between the start date and the first run are simply absent.
//
// GET  — preview: which periods are missing, per template. Changes nothing.
// POST — create them (idempotent; re-running finds nothing left).

type MissingRow = { recurrence_key: string; expense_date: string; would_be_paid: boolean };

type TemplateRow = { id: string; template_name: string | null; auto_paid: boolean | null };

/** The RPCs live in migration 20260809000000 — say so instead of a raw PG error. */
function isMissingFunction(message: string | undefined) {
  const value = (message ?? "").toLowerCase();
  return value.includes("does not exist") || value.includes("could not find") || value.includes("schema cache");
}

const NOT_DEPLOYED = "צריך להריץ קודם את המיגרציה 20260809000000_recurring_expense_backfill_missing.";

export async function GET(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const id = new URL(req.url).searchParams.get("id") ?? "";

    let query = supabase
      .from("recurring_expense_templates")
      .select("id,template_name,auto_paid")
      .eq("is_active", true)
      .eq("is_variable_amount", false);
    if (id) query = query.eq("id", id);
    const { data: templates, error } = await query;
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    const rows = (templates ?? []) as TemplateRow[];
    const results: Array<{
      id: string;
      name: string;
      autoPaid: boolean;
      months: string[];
      count: number;
    }> = [];

    for (const template of rows) {
      const { data, error: rpcError } = await supabase.rpc("recurring_expense_missing_occurrences", {
        p_template_id: template.id,
      });
      if (rpcError) {
        return NextResponse.json(
          { error: isMissingFunction(rpcError.message) ? NOT_DEPLOYED : toHebrewError(rpcError.message) },
          { status: 400 }
        );
      }
      const missing = (data ?? []) as MissingRow[];
      if (missing.length === 0) continue;
      results.push({
        id: template.id,
        name: template.template_name?.trim() || "הוצאה קבועה",
        autoPaid: template.auto_paid === true,
        months: missing.map((row) => row.expense_date),
        count: missing.length,
      });
    }

    return NextResponse.json({
      templates: results,
      total: results.reduce((sum, row) => sum + row.count, 0),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "בדיקת החיובים החסרים נכשלה.") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const body = (await req.json().catch(() => ({}))) as { id?: string | null };
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : "";

    let query = supabase
      .from("recurring_expense_templates")
      .select("id,template_name,auto_paid")
      .eq("is_active", true)
      .eq("is_variable_amount", false);
    if (id) query = query.eq("id", id);
    const { data: templates, error } = await query;
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    let created = 0;
    for (const template of (templates ?? []) as TemplateRow[]) {
      const { data, error: rpcError } = await supabase.rpc("backfill_recurring_expense", {
        p_template_id: template.id,
      });
      if (rpcError) {
        return NextResponse.json(
          { error: isMissingFunction(rpcError.message) ? NOT_DEPLOYED : toHebrewError(rpcError.message) },
          { status: 400 }
        );
      }
      created += Number(data) || 0;
    }

    return NextResponse.json({ ok: true, created });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "השלמת החיובים החסרים נכשלה.") }, { status: 500 });
  }
}
