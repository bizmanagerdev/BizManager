import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import {
  ensureRecurringExpensesForDate,
  invalidateRecurringExpensesEnsureCache,
} from "@/lib/recurring-expenses";

type Frequency = "monthly" | "yearly";

type Payload = {
  id?: string | null;
  template_name?: string | null;
  category?: string | null;
  amount?: number | string | null;
  description_template?: string | null;
  notes_template?: string | null;
  business_domain?: string | null;
  project_id?: string | null;
  order_id?: string | null;
  property_id?: string | null;
  account_id?: string | null;
  included_in_base_price?: boolean | null;
  billed_to_customer?: boolean | null;
  project_expense_notes_template?: string | null;
  frequency?: Frequency | null;
  interval_months?: number | string | null;
  is_variable_amount?: boolean | null;
  auto_paid?: boolean | null;
  reminder_work_days_before?: number | string | null;
  create_day_of_month?: number | string | null;
  expense_day_of_month?: number | string | null;
  create_month_of_year?: number | string | null;
  expense_month_of_year?: number | string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean | null;
  /**
   * What a CHANGED amount does to the rows this template already generated.
   * The generator copies the amount into each expense row and never revisits it,
   * so without this an edit only ever affects occurrences generated from now on.
   *   "none"   — leave every existing row alone (old behaviour)
   *   "unpaid" — re-price rows that haven't been paid yet (nothing moved yet)
   *   "all"    — re-price the whole history from start_date, paid rows included
   */
  amount_propagation?: "none" | "unpaid" | "all" | null;
};

function normalizeId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeAmount(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeDay(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(31, Math.floor(parsed)));
}

function normalizeMonth(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(12, Math.floor(parsed)));
}

function validateTemplateLinkArgs(args: {
  businessDomain: string | null;
  projectId: string | null;
  orderId: string | null;
  propertyId: string | null;
}) {
  const linkedCount = [args.projectId, args.orderId, args.propertyId].filter(Boolean).length;
  if (linkedCount > 1) return false;

  if (args.businessDomain === "logistics_projects") {
    return Boolean(args.projectId) && !args.orderId && !args.propertyId;
  }

  if (args.businessDomain === "property_management") {
    return Boolean(args.propertyId) && !args.projectId && !args.orderId;
  }

  return !args.projectId && !args.propertyId;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const id = normalizeId(body.id);
    const templateName = normalizeText(body.template_name) ?? "";
    const category = normalizeText(body.category) ?? "";
    const amount = normalizeAmount(body.amount);
    const descriptionTemplate = normalizeText(body.description_template);
    const notesTemplate = normalizeText(body.notes_template);
    const businessDomain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null;
    const projectId = normalizeId(body.project_id);
    const orderId = normalizeId(body.order_id);
    const propertyId = normalizeId(body.property_id);
    const accountId = normalizeId(body.account_id);
    const includedInBasePrice = body.included_in_base_price === true;
    const billedToCustomer = body.billed_to_customer === true;
    const projectExpenseNotesTemplate = normalizeText(body.project_expense_notes_template);
    const frequency: Frequency = body.frequency === "yearly" ? "yearly" : "monthly";
    // Interval only applies to monthly templates (yearly is once a year).
    const intervalMonths = (() => {
      if (frequency === "yearly") return 1;
      const parsed = typeof body.interval_months === "number" ? body.interval_months
        : typeof body.interval_months === "string" ? Number(body.interval_months) : NaN;
      if (!Number.isFinite(parsed)) return 1;
      return Math.max(1, Math.min(12, Math.floor(parsed)));
    })();
    const createDay = normalizeDay(body.create_day_of_month, 1);
    const expenseDay = normalizeDay(body.expense_day_of_month, createDay);
    const createMonth = frequency === "yearly" ? normalizeMonth(body.create_month_of_year) : null;
    const expenseMonth = frequency === "yearly" ? normalizeMonth(body.expense_month_of_year) : null;
    const startDate = normalizeText(body.start_date);
    const endDate = normalizeText(body.end_date);
    const isActive = body.is_active === false ? false : true;
    const isVariableAmount = body.is_variable_amount === true;
    // Bank standing order (הוראת קבע): generated rows are auto-marked paid. Meaningless
    // for a variable-amount bill (amount unknown until paid), so they're exclusive.
    const autoPaid = !isVariableAmount && body.auto_paid === true;
    // Monthly reminder: N WORK-days before each occurrence (0/empty = off).
    const reminderWorkDaysBefore = (() => {
      const parsed = typeof body.reminder_work_days_before === "number" ? body.reminder_work_days_before
        : typeof body.reminder_work_days_before === "string" ? Number(body.reminder_work_days_before) : NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return Math.min(30, Math.floor(parsed));
    })();
    // Variable-amount templates (e.g. taxes) may have amount 0 — the amount is set
    // at pay time. Non-variable still require a positive amount.
    const effectiveAmount = isVariableAmount ? (Number.isFinite(amount) && amount > 0 ? amount : 0) : amount;

    if (!templateName || !category || !businessDomain || (!isVariableAmount && (!Number.isFinite(amount) || amount <= 0))) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!validateTemplateLinkArgs({ businessDomain, projectId, orderId, propertyId })) {
      return NextResponse.json(
        { error: "Invalid linked target for selected business_domain" },
        { status: 400 }
      );
    }

    if (frequency === "yearly" && (!createMonth || !expenseMonth)) {
      return NextResponse.json({ error: "Missing yearly month values" }, { status: 400 });
    }

    const payload = {
      template_name: templateName,
      category,
      amount: effectiveAmount,
      is_variable_amount: isVariableAmount,
      auto_paid: autoPaid,
      reminder_work_days_before: reminderWorkDaysBefore,
      description_template: descriptionTemplate,
      notes_template: notesTemplate,
      business_domain: businessDomain,
      project_id: businessDomain === "logistics_projects" ? projectId : null,
      order_id: businessDomain === "sales" ? orderId : null,
      property_id: businessDomain === "property_management" ? propertyId : null,
      account_id: accountId,
      included_in_base_price: includedInBasePrice,
      billed_to_customer: billedToCustomer,
      project_expense_notes_template: projectExpenseNotesTemplate,
      frequency,
      interval_months: intervalMonths,
      create_day_of_month: createDay,
      expense_day_of_month: expenseDay,
      create_month_of_year: createMonth,
      expense_month_of_year: expenseMonth,
      start_date: startDate,
      end_date: endDate,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    };

    let templateId = id;
    // The amount BEFORE this save — needed both to know whether it actually
    // changed and to spot rows that were fully paid at the old figure.
    let previousAmount: number | null = null;

    if (templateId) {
      const { data: existing } = await supabase
        .from("recurring_expense_templates")
        .select("amount")
        .eq("id", templateId)
        .maybeSingle<{ amount: number | string | null }>();
      const parsed = existing ? Number(existing.amount) : NaN;
      previousAmount = Number.isFinite(parsed) ? parsed : null;

      const { error } = await supabase
        .from("recurring_expense_templates")
        .update(payload)
        .eq("id", templateId);

      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    } else {
      const { data, error } = await supabase
        .from("recurring_expense_templates")
        .insert({
          ...payload,
          created_by: profile.id,
        })
        .select("id")
        .maybeSingle<{ id: string }>();

      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      templateId = data?.id ?? null;
    }

    if (!templateId) {
      return NextResponse.json({ error: "Failed to save recurring expense template" }, { status: 500 });
    }

    // ── Push a changed amount onto the rows this template already generated ──
    // Each generated expense holds a SNAPSHOT of the amount, so the template edit
    // alone would only reach occurrences created from here on.
    const propagation =
      body.amount_propagation === "all"
        ? "all"
        : body.amount_propagation === "unpaid"
          ? "unpaid"
          : "none";
    let repricedCount = 0;
    const amountChanged =
      previousAmount !== null && Number.isFinite(effectiveAmount) && previousAmount !== effectiveAmount;

    if (id && propagation !== "none" && amountChanged && !isVariableAmount) {
      if (propagation === "unpaid") {
        // Nothing has moved on these yet, so re-pricing them rewrites no history.
        const { data, error } = await supabase
          .from("expenses")
          .update({ amount: effectiveAmount, updated_at: new Date().toISOString() })
          .eq("recurring_expense_template_id", id)
          .in("payment_status", ["not_paid", "pending"])
          .select("id");
        if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
        repricedCount = (data ?? []).length;
      } else {
        // "It was always this amount" — rewrite the history from the start date.
        const from = startDate ?? "1900-01-01";
        const { data, error } = await supabase
          .from("expenses")
          .update({ amount: effectiveAmount, updated_at: new Date().toISOString() })
          .eq("recurring_expense_template_id", id)
          .gte("expense_date", from)
          .select("id");
        if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
        repricedCount = (data ?? []).length;

        // A row that was fully paid at the OLD figure stays fully paid at the new
        // one — otherwise it would silently turn into a part-paid row. Rows paid a
        // different amount (a real partial payment) keep what actually moved.
        await supabase
          .from("expenses")
          .update({ paid_amount: effectiveAmount, updated_at: new Date().toISOString() })
          .eq("recurring_expense_template_id", id)
          .gte("expense_date", from)
          .eq("paid_amount", previousAmount as number);
      }
    }

    // ── Materialize this template's occurrences NOW ─────────────────────────
    // The daily generator is memoized per date per server instance, so a template
    // saved after today's run would produce nothing until tomorrow: its periods
    // would show in the calendar only as FORECASTS (always rendered unpaid, even
    // for a standing order) and be absent from the ledger and the bank comparison.
    // Saving is exactly the moment to run it.
    let generatedCount = 0;
    try {
      invalidateRecurringExpensesEnsureCache();
      const generated = await ensureRecurringExpensesForDate(supabase);
      generatedCount += generated.createdCount;
      // Also fill any PAST period the daily generator won't touch (it only
      // back-fills standing orders; a manual template gets the current period
      // only). No-op when migration 20260809000000 isn't deployed yet.
      const { data: backfilled, error: backfillError } = await supabase.rpc(
        "backfill_recurring_expense",
        { p_template_id: templateId }
      );
      if (!backfillError) generatedCount += Number(backfilled) || 0;
    } catch {
      // Generating is a convenience on top of the save — never fail the save for it.
    }

    return NextResponse.json({ ok: true, id: templateId, repricedCount, generatedCount });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
