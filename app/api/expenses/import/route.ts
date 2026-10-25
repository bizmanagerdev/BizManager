import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { norm } from "@/lib/financial/cardImport";

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
  card_label?: string | null; // stable card identity, snapshotted at import — see card_label migration
  /** A US card's line: "charge" (a purchase, fee, interest; − a refund),
   *  "payment" (paying the card) or "cash_advance". Israeli lines leave it out. */
  line_kind?: string | null;
};

type StatementMeta = {
  file_name?: string;
  source?: string;
  document_id?: string | null;
  storage_key?: string | null;
  total_rows?: number;
  // A US card's statement (2026-10-25): its card account and its own numbers.
  card_account_id?: string | null;
  currency?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  payment_due_date?: string | null;
  previous_balance?: number | null;
  new_balance?: number | null;
};

const LINE_KINDS = new Set(["charge", "payment", "cash_advance"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = (v: unknown) => (typeof v === "string" && ISO_DAY.test(v) ? v : null);
const moneyOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

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

    // A US card's statement lives on the card's own account, in its currency.
    const cardAccountId =
      typeof statementMeta?.card_account_id === "string" && statementMeta.card_account_id.trim()
        ? statementMeta.card_account_id.trim()
        : null;
    let cardAccount: { id: string; name: string; currency: string } | null = null;
    if (cardAccountId) {
      const { data: acc, error: accError } = await supabase
        .from("accounts")
        .select("id,name,kind,currency")
        .eq("id", cardAccountId)
        .maybeSingle();
      if (accError) return NextResponse.json({ error: toHebrewError(accError.message) }, { status: 400 });
      if (!acc || acc.kind !== "card") {
        return NextResponse.json({ error: "החשבון שנבחר אינו חשבון כרטיס אשראי." }, { status: 400 });
      }
      const currency = String(acc.currency ?? "ILS").toUpperCase();
      if (currency !== String(statementMeta?.currency ?? "ILS").toUpperCase()) {
        return NextResponse.json({ error: `החשבון "${acc.name}" מתנהל ב-${currency} — גם הפירוט צריך להיות בו.` }, { status: 400 });
      }
      cardAccount = { id: acc.id as string, name: String(acc.name ?? ""), currency };
    }

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
        // Only a US statement names these, so an Israeli upload writes exactly what it always did.
        ...(cardAccount
          ? {
              card_account_id: cardAccount.id,
              currency: cardAccount.currency,
              period_start: isoOrNull(statementMeta?.period_start),
              period_end: isoOrNull(statementMeta?.period_end),
              payment_due_date: isoOrNull(statementMeta?.payment_due_date),
              previous_balance: moneyOrNull(statementMeta?.previous_balance),
              new_balance: moneyOrNull(statementMeta?.new_balance),
            }
          : {}),
      })
      .select("id")
      .maybeSingle();

    if (stmtError || !stmt?.id) {
      return NextResponse.json({ error: stmtError?.message ?? "שמירת הדף נכשלה." }, { status: 400 });
    }
    const statementId = stmt.id as string;

    const statementRows = rows.map((row, rowIndex) => {
      const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
      const expenseDate =
        typeof row.expense_date === "string" && row.expense_date.trim() ? row.expense_date.trim() : null;
      const transactionDate =
        typeof row.transaction_date === "string" && row.transaction_date.trim() ? row.transaction_date.trim() : null;
      const description = typeof row.description === "string" && row.description.trim() ? row.description.trim() : null;
      const notes = typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null;
      const category = typeof row.category === "string" && row.category.trim() ? row.category.trim() : FALLBACK_CATEGORY;
      // Stable card identity — defaults to whatever category was at import
      // time (they start equal) but is NEVER touched by later category edits.
      const cardLabel = typeof row.card_label === "string" && row.card_label.trim() ? row.card_label.trim() : category;
      const businessDomain =
        typeof row.business_domain === "string" && row.business_domain.trim() ? row.business_domain.trim() : null;
      const projectId = typeof row.project_id === "string" && row.project_id.trim() ? row.project_id.trim() : null;
      const propertyId = typeof row.property_id === "string" && row.property_id.trim() ? row.property_id.trim() : null;
      const assignmentRaw =
        typeof row.assignment_raw === "string" && row.assignment_raw.trim() ? row.assignment_raw.trim() : null;
      return {
        statement_id: statementId,
        expense_id: null,
        row_index: rowIndex,
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
        card_label: cardLabel,
        ...(cardAccount
          ? { line_kind: typeof row.line_kind === "string" && LINE_KINDS.has(row.line_kind) ? row.line_kind : "charge" }
          : {}),
      };
    });

    const { error: rowsError } = await supabase.from("card_statement_rows").insert(statementRows);
    if (rowsError) {
      // Roll back the (now-empty) statement so we don't leave an orphan header.
      await supabase.from("card_statements").delete().eq("id", statementId);
      return NextResponse.json({ error: toHebrewError(rowsError.message) }, { status: 400 });
    }

    // The upload page offers the card by name next time. Best-effort.
    if (cardAccount) {
      const labels = [...new Set(statementRows.map((r) => r.card_label).filter((l): l is string => Boolean(l)))];
      if (labels.length > 0) {
        await supabase
          .from("card_account_mappings")
          .upsert(
            labels.map((label) => ({
              card_key: norm(label),
              card_label: label,
              account_id: cardAccount!.id,
              updated_by: user.id,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "card_key" }
          );
      }
    }

    return NextResponse.json({ statement_id: statementId, saved: statementRows.length });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא צפויה בעת שמירת הדף.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
