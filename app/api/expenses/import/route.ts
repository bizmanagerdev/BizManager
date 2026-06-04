import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Saves an uploaded credit-card statement WITHOUT creating expenses: one card_statements
// record + one card_statement_rows per parsed row. Domains are assigned later on the
// statement page, where "צור הוצאות" (app/api/expenses/statement-rows/create-expenses)
// materializes the eligible rows into expenses. Admin/office.
const FALLBACK_CATEGORY = "כרטיס אשראי";
const MAX_ROWS = 1000;

type SaveRow = {
  expense_date?: string | null;
  transaction_date?: string | null;
  amount?: number | string;
  description?: string | null;
  category?: string | null;
  business_domain?: string | null; // pre-resolved head-start (optional)
  project_id?: string | null;
  property_id?: string | null;
  notes?: string | null;
  assignment_raw?: string | null; // original שיוך text from the sheet
  include?: boolean; // whether to create an expense later (default true)
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
    const body = (await req.json().catch(() => ({}))) as { rows?: SaveRow[]; statement?: StatementMeta };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const statementMeta = body.statement ?? null;
    if (rows.length === 0) {
      return NextResponse.json({ error: "אין שורות לשמירה." }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `יותר מדי שורות (מקסימום ${MAX_ROWS}).` }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const source = statementMeta?.source === "pdf" ? "pdf" : "excel";
    const { data: stmt, error: stmtError } = await supabase
      .from("card_statements")
      .insert({
        file_name: typeof statementMeta?.file_name === "string" ? statementMeta.file_name.slice(0, 300) : "",
        source,
        document_id: typeof statementMeta?.document_id === "string" ? statementMeta.document_id : null,
        storage_key: typeof statementMeta?.storage_key === "string" ? statementMeta.storage_key : null,
        total_rows: typeof statementMeta?.total_rows === "number" ? statementMeta.total_rows : rows.length,
        created_count: 0,
        imported_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (stmtError || !stmt?.id) {
      return NextResponse.json({ error: stmtError?.message ?? "שמירת הדף נכשלה." }, { status: 400 });
    }
    const statementId = stmt.id as string;

    const statementRows = rows.map((row) => {
      const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
      const expenseDate =
        typeof row.expense_date === "string" && row.expense_date.trim() ? row.expense_date.trim() : null;
      const transactionDate =
        typeof row.transaction_date === "string" && row.transaction_date.trim() ? row.transaction_date.trim() : null;
      const description = typeof row.description === "string" && row.description.trim() ? row.description.trim() : null;
      const notes = typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null;
      const category = typeof row.category === "string" && row.category.trim() ? row.category.trim() : FALLBACK_CATEGORY;
      const businessDomain =
        typeof row.business_domain === "string" && row.business_domain.trim() ? row.business_domain.trim() : null;
      const projectId = typeof row.project_id === "string" && row.project_id.trim() ? row.project_id.trim() : null;
      const propertyId = typeof row.property_id === "string" && row.property_id.trim() ? row.property_id.trim() : null;
      const assignmentRaw =
        typeof row.assignment_raw === "string" && row.assignment_raw.trim() ? row.assignment_raw.trim() : null;
      return {
        statement_id: statementId,
        expense_id: null,
        expense_date: expenseDate,
        transaction_date: transactionDate,
        amount: Number.isFinite(amount) ? amount : null,
        description,
        category,
        business_domain: businessDomain,
        project_id: projectId,
        property_id: propertyId,
        notes,
        assignment_raw: assignmentRaw,
        include: row.include === false ? false : true,
      };
    });

    const { error: rowsError } = await supabase.from("card_statement_rows").insert(statementRows);
    if (rowsError) {
      // Roll back the (now-empty) statement so we don't leave an orphan header.
      await supabase.from("card_statements").delete().eq("id", statementId);
      return NextResponse.json({ error: rowsError.message }, { status: 400 });
    }

    return NextResponse.json({ statement_id: statementId, saved: statementRows.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא צפויה בעת שמירת הדף.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
