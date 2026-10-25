import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { roundShekels } from "@/lib/financial/cardStatementMath";
import { CARD_REFUND_METHOD } from "@/lib/payments";
import { loadStatementCardAccount, statementPricer } from "@/lib/financial/cardAccountStatement";

// Edits a saved statement row.
//  • If the row already created an expense → update the live expense (and its project link),
//    then mirror the change onto the snapshot row. Domain/amount/date are required.
//  • If the row is a refund already recorded as income → update that income (domain, amount,
//    date) the same way, then the snapshot.
//  • If the row has no expense yet (draft) → update only the snapshot row. Domain is optional
//    so a partial assignment can be saved; an `include` toggle is also accepted.
// `bill_to_customer` ("לחיוב לקוח", a project line) is sent only once the column exists
// (migration 20261013120000) and only counts on a line with a project.
// Admin/office only.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      row_id?: string;
      business_domain?: string;
      project_id?: string | null;
      property_id?: string | null;
      amount?: number | string;
      category?: string;
      description?: string;
      notes?: string;
      expense_date?: string | null;
      transaction_date?: string | null;
      include?: boolean;
      /** Explicit "reassign to a different card" action only — NEVER derived
       *  from `category`. Omit to leave the row's card identity untouched
       *  (an ordinary category edit must never move a row to another card). */
      card_label?: string | null;
      bill_to_customer?: boolean;
    };

    const rowId = typeof body.row_id === "string" ? body.row_id.trim() : "";
    if (!rowId) return NextResponse.json({ error: "חסר מזהה שורה." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: row, error: rowError } = await supabase
      .from("card_statement_rows")
      .select("id,expense_id,income_payment_id,amount,statement_id")
      .eq("id", rowId)
      .maybeSingle();
    if (rowError) return NextResponse.json({ error: toHebrewError(rowError.message) }, { status: 400 });
    if (!row?.id) return NextResponse.json({ error: "השורה לא נמצאה." }, { status: 404 });

    // A US card's line (2026-10-25) is in the card's currency: its expense and
    // refund keep their dollars, their shekels at the rate of the line's day.
    const loaded = await loadStatementCardAccount(supabase, String(row.statement_id ?? ""));
    if ("error" in loaded) return NextResponse.json({ error: toHebrewError(loaded.error) }, { status: 400 });
    const price = loaded.account ? statementPricer(supabase, loaded.account.currency) : null;
    const expenseId = typeof row.expense_id === "string" ? row.expense_id : "";
    const incomePaymentId = typeof row.income_payment_id === "string" ? row.income_payment_id : "";

    // Shared, normalized field values.
    const businessDomainRaw = typeof body.business_domain === "string" ? body.business_domain.trim() : "";
    const businessDomain = isExpenseBusinessDomain(businessDomainRaw) ? businessDomainRaw : "";
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    const expenseDate = typeof body.expense_date === "string" && body.expense_date.trim() ? body.expense_date.trim() : "";
    const transactionDate =
      typeof body.transaction_date === "string" && body.transaction_date.trim() ? body.transaction_date.trim() : null;
    const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : "כרטיס אשראי";
    const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const projectId =
      businessDomain === "logistics_projects" && typeof body.project_id === "string" && body.project_id.trim()
        ? body.project_id.trim()
        : null;
    const propertyId =
      businessDomain === "property_management" && typeof body.property_id === "string" && body.property_id.trim()
        ? body.property_id.trim()
        : null;
    // Present only on an explicit "reassign card" action — never inferred
    // from category, so an ordinary category edit can't move a row to
    // another (possibly phantom) card group.
    const cardLabel = typeof body.card_label === "string" && body.card_label.trim() ? body.card_label.trim() : null;
    const billToCustomer = typeof body.bill_to_customer === "boolean" ? body.bill_to_customer && Boolean(projectId) : null;

    // ── A refund already recorded as income: keep that income in step ─────────────────
    if (!expenseId && incomePaymentId && Number(row.amount) < 0) {
      if (!businessDomain) return NextResponse.json({ error: "יש לבחור תחום עסקי." }, { status: 400 });
      if (!Number.isFinite(amount) || amount >= 0) {
        return NextResponse.json({ error: "שורת זיכוי נשארת בסכום שלילי." }, { status: 400 });
      }
      if (!expenseDate) return NextResponse.json({ error: "חסר תאריך." }, { status: 400 });
      const { data: payment } = await supabase
        .from("payments")
        .select("id,payment_method")
        .eq("id", incomePaymentId)
        .maybeSingle();
      if (payment?.payment_method === CARD_REFUND_METHOD) {
        const refund = roundShekels(-amount);
        const priced = price ? await price(refund, expenseDate) : null;
        if (priced && "error" in priced) return NextResponse.json({ error: priced.error }, { status: 400 });
        const shekels = priced ? priced.shekels : refund;
        const { error: paymentError } = await supabase
          .from("payments")
          .update({
            amount_total: shekels,
            net_amount: shekels,
            business_domain: businessDomain,
            payment_date: expenseDate,
            ...(priced ? priced.columns : {}),
          })
          .eq("id", incomePaymentId);
        if (paymentError) return NextResponse.json({ error: toHebrewError(paymentError.message) }, { status: 400 });
      }
      const { error: snapError } = await supabase
        .from("card_statement_rows")
        .update({
          amount,
          category,
          description,
          notes,
          expense_date: expenseDate,
          transaction_date: transactionDate,
          business_domain: businessDomain,
          project_id: null,
          property_id: null,
          ...(cardLabel ? { card_label: cardLabel } : null),
        })
        .eq("id", rowId);
      if (snapError) return NextResponse.json({ error: toHebrewError(snapError.message) }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    // ── Draft row (no expense yet): update only the snapshot, domain optional ──────────
    if (!expenseId) {
      const snapshot: Record<string, unknown> = {
        business_domain: businessDomain || null,
        project_id: projectId,
        property_id: propertyId,
        category,
        description,
        notes,
        expense_date: expenseDate || null,
        transaction_date: transactionDate,
      };
      if (Number.isFinite(amount)) snapshot.amount = amount;
      if (typeof body.include === "boolean") snapshot.include = body.include;
      if (cardLabel) snapshot.card_label = cardLabel;
      if (billToCustomer !== null) snapshot.bill_to_customer = billToCustomer;
      const { error: snapError } = await supabase.from("card_statement_rows").update(snapshot).eq("id", rowId);
      if (snapError) return NextResponse.json({ error: toHebrewError(snapError.message) }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    // ── Row with a live expense: strict validation, update the expense too ─────────────
    if (!businessDomain) return NextResponse.json({ error: "יש לבחור תחום עסקי." }, { status: 400 });
    if (!Number.isFinite(amount)) return NextResponse.json({ error: "סכום לא תקין." }, { status: 400 });
    if (!expenseDate) return NextResponse.json({ error: "חסר תאריך." }, { status: 400 });

    const priced = price ? await price(amount, expenseDate) : null;
    if (priced && "error" in priced) return NextResponse.json({ error: priced.error }, { status: 400 });

    const { error: expenseError } = await supabase
      .from("expenses")
      .update({
        amount: priced ? priced.shekels : amount,
        ...(priced ? priced.columns : {}),
        category,
        description,
        notes,
        expense_date: expenseDate,
        transaction_date: transactionDate,
        business_domain: businessDomain,
        project_id: projectId,
        property_id: propertyId,
      })
      .eq("id", expenseId);
    if (expenseError) return NextResponse.json({ error: toHebrewError(expenseError.message) }, { status: 400 });

    // Reconcile the project_expenses link (mirrors create/import behavior).
    const { data: link } = await supabase
      .from("project_expenses")
      .select("project_id")
      .eq("expense_id", expenseId)
      .maybeSingle();
    const currentProject = typeof link?.project_id === "string" ? link.project_id : "";
    if (projectId) {
      if (currentProject && currentProject !== projectId) {
        await supabase.from("project_expenses").delete().eq("expense_id", expenseId);
      }
      if (currentProject !== projectId) {
        await supabase.from("project_expenses").insert({
          project_id: projectId,
          expense_id: expenseId,
          included_in_base_price: false,
          billed_to_customer: billToCustomer === true,
          notes: null,
        });
      } else if (billToCustomer !== null) {
        await supabase.from("project_expenses").update({ billed_to_customer: billToCustomer }).eq("expense_id", expenseId);
      }
    } else if (currentProject) {
      await supabase.from("project_expenses").delete().eq("expense_id", expenseId);
    }

    // Keep the snapshot in sync so the statement view stays accurate.
    await supabase
      .from("card_statement_rows")
      .update({
        amount,
        category,
        description,
        notes,
        expense_date: expenseDate,
        transaction_date: transactionDate,
        business_domain: businessDomain,
        project_id: projectId,
        property_id: propertyId,
        ...(cardLabel ? { card_label: cardLabel } : null),
        ...(billToCustomer !== null ? { bill_to_customer: billToCustomer } : null),
      })
      .eq("id", rowId);

    logAuditEventAfterResponse({
      supabase,
      tableName: "expenses",
      recordId: expenseId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "עדכון השורה נכשל.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
