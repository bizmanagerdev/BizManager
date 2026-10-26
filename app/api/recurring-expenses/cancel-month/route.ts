import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isForeignCurrency } from "@/lib/fx/currencies";
import { currencyPricing } from "@/lib/fx/money-input";
import {
  canCancelRecurringMonth,
  cancelledMonthNote,
  isCancelledRecurringMonth,
} from "@/lib/recurring/cancelMonth";

// "ביטול החודש" — one month of a recurring bill that didn't happen (owner,
// 2026-10-26). The month KEEPS its row, at ₪0 (in its own currency for a US$ /
// C$ bill — such an account holds nothing else), marked paid, with the reason
// in its note: a deleted month is simply created again by the generator, which
// walks every period from the template's start date. See lib/recurring/cancelMonth.ts.
//
// POST { expense_id }                                   — cancel a month that has a row
// POST { template_id, recurrence_key, expense_date }    — cancel an upcoming month (a
//                                                         forecast, no row yet)
//      + reason?                                        — the note; a default when empty
// POST { expense_id, restore: true }                    — undo: the row goes and the
//      template's backfill brings the month back exactly as the generator would
//      (not paid at its estimate, or paid for a standing order); a future month
//      becomes a forecast again.

type MonthRow = {
  id: string;
  recurring_expense_template_id: string | null;
  recurrence_key: string | null;
  payment_status: string | null;
  amount: number | string | null;
  paid_amount: number | string | null;
  expense_date: string | null;
  notes: string | null;
  currency: string | null;
  installment_group_id: string | null;
};

const MONTH_COLUMNS =
  "id,recurring_expense_template_id,recurrence_key,payment_status,amount,paid_amount,expense_date,notes,currency,installment_group_id";

function applyTokens(value: string | null, periodKey: string, expenseDate: string): string | null {
  if (!value) return null;
  return value
    .split("{{period_key}}").join(periodKey)
    .split("{{expense_date}}").join(expenseDate)
    .split("{{expense_month}}").join(expenseDate.slice(0, 7));
}

function dayOf(value: string | null): string {
  return (value ?? "").slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      expense_id?: string;
      template_id?: string;
      recurrence_key?: string;
      expense_date?: string;
      reason?: string | null;
      restore?: boolean;
    };

    const expenseId = typeof body.expense_id === "string" ? body.expense_id.trim() : "";
    const templateIdIn = typeof body.template_id === "string" ? body.template_id.trim() : "";
    const recurrenceKeyIn = typeof body.recurrence_key === "string" ? body.recurrence_key.trim() : "";
    const expenseDateIn = typeof body.expense_date === "string" ? body.expense_date.trim().slice(0, 10) : "";
    const reason = typeof body.reason === "string" ? body.reason : null;
    const restore = body.restore === true;

    if (!expenseId && (!templateIdIn || !recurrenceKeyIn || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDateIn))) {
      return NextResponse.json({ error: "חסרים פרטי החודש." }, { status: 400 });
    }
    if (restore && !expenseId) {
      return NextResponse.json({ error: "חסרים פרטי החודש." }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    // The month's row: by id, or by its template and period (the generator may
    // already have created what the board still showed as a forecast).
    const rowQuery = expenseId
      ? supabase.from("expenses").select(MONTH_COLUMNS).eq("id", expenseId)
      : supabase
          .from("expenses")
          .select(MONTH_COLUMNS)
          .eq("recurring_expense_template_id", templateIdIn)
          .eq("recurrence_key", recurrenceKeyIn);
    const { data: rowData, error: rowError } = await rowQuery.maybeSingle<MonthRow>();
    if (rowError) return NextResponse.json({ error: toHebrewError(rowError.message) }, { status: 400 });
    const row = rowData ?? null;

    if (expenseId && !row) return NextResponse.json({ error: "החודש לא נמצא." }, { status: 404 });
    if (row && !row.recurring_expense_template_id) {
      return NextResponse.json({ error: "זו לא הוצאה קבועה — אפשר למחוק אותה." }, { status: 400 });
    }

    // ── Undo ────────────────────────────────────────────────────────────────
    if (restore) {
      if (!row) return NextResponse.json({ error: "החודש לא נמצא." }, { status: 404 });
      const cancelled = isCancelledRecurringMonth({
        recurringTemplateId: row.recurring_expense_template_id,
        paymentStatus: row.payment_status,
        amount: row.amount,
      });
      if (!cancelled) return NextResponse.json({ error: "החודש לא מבוטל." }, { status: 409 });

      const { error: linkError } = await supabase.from("project_expenses").delete().eq("expense_id", row.id);
      if (linkError) return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
      const { error: deleteError } = await supabase.from("expenses").delete().eq("id", row.id);
      if (deleteError) return NextResponse.json({ error: toHebrewError(deleteError.message) }, { status: 400 });

      // The same function as "השלמת חיובים חסרים": it creates what the template
      // should have by today. If it fails, the daily generator does it tonight.
      const { error: backfillError } = await supabase.rpc("backfill_recurring_expense", {
        p_template_id: row.recurring_expense_template_id,
      });

      logAuditEventAfterResponse({
        supabase,
        tableName: "expenses",
        recordId: row.id,
        action: "delete",
        changedBy: profile.id,
        userRole: profile.role,
      });

      const { data: back } = await supabase
        .from("expenses")
        .select("id")
        .eq("recurring_expense_template_id", row.recurring_expense_template_id)
        .eq("recurrence_key", row.recurrence_key)
        .maybeSingle<{ id: string }>();

      return NextResponse.json({ ok: true, id: back?.id ?? null, ...(backfillError ? { pending: true } : {}) });
    }

    // ── Cancel a month that has a row ───────────────────────────────────────
    const cancelRow = async (target: MonthRow) => {
      if (isCancelledRecurringMonth({
        recurringTemplateId: target.recurring_expense_template_id,
        paymentStatus: target.payment_status,
        amount: target.amount,
      })) {
        return NextResponse.json({ ok: true, id: target.id });
      }
      if (!canCancelRecurringMonth({
        recurringTemplateId: target.recurring_expense_template_id,
        paymentStatus: target.payment_status,
        paidAmount: target.paid_amount,
      })) {
        return NextResponse.json(
          { error: "החודש כבר שולם (כולו או חלקו) — כדי לשנות אותו, ערכו את התשלום." },
          { status: 409 }
        );
      }
      if (target.installment_group_id) {
        return NextResponse.json({ error: "החודש פוצל לתשלומים — אי אפשר לבטל אותו מכאן." }, { status: 409 });
      }
      const day = dayOf(target.expense_date) || expenseDateIn;
      const { error } = await supabase
        .from("expenses")
        .update({
          amount: 0,
          // A US$ / C$ bill stays in its currency (its account may hold only
          // that); the database prices 0 of it at 0.
          ...(isForeignCurrency(target.currency) ? { foreign_amount: 0 } : {}),
          paid_amount: 0,
          payment_status: "paid",
          paid_date: day || null,
          notes: cancelledMonthNote(reason, target.notes),
        })
        .eq("id", target.id);
      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

      logAuditEventAfterResponse({
        supabase,
        tableName: "expenses",
        recordId: target.id,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
      });
      return NextResponse.json({ ok: true, id: target.id });
    };

    if (row) return await cancelRow(row);

    // ── Cancel an upcoming month: its row is created already cancelled ──────
    const { data: tpl, error: tplErr } = await supabase
      .from("recurring_expense_templates")
      .select("id,category,currency,description_template,notes_template,business_domain,project_id,order_id,property_id,account_id,included_in_base_price,billed_to_customer,project_expense_notes_template")
      .eq("id", templateIdIn)
      .maybeSingle();
    if (tplErr) return NextResponse.json({ error: toHebrewError(tplErr.message) }, { status: 400 });
    if (!tpl) return NextResponse.json({ error: "ההוצאה הקבועה לא נמצאה." }, { status: 404 });
    const t = tpl as Record<string, unknown>;

    const templateCurrency = isForeignCurrency(t.currency) ? t.currency : "ILS";
    const pricing = await currencyPricing(supabase, { currency: templateCurrency }, { amount: 0, date: expenseDateIn });
    if ("error" in pricing) return NextResponse.json({ error: pricing.error }, { status: 400 });

    const { data: inserted, error: insertError } = await supabase
      .from("expenses")
      .insert({
        expense_date: expenseDateIn,
        amount: 0,
        ...(pricing.columns ?? {}),
        category: t.category,
        description: applyTokens(t.description_template as string | null, recurrenceKeyIn, expenseDateIn),
        business_domain: t.business_domain,
        project_id: t.project_id,
        order_id: t.order_id,
        property_id: t.property_id,
        account_id: t.account_id,
        notes: cancelledMonthNote(reason, applyTokens(t.notes_template as string | null, recurrenceKeyIn, expenseDateIn)),
        recorded_by: profile.id,
        recurring_expense_template_id: templateIdIn,
        recurrence_key: recurrenceKeyIn,
        payment_status: "paid",
        paid_amount: 0,
        paid_date: expenseDateIn,
      })
      .select("id")
      .maybeSingle();
    if (insertError) {
      // The generator got there first (one row per template and period):
      // cancel the row it made.
      if ((insertError as { code?: string }).code === "23505") {
        const { data: raced } = await supabase
          .from("expenses")
          .select(MONTH_COLUMNS)
          .eq("recurring_expense_template_id", templateIdIn)
          .eq("recurrence_key", recurrenceKeyIn)
          .maybeSingle<MonthRow>();
        if (raced) return await cancelRow(raced);
      }
      return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
    }
    const newId = (inserted as { id?: string } | null)?.id ?? "";
    if (!newId) return NextResponse.json({ error: "ביטול החודש נכשל." }, { status: 500 });

    // Mirror the generator: link a project expense when the template targets one.
    if (typeof t.project_id === "string" && t.project_id) {
      await supabase.from("project_expenses").insert({
        project_id: t.project_id,
        expense_id: newId,
        included_in_base_price: t.included_in_base_price === true,
        billed_to_customer: t.billed_to_customer === true,
        notes: applyTokens(t.project_expense_notes_template as string | null, recurrenceKeyIn, expenseDateIn),
      });
    }

    logAuditEventAfterResponse({
      supabase,
      tableName: "expenses",
      recordId: newId,
      action: "create",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true, id: newId });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "ביטול החודש נכשל.") }, { status: 500 });
  }
}
