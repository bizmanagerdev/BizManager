import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { norm } from "@/lib/financial/cardImport";

// Fallback category when a row doesn't carry the card name. The merchant becomes the description.
const FALLBACK_CATEGORY = "כרטיס אשראי";
const MAX_ROWS = 1000;

type ImportRow = {
  expense_date?: string | null;
  transaction_date?: string | null;
  amount?: number | string;
  description?: string | null;
  category?: string | null;
  business_domain?: string;
  project_id?: string | null;
  property_id?: string | null;
  notes?: string | null;
};

type StatementMeta = {
  file_name?: string;
  source?: string;
  document_id?: string | null;
  storage_key?: string | null;
  total_rows?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { rows?: ImportRow[]; statement?: StatementMeta };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const statementMeta = body.statement ?? null;
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
      const transactionDate =
        typeof row.transaction_date === "string" && row.transaction_date.trim()
          ? row.transaction_date.trim()
          : null;
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
        errors.push({ index, message: `סכום לא תקין (${description ?? "ללא שם"})` });
        return;
      }
      // Expenses require a positive amount (DB constraint expenses_amount_check). Reject
      // here so the whole batch insert can't fail on it — and name the offending row.
      if (amount <= 0) {
        errors.push({
          index,
          message: `הסכום חייב להיות גדול מ-0 — ${description ?? "ללא שם"} (${amount}). אם זה זיכוי/החזר, אין לסמן אותו לייבוא.`,
        });
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
          transaction_date: transactionDate,
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
      const friendly = /expenses_amount_check|amount/i.test(insertError.message)
        ? "אחת השורות מכילה סכום לא חוקי (הסכום חייב להיות גדול מ-0). בדוק/י את השורות המסומנות, במיוחד זיכויים/החזרים."
        : insertError.message;
      return NextResponse.json({ error: friendly }, { status: 400 });
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

    // Remember each merchant's assignment so repeat statements pre-fill themselves.
    // Best-effort: never fail the import over this (e.g. before the table migration runs).
    const PLACEHOLDER = "ללא שם";
    const mappingByKey = new Map<string, Record<string, unknown>>();
    for (const v of valid) {
      const p = v.payload;
      const description = typeof p.description === "string" ? p.description.trim() : "";
      const key = norm(description);
      const domain = typeof p.business_domain === "string" ? p.business_domain : "";
      if (!key || description === PLACEHOLDER || !domain) continue;
      // Last occurrence wins (and dedupes within a single import — upsert can't touch a row twice).
      mappingByKey.set(key, {
        merchant_key: key,
        business_domain: domain,
        project_id: p.project_id ?? null,
        property_id: p.property_id ?? null,
        last_used_at: new Date().toISOString(),
        updated_by: user.id,
      });
    }
    if (mappingByKey.size > 0) {
      await supabase
        .from("expense_merchant_mappings")
        .upsert([...mappingByKey.values()], { onConflict: "merchant_key" });
    }

    // Persist the statement as an editable record (one row per created expense).
    // Best-effort: never fail the import if the tables aren't there yet.
    let statementId: string | null = null;
    try {
      const source = statementMeta?.source === "pdf" ? "pdf" : "excel";
      const { data: stmt, error: stmtError } = await supabase
        .from("card_statements")
        .insert({
          file_name: typeof statementMeta?.file_name === "string" ? statementMeta.file_name.slice(0, 300) : "",
          source,
          document_id: typeof statementMeta?.document_id === "string" ? statementMeta.document_id : null,
          storage_key: typeof statementMeta?.storage_key === "string" ? statementMeta.storage_key : null,
          total_rows:
            typeof statementMeta?.total_rows === "number" ? statementMeta.total_rows : insertedIds.length,
          created_count: insertedIds.length,
          imported_by: user.id,
        })
        .select("id")
        .maybeSingle();

      if (!stmtError && stmt?.id) {
        statementId = stmt.id as string;
        const statementRows = valid.map((v, i) => {
          const p = v.payload;
          return {
            statement_id: statementId,
            expense_id: insertedIds[i] ?? null,
            expense_date: p.expense_date ?? null,
            transaction_date: p.transaction_date ?? null,
            amount: p.amount ?? null,
            description: p.description ?? null,
            category: p.category ?? null,
            business_domain: p.business_domain ?? null,
            project_id: p.project_id ?? null,
            property_id: p.property_id ?? null,
            notes: p.notes ?? null,
          };
        });
        if (statementRows.length > 0) {
          await supabase.from("card_statement_rows").insert(statementRows);
        }
      }
    } catch {
      /* statement persistence is best-effort */
    }

    return NextResponse.json({ created: insertedIds.length, errors, statement_id: statementId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא צפויה בעת הייבוא.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
