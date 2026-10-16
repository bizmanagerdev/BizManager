import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { norm } from "@/lib/financial/cardImport";
import { roundShekels } from "@/lib/financial/cardStatementMath";
import { buildPaymentInsert, CARD_REFUND_METHOD } from "@/lib/payments";

// Materializes a saved statement's eligible rows. A row is eligible when include=true and
// it has a valid business domain.
//  • A purchase (positive, no expense yet) becomes an expense. Mirrors
//    app/api/expenses/create — payment_status=paid, payment_method=credit_card, billing date
//    in expense_date — then links project_expenses (billed to the project's customer when
//    the line says "לחיוב לקוח"), remembers each merchant's assignment, stamps the row's
//    expense_id, and recomputes the statement's created_count.
//  • A refund (negative, no income yet) becomes an income in its domain (owner,
//    2026-10-13: "the income to their domain is the right model"), dated on the card's
//    bank date. It carries no account and no customer, order, project or property: the
//    card's bank charge is already lower by the refund, so a bank account must not count
//    it again, and it is a supplier's refund, never a customer paying. Its method
//    (CARD_REFUND_METHOD) keeps it out of the Grow card deposits and "money in today".
// Admin/office.
const FALLBACK_CATEGORY = "כרטיס אשראי";
const PLACEHOLDER = "ללא שם";

type RowRecord = {
  id: string;
  expense_id: string | null;
  include: boolean | null;
  expense_date: string | null;
  transaction_date: string | null;
  amount: number | string | null;
  description: string | null;
  category: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  notes: string | null;
  card_label: string | null;
  income_payment_id: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { statement_id?: string };
    const statementId = typeof body.statement_id === "string" ? body.statement_id.trim() : "";
    if (!statementId) return NextResponse.json({ error: "חסר מזהה דף." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile, user } = access.value;

    const { data: rowData, error: rowError } = await supabase
      .from("card_statement_rows")
      .select(
        "id,expense_id,include,expense_date,transaction_date,amount,description,category,business_domain,project_id,property_id,notes,card_label,income_payment_id"
      )
      .eq("statement_id", statementId)
      .is("expense_id", null);
    if (rowError) return NextResponse.json({ error: toHebrewError(rowError.message) }, { status: 400 });

    // "לחיוב לקוח" lives in its own column (migration 20261013120000). Read apart so this
    // route keeps working before that migration runs — every line then counts as not billed.
    const { data: billingData } = await supabase
      .from("card_statement_rows")
      .select("id,bill_to_customer")
      .eq("statement_id", statementId)
      .eq("bill_to_customer", true);
    const billedRowIds = new Set(((billingData ?? []) as Array<{ id: string }>).map((r) => r.id));

    // "מול מזומן" lines are left out when marked; this also holds if one were ticked again.
    const candidateIds = ((rowData ?? []) as RowRecord[]).map((r) => r.id);
    const { data: cashData, error: cashError } =
      candidateIds.length > 0
        ? await supabase.from("account_transfers").select("card_statement_row_id").in("card_statement_row_id", candidateIds)
        : { data: [], error: null };
    if (cashError) return NextResponse.json({ error: toHebrewError(cashError.message) }, { status: 400 });
    const cashRowIds = new Set(((cashData ?? []) as Array<{ card_statement_row_id: string }>).map((r) => r.card_statement_row_id));

    const candidates = ((rowData ?? []) as RowRecord[]).filter((r) => !cashRowIds.has(r.id));
    const errors: { id: string; message: string }[] = [];
    const eligible: { rowId: string; projectId: string | null; billed: boolean; payload: Record<string, unknown> }[] = [];
    const refunds: { rowId: string; payload: Record<string, unknown> }[] = [];
    let skipped = 0;

    for (const row of candidates) {
      if (row.include === false) {
        skipped += 1;
        continue;
      }
      const businessDomain = typeof row.business_domain === "string" ? row.business_domain.trim() : "";
      if (!isExpenseBusinessDomain(businessDomain)) {
        skipped += 1; // not assigned yet — leave it for later
        continue;
      }
      const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
      const expenseDate =
        typeof row.expense_date === "string" && row.expense_date.trim() ? row.expense_date.trim() : "";
      if (Number.isFinite(amount) && amount < 0) {
        if (row.income_payment_id) continue; // already recorded
        if (!expenseDate) {
          errors.push({ id: row.id, message: `חסר תאריך (${row.description ?? PLACEHOLDER})` });
          continue;
        }
        const card = typeof row.card_label === "string" && row.card_label.trim() ? row.card_label.trim() : FALLBACK_CATEGORY;
        const merchant = typeof row.description === "string" && row.description.trim() ? row.description.trim() : PLACEHOLDER;
        refunds.push({
          rowId: row.id,
          payload: buildPaymentInsert({
            amountTotal: roundShekels(-amount),
            businessDomain,
            accountId: null,
            paymentDate: expenseDate,
            paymentMethod: CARD_REFUND_METHOD,
            projectId: null,
            orderId: null,
            propertyId: null,
            referenceNumber: null,
            notes: `זיכוי בכרטיס ${card}: ${merchant}`,
            recordedBy: user.id,
          }),
        });
        continue;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        errors.push({ id: row.id, message: `סכום לא חוקי (${row.description ?? PLACEHOLDER})` });
        continue;
      }
      if (!expenseDate) {
        errors.push({ id: row.id, message: `חסר תאריך (${row.description ?? PLACEHOLDER})` });
        continue;
      }
      const projectId = businessDomain === "logistics_projects" && row.project_id ? row.project_id : null;
      const propertyId = businessDomain === "property_management" && row.property_id ? row.property_id : null;
      eligible.push({
        rowId: row.id,
        projectId,
        billed: Boolean(projectId) && billedRowIds.has(row.id),
        payload: {
          expense_date: expenseDate,
          transaction_date:
            typeof row.transaction_date === "string" && row.transaction_date.trim()
              ? row.transaction_date.trim()
              : null,
          amount,
          category:
            typeof row.category === "string" && row.category.trim() ? row.category.trim() : FALLBACK_CATEGORY,
          description: typeof row.description === "string" && row.description.trim() ? row.description.trim() : null,
          business_domain: businessDomain,
          project_id: projectId,
          order_id: null,
          property_id: propertyId,
          notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null,
          recorded_by: profile.id,
          payment_status: "paid",
          paid_amount: null,
          payment_method: "credit_card",
        },
      });
    }

    // Refunds first: they don't depend on the expenses, and a failure here leaves the
    // purchases untouched for a retry.
    let refundsCreated = 0;
    if (refunds.length > 0) {
      const { data: insertedPayments, error: paymentError } = await supabase
        .from("payments")
        .insert(refunds.map((r) => r.payload))
        .select("id");
      if (paymentError) {
        errors.push({ id: "-", message: `רישום הזיכויים כהכנסה נכשל: ${toHebrewError(paymentError.message)}` });
      } else {
        const paymentIds = ((insertedPayments ?? []) as { id: string }[]).map((r) => r.id);
        await Promise.all(
          refunds.map((r, i) =>
            paymentIds[i]
              ? supabase.from("card_statement_rows").update({ income_payment_id: paymentIds[i] }).eq("id", r.rowId)
              : Promise.resolve()
          )
        );
        refundsCreated = paymentIds.length;
      }
    }

    if (eligible.length === 0) {
      return NextResponse.json({ created: 0, refunds: refundsCreated, skipped, errors });
    }

    // Single multi-row insert — RETURNING preserves input order, so insertedIds[i] maps to eligible[i].
    const { data: inserted, error: insertError } = await supabase
      .from("expenses")
      .insert(eligible.map((e) => e.payload))
      .select("id");
    if (insertError) {
      const friendly = /expenses_amount_check|amount/i.test(insertError.message)
        ? "אחת השורות מכילה סכום לא חוקי (הסכום חייב להיות גדול מ-0)."
        : insertError.message;
      return NextResponse.json({ error: friendly }, { status: 400 });
    }
    const insertedIds = ((inserted ?? []) as { id: string }[]).map((r) => r.id);

    // Stamp each row with its new expense id (one update per row keeps the mapping exact).
    await Promise.all(
      eligible.map((e, i) =>
        insertedIds[i]
          ? supabase.from("card_statement_rows").update({ expense_id: insertedIds[i] }).eq("id", e.rowId)
          : Promise.resolve()
      )
    );

    // Link project-scoped expenses (mirrors app/api/expenses/create).
    const projectLinks = eligible
      .map((e, i) => ({ projectId: e.projectId, billed: e.billed, expenseId: insertedIds[i] }))
      .filter((x): x is { projectId: string; billed: boolean; expenseId: string } => Boolean(x.projectId && x.expenseId))
      .map((x) => ({
        project_id: x.projectId,
        expense_id: x.expenseId,
        included_in_base_price: false,
        billed_to_customer: x.billed,
        notes: null,
      }));
    if (projectLinks.length > 0) {
      const { error: linkError } = await supabase.from("project_expenses").insert(projectLinks);
      if (linkError) {
        errors.push({ id: "-", message: `חלק מהשיוכים לפרויקט נכשלו: ${linkError.message}` });
      }
    }

    // Remember each merchant's assignment so future statements pre-fill themselves.
    // A merchant that went to more than one domain in this batch (a line split
    // across domains) has no single answer to remember, so it is left alone.
    const mappingByKey = new Map<string, Record<string, unknown>>();
    const ambiguous = new Set<string>();
    for (const e of eligible) {
      const description = typeof e.payload.description === "string" ? e.payload.description.trim() : "";
      const key = norm(description);
      const domain = typeof e.payload.business_domain === "string" ? e.payload.business_domain : "";
      if (!key || description === PLACEHOLDER || !domain) continue;
      const seen = mappingByKey.get(key);
      if (ambiguous.has(key) || (seen && seen.business_domain !== domain)) {
        ambiguous.add(key);
        mappingByKey.delete(key);
        continue;
      }
      mappingByKey.set(key, {
        merchant_key: key,
        business_domain: domain,
        project_id: e.payload.project_id ?? null,
        property_id: e.payload.property_id ?? null,
        last_used_at: new Date().toISOString(),
        updated_by: profile.id,
      });
    }
    if (mappingByKey.size > 0) {
      await supabase
        .from("expense_merchant_mappings")
        .upsert([...mappingByKey.values()], { onConflict: "merchant_key" });
    }

    // Recompute the statement's created_count = rows that now carry an expense.
    const { count } = await supabase
      .from("card_statement_rows")
      .select("id", { count: "exact", head: true })
      .eq("statement_id", statementId)
      .not("expense_id", "is", null);
    await supabase
      .from("card_statements")
      .update({ created_count: count ?? insertedIds.length })
      .eq("id", statementId);

    return NextResponse.json({ created: insertedIds.length, refunds: refundsCreated, skipped, errors });
  } catch (err: unknown) {
    const message = toHebrewError(err, "יצירת ההוצאות נכשלה.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
