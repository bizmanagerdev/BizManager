import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";

// Fallback category when a row doesn't carry the card name. The merchant becomes the description.
const FALLBACK_CATEGORY = "כרטיס אשראי";
const MAX_ROWS = 1000;

type ImportRow = {
  expense_date?: string | null;
  amount?: number | string;
  description?: string | null;
  category?: string | null;
  business_domain?: string;
  project_id?: string | null;
  property_id?: string | null;
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { rows?: ImportRow[] };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json({ error: "אין שורות לייבוא." }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `יותר מדי שורות (מקסימום ${MAX_ROWS}).` }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const errors: { index: number; message: string }[] = [];
    const valid: {
      payload: Record<string, unknown>;
      projectId: string | null;
    }[] = [];

    rows.forEach((row, index) => {
      const businessDomain = typeof row.business_domain === "string" ? row.business_domain.trim() : "";
      const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
      const expenseDate =
        typeof row.expense_date === "string" && row.expense_date.trim() ? row.expense_date.trim() : "";
      const description = typeof row.description === "string" && row.description.trim() ? row.description.trim() : null;
      const notes = typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null;
      const projectId = typeof row.project_id === "string" && row.project_id.trim() ? row.project_id.trim() : null;
      const propertyId = typeof row.property_id === "string" && row.property_id.trim() ? row.property_id.trim() : null;
      const category = typeof row.category === "string" && row.category.trim() ? row.category.trim() : FALLBACK_CATEGORY;

      if (!isExpenseBusinessDomain(businessDomain)) {
        errors.push({ index, message: "תחום עסקי לא תקין" });
        return;
      }
      if (!Number.isFinite(amount)) {
        errors.push({ index, message: "סכום לא תקין" });
        return;
      }
      if (!expenseDate) {
        errors.push({ index, message: "חסר תאריך" });
        return;
      }
      if (projectId && propertyId) {
        errors.push({ index, message: "ניתן לשייך למקור אחד בלבד" });
        return;
      }

      valid.push({
        projectId,
        payload: {
          expense_date: expenseDate,
          amount,
          category,
          description,
          business_domain: businessDomain,
          project_id: projectId,
          order_id: null,
          property_id: propertyId,
          notes,
          recorded_by: user.id,
          payment_status: "paid",
          paid_amount: null,
          payment_method: "credit_card",
        },
      });
    });

    if (valid.length === 0) {
      return NextResponse.json({ created: 0, errors });
    }

    // Single multi-row insert — RETURNING preserves the input order, so insertedIds[i] maps to valid[i].
    const { data: inserted, error: insertError } = await supabase
      .from("expenses")
      .insert(valid.map((v) => v.payload))
      .select("id");

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    const insertedIds = ((inserted ?? []) as { id: string }[]).map((r) => r.id);

    // Link project-scoped expenses (mirrors app/api/expenses/create/route.ts).
    const projectLinks = valid
      .map((v, i) => ({ projectId: v.projectId, expenseId: insertedIds[i] }))
      .filter((x): x is { projectId: string; expenseId: string } => Boolean(x.projectId && x.expenseId))
      .map((x) => ({
        project_id: x.projectId,
        expense_id: x.expenseId,
        included_in_base_price: false,
        billed_to_customer: false,
        notes: null,
      }));

    if (projectLinks.length > 0) {
      const { error: linkError } = await supabase.from("project_expenses").insert(projectLinks);
      if (linkError) {
        errors.push({ index: -1, message: `חלק מהשיוכים לפרויקט נכשלו: ${linkError.message}` });
      }
    }

    return NextResponse.json({ created: insertedIds.length, errors });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא צפויה בעת הייבוא.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
