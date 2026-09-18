import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { validateSplitParts, type SplitPart } from "@/lib/financial/statementSplit";

// Splits one card-statement line across business domains (₪1,000 → ₪500 בית,
// ₪340 מכירות, ₪160 שוטף). The first part stays on the line itself; every other
// part becomes a new line right after it — same card, dates, merchant and notes.
//  • A line with no expense yet: only the lines change; "צור הוצאות" creates
//    one expense per line as usual.
//  • A line that already created an expense: that expense takes the first
//    part, and each other part gets its own expense, created exactly the way
//    create-expenses creates them.
// Admin/office only.

const FALLBACK_CATEGORY = "כרטיס אשראי";

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// Point an expense's project link at `projectId` (or remove it) — same as the update route.
async function syncProjectLink(supabase: SupabaseClient, expenseId: string, projectId: string | null) {
  const { data: link } = await supabase.from("project_expenses").select("project_id").eq("expense_id", expenseId).maybeSingle();
  const current = typeof link?.project_id === "string" ? link.project_id : "";
  if (current && current !== projectId) await supabase.from("project_expenses").delete().eq("expense_id", expenseId);
  if (projectId && current !== projectId) {
    await supabase.from("project_expenses").insert({
      project_id: projectId,
      expense_id: expenseId,
      included_in_base_price: false,
      billed_to_customer: false,
      notes: null,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      row_id?: string;
      parts?: Array<{ business_domain?: unknown; amount?: unknown; project_id?: unknown; property_id?: unknown }>;
    };
    const rowId = typeof body.row_id === "string" ? body.row_id.trim() : "";
    if (!rowId) return NextResponse.json({ error: "חסר מזהה שורה." }, { status: 400 });

    const parts: SplitPart[] = (Array.isArray(body.parts) ? body.parts : []).map((p) => {
      const domain = typeof p.business_domain === "string" ? p.business_domain.trim() : "";
      return {
        domain,
        amount: Math.round((typeof p.amount === "number" ? p.amount : Number(p.amount)) * 100) / 100,
        projectId: domain === "logistics_projects" ? str(p.project_id) : null,
        propertyId: domain === "property_management" ? str(p.property_id) : null,
      };
    });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    const { data: rowData, error: rowError } = await supabase
      .from("card_statement_rows")
      .select(
        "id,statement_id,expense_id,include,expense_date,transaction_date,amount,description,category,notes,card_label,assignment_raw,row_index"
      )
      .eq("id", rowId)
      .maybeSingle();
    if (rowError) return NextResponse.json({ error: toHebrewError(rowError.message) }, { status: 400 });
    const row = rowData as Row | null;
    if (!row?.id) return NextResponse.json({ error: "השורה לא נמצאה." }, { status: 404 });

    const total = Number(row.amount);
    if (!(total > 0)) return NextResponse.json({ error: "אפשר לפצל רק שורת חיוב בסכום חיובי." }, { status: 400 });
    const invalid = validateSplitParts(total, parts);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const expenseId = str(row.expense_id);
    // A line whose expense was deleted can't be split — there is nothing to divide.
    if (expenseId) {
      const { data: exists } = await supabase.from("expenses").select("id").eq("id", expenseId).maybeSingle();
      if (!exists?.id) return NextResponse.json({ error: "ההוצאה של השורה נמחקה — אין מה לפצל." }, { status: 400 });
    }

    const [first, ...rest] = parts;
    const expenseDate = str(row.expense_date);
    const category = str(row.category) ?? FALLBACK_CATEGORY;

    // ── The other parts' expenses (only when the line already has one) ─────────
    let newExpenseIds: Array<string | null> = rest.map(() => null);
    if (expenseId) {
      if (!expenseDate) return NextResponse.json({ error: "חסר תאריך בשורה." }, { status: 400 });
      const { data: inserted, error: insertError } = await supabase
        .from("expenses")
        .insert(
          rest.map((p) => ({
            expense_date: expenseDate,
            transaction_date: str(row.transaction_date),
            amount: p.amount,
            category,
            description: str(row.description),
            business_domain: p.domain,
            project_id: p.projectId,
            order_id: null,
            property_id: p.propertyId,
            notes: str(row.notes),
            recorded_by: user.id,
            payment_status: "paid",
            paid_amount: null,
            payment_method: "credit_card",
          }))
        )
        .select("id");
      if (insertError) return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
      newExpenseIds = ((inserted ?? []) as Array<{ id: string }>).map((r) => r.id);
      const links = rest
        .map((p, i) => ({ projectId: p.projectId, expenseId: newExpenseIds[i] }))
        .filter((x): x is { projectId: string; expenseId: string } => Boolean(x.projectId && x.expenseId))
        .map((x) => ({
          project_id: x.projectId,
          expense_id: x.expenseId,
          included_in_base_price: false,
          billed_to_customer: false,
          notes: null,
        }));
      if (links.length > 0) await supabase.from("project_expenses").insert(links);

      // The line's own expense becomes the first part.
      const { error: updateError } = await supabase
        .from("expenses")
        .update({
          amount: first.amount,
          business_domain: first.domain,
          project_id: first.projectId,
          property_id: first.propertyId,
        })
        .eq("id", expenseId);
      if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
      await syncProjectLink(supabase, expenseId, first.projectId);
    }

    // ── The lines: the original takes the first part, the rest follow it ──────
    const { data: newRows, error: newRowsError } = await supabase
      .from("card_statement_rows")
      .insert(
        rest.map((p, i) => ({
          statement_id: row.statement_id,
          expense_id: newExpenseIds[i],
          include: row.include !== false,
          expense_date: row.expense_date ?? null,
          transaction_date: row.transaction_date ?? null,
          amount: p.amount,
          description: row.description ?? null,
          category: row.category ?? null,
          business_domain: p.domain,
          project_id: p.projectId,
          property_id: p.propertyId,
          notes: row.notes ?? null,
          card_label: row.card_label ?? null,
          assignment_raw: row.assignment_raw ?? null,
          // Same position, created later — so the parts sort right after the original.
          row_index: row.row_index ?? null,
        }))
      )
      .select("id,expense_id,amount,business_domain,project_id,property_id");
    if (newRowsError) return NextResponse.json({ error: toHebrewError(newRowsError.message) }, { status: 400 });

    const { error: originalError } = await supabase
      .from("card_statement_rows")
      .update({
        amount: first.amount,
        business_domain: first.domain,
        project_id: first.projectId,
        property_id: first.propertyId,
      })
      .eq("id", rowId);
    if (originalError) return NextResponse.json({ error: toHebrewError(originalError.message) }, { status: 400 });

    if (expenseId) {
      const { count } = await supabase
        .from("card_statement_rows")
        .select("id", { count: "exact", head: true })
        .eq("statement_id", row.statement_id as string)
        .not("expense_id", "is", null);
      if (typeof count === "number") {
        await supabase.from("card_statements").update({ created_count: count }).eq("id", row.statement_id as string);
      }
      await logAuditEvent({
        supabase,
        tableName: "expenses",
        recordId: expenseId,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
        newData: { split_into: parts.map((p) => ({ business_domain: p.domain, amount: p.amount })) },
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, rows: newRows ?? [] });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "פיצול השורה נכשל.") }, { status: 500 });
  }
}
