"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/requireProfile";
import { toHebrewError } from "@/lib/error-messages";
import { currencyPricing } from "@/lib/fx/money-input";
import { isForeignCurrency, MONEY_CURRENCY_COLUMNS, type ForeignCurrency } from "@/lib/fx/currencies";
import { loanStatusFrom } from "@/lib/loans";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type LoanInput = {
  direction: "taken" | "given";
  lender: string;
  borrower: string;
  counterparty_customer_id: string | null;
  loan_date: string;
  loan_method: string;
  repayment_method: string;
  documentation: string;
  amount: number;
  due_date: string;
  interest_amount: number;
  business_domain: string;
  account_id: string | null;
  notes: string;
  /** ₪, US$ or C$ (2026-10-23): amount and interest_amount above are in it;
   *  the rate only when typed by hand (else the Bank of Israel's of the day). */
  currency?: string;
  fx_rate?: number;
  fx_rate_manual?: boolean;
};

/** A repayment's amounts are in its LOAN's currency, at the rate of its own
 *  day — or the rate typed by hand. */
export type RepaymentInput = {
  repayment_date: string;
  amount: number;
  interest_amount: number;
  method: string;
  account_id: string | null;
  notes: string;
  fx_rate?: number;
  fx_rate_manual?: boolean;
};

/** One row of a repayment plan: an amount owed on a date, not yet paid. */
export type InstallmentInput = {
  repayment_date: string;
  amount: number;
  interest_amount: number;
  notes: string;
};

function clean(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

async function getAdminContext() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin") {
    return { ok: false as const, error: "אין הרשאה לבצע פעולה זו." };
  }
  return { ok: true as const, profile, supabase };
}

function revalidateLoans() {
  revalidatePath("/financial/loans");
  revalidatePath("/financial");
  revalidatePath("/financial/reports");
  // Planned installments are outgoing payments → they show on the payments calendar.
  revalidatePath("/financial/payments-calendar");
}

/**
 * Missing installment columns ⇒ the plan migration hasn't been run yet. Say so in
 * Hebrew instead of leaking a Postgres schema-cache error.
 */
function installmentSchemaError(message: string | undefined) {
  const m = (message ?? "").toLowerCase();
  if (
    (m.includes("status") || m.includes("installment")) &&
    (m.includes("column") || m.includes("schema cache") || m.includes("does not exist"))
  ) {
    return "תוכנית ההחזרים עדיין לא הותקנה במסד הנתונים. יש להריץ את המיגרציה 20260802000000_loan_installment_plan.";
  }
  return null;
}

type Supabase = Awaited<ReturnType<typeof requireProfile>>["supabase"];

/** Recompute and persist the loan's status from its repayments (written-off is
 *  sticky) — worked out as the loans page does (lib/loans.ts deriveLoan), so a
 *  loan in dollars is repaid when its dollars are. */
async function syncLoanStatus(supabase: Supabase, loanId: string) {
  const [{ data: loan }, { data: repayments }] = await Promise.all([
    supabase.from("loans").select(`amount,interest_amount,status,${MONEY_CURRENCY_COLUMNS}`).eq("id", loanId).maybeSingle(),
    // `*` so this keeps working before the installment migration adds `status`.
    supabase.from("loan_repayments").select("*").eq("loan_id", loanId),
  ]);
  if (!loan) return;
  if ((loan as { status?: string }).status === "written_off") return; // manual terminal state
  // Planned installments are obligations, not payments — they don't repay anything.
  const status = loanStatusFrom(loan as Record<string, unknown>, (repayments ?? []) as Array<Record<string, unknown>>);
  await supabase.from("loans").update({ status }).eq("id", loanId);
}

/** A loan's currency and the rate it was made at — its repayments are in it. */
async function loanCurrencyOf(
  supabase: Supabase,
  loanId: string
): Promise<{ currency: "ILS" | ForeignCurrency; rate: number | null }> {
  const { data } = await supabase.from("loans").select("currency,fx_rate").eq("id", loanId).maybeSingle();
  const row = data as { currency?: string; fx_rate?: number | string } | null;
  const currency = isForeignCurrency(row?.currency) ? row!.currency as ForeignCurrency : "ILS";
  const rate = Number(row?.fx_rate);
  return { currency, rate: Number.isFinite(rate) && rate > 0 ? rate : null };
}

/** A repayment's columns: its amounts typed in the loan's currency, in shekels
 *  at its day's rate (or the one typed), with the currency beside them. */
async function repaymentMoney(supabase: Supabase, loanId: string, input: RepaymentInput) {
  const { currency } = await loanCurrencyOf(supabase, loanId);
  const pricing = await currencyPricing(
    supabase,
    { currency, fx_rate: input.fx_rate, fx_rate_manual: input.fx_rate_manual },
    { amount: input.amount, date: input.repayment_date }
  );
  if ("error" in pricing) return pricing;
  const interest = Number.isFinite(input.interest_amount) ? Math.max(input.interest_amount, 0) : 0;
  return {
    amount: pricing.toShekels(input.amount),
    interest_amount: pricing.toShekels(interest),
    ...(pricing.columns ?? {}),
  };
}

/** A planned installment in a loan in dollars: at the rate the loan was made —
 *  it gets its own day's rate when it's paid. */
type PlanRate = { currency: ForeignCurrency; rate: number } | null;

function plannedMoney(row: InstallmentInput, plan: PlanRate) {
  const amount = Number(row.amount);
  const interest = Number(row.interest_amount) || 0;
  if (!plan) return { amount, interest_amount: interest };
  const round = (value: number) => Math.round(value * plan.rate * 100) / 100;
  return {
    amount: round(amount),
    interest_amount: round(interest),
    currency: plan.currency,
    foreign_amount: Math.round(amount * 100) / 100,
    fx_rate: plan.rate,
    fx_rate_manual: false,
  };
}

async function planRateOf(supabase: Supabase, loanId: string): Promise<PlanRate> {
  const { currency, rate } = await loanCurrencyOf(supabase, loanId);
  return isForeignCurrency(currency) && rate ? { currency, rate } : null;
}

function loanFields(input: LoanInput) {
  return {
    direction: input.direction === "given" ? "given" : "taken",
    lender: clean(input.lender),
    borrower: clean(input.borrower),
    counterparty_customer_id:
      typeof input.counterparty_customer_id === "string" && input.counterparty_customer_id
        ? input.counterparty_customer_id
        : null,
    loan_date: input.loan_date,
    loan_method: clean(input.loan_method),
    repayment_method: clean(input.repayment_method),
    documentation: clean(input.documentation),
    amount: Number.isFinite(input.amount) ? input.amount : 0,
    due_date: clean(input.due_date),
    interest_amount: Number.isFinite(input.interest_amount) ? input.interest_amount : 0,
    business_domain: clean(input.business_domain) ?? "general_business",
    account_id: typeof input.account_id === "string" && input.account_id ? input.account_id : null,
    notes: clean(input.notes),
  };
}

/**
 * Create the loan together with how it will be paid back. `installments` is the
 * repayment plan chosen on the form: one row for "בתשלום אחד", several for
 * "בכמה תשלומים", an empty list for "no plan yet".
 */
export async function createLoan(
  input: LoanInput,
  installments?: InstallmentInput[]
): Promise<ActionResult & { id?: string }> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!input.loan_date) return { ok: false, error: "חובה לבחור תאריך הלוואה." };
    if (!(input.amount > 0)) return { ok: false, error: "חובה להזין סכום הלוואה." };
    if (installments?.length) {
      const invalid = validateInstallments(installments);
      if (invalid) return { ok: false, error: invalid };
    }

    // In US$ or C$: the amounts as typed, in shekels at the day's rate.
    const pricing = await currencyPricing(ctx.supabase, input, { amount: input.amount, date: input.loan_date });
    if ("error" in pricing) return { ok: false, error: pricing.error };
    const fields = loanFields(input);

    const { data, error } = await ctx.supabase
      .from("loans")
      .insert({
        ...fields,
        amount: pricing.toShekels(fields.amount),
        interest_amount: pricing.toShekels(fields.interest_amount),
        ...(pricing.columns ?? {}),
        created_by: ctx.profile.id,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: toHebrewError(error.message) };

    const loanId = (data as { id?: string } | null)?.id ?? "";
    if (loanId && installments?.length) {
      const columns = pricing.columns;
      const plan: PlanRate =
        columns && isForeignCurrency(columns.currency) && columns.fx_rate
          ? { currency: columns.currency, rate: columns.fx_rate }
          : null;
      const planError = await replacePlannedInstallments(
        ctx.supabase,
        loanId,
        installments,
        ctx.profile.id,
        { newLoan: true, plan }
      );
      // The loan itself is saved — report the plan failure without losing it.
      if (planError) {
        revalidateLoans();
        return { ok: false, error: `ההלוואה נשמרה, אך תוכנית ההחזרים נכשלה: ${planError}` };
      }
    }
    revalidateLoans();
    return { ok: true, id: loanId };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה ביצירת ההלוואה.") };
  }
}

/**
 * Update the loan. Pass `installments` only when the repayment plan was actually
 * edited — it REPLACES the loan's planned installments (paid ones are untouched);
 * an empty array clears the plan. Omit it to leave the plan alone.
 */
export async function updateLoan(
  id: string,
  input: LoanInput,
  installments?: InstallmentInput[]
): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה הלוואה." };
    if (!input.loan_date) return { ok: false, error: "חובה לבחור תאריך הלוואה." };
    if (!(input.amount > 0)) return { ok: false, error: "חובה להזין סכום הלוואה." };
    if (installments?.length) {
      const invalid = validateInstallments(installments);
      if (invalid) return { ok: false, error: invalid };
    }

    // Its repayments are in the loan's currency: it can't change once it has any.
    if (input.currency !== undefined) {
      const before = await loanCurrencyOf(ctx.supabase, id);
      const next = (input.currency || "ILS").toUpperCase();
      if (next !== before.currency) {
        const { count } = await ctx.supabase
          .from("loan_repayments")
          .select("id", { count: "exact", head: true })
          .eq("loan_id", id);
        if ((count ?? 0) > 0) return { ok: false, error: "אי אפשר לשנות את המטבע של הלוואה שיש לה כבר החזרים." };
      }
    }
    const pricing = await currencyPricing(ctx.supabase, input, { amount: input.amount, date: input.loan_date });
    if ("error" in pricing) return { ok: false, error: pricing.error };
    const fields = loanFields(input);

    const { error } = await ctx.supabase
      .from("loans")
      .update({
        ...fields,
        amount: pricing.toShekels(fields.amount),
        interest_amount: pricing.toShekels(fields.interest_amount),
        ...(pricing.columns ?? {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: toHebrewError(error.message) };

    if (installments) {
      const planError = await replacePlannedInstallments(
        ctx.supabase,
        id,
        installments,
        ctx.profile.id,
        { plan: await planRateOf(ctx.supabase, id) }
      );
      if (planError) return { ok: false, error: planError };
    }
    await syncLoanStatus(ctx.supabase, id);
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בעדכון ההלוואה.") };
  }
}

export async function deleteLoan(id: string): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה הלוואה." };
    const { error } = await ctx.supabase.from("loans").delete().eq("id", id);
    if (error) return { ok: false, error: toHebrewError(error.message) };
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה במחיקת ההלוואה.") };
  }
}

export async function addRepayment(
  loanId: string,
  input: RepaymentInput
): Promise<ActionResult & { id?: string }> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!loanId) return { ok: false, error: "חסר מזהה הלוואה." };
    if (!input.repayment_date) return { ok: false, error: "חובה לבחור תאריך החזר." };
    if (!(input.amount > 0)) return { ok: false, error: "חובה להזין סכום החזר." };
    const interest = Number.isFinite(input.interest_amount) ? Math.max(input.interest_amount, 0) : 0;
    if (interest > input.amount + 0.009) {
      return { ok: false, error: "הריבית לא יכולה לעלות על סכום ההחזר." };
    }
    // In the loan's currency, at the day's rate (or the one typed).
    const money = await repaymentMoney(ctx.supabase, loanId, input);
    if ("error" in money) return { ok: false, error: money.error };

    const { data, error } = await ctx.supabase
      .from("loan_repayments")
      .insert({
        loan_id: loanId,
        repayment_date: input.repayment_date,
        ...money,
        method: clean(input.method),
        account_id: typeof input.account_id === "string" && input.account_id ? input.account_id : null,
        notes: clean(input.notes),
        created_by: ctx.profile.id,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: toHebrewError(error.message) };
    await syncLoanStatus(ctx.supabase, loanId);
    revalidateLoans();
    return { ok: true, id: (data as { id?: string } | null)?.id };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בהוספת החזר.") };
  }
}

// ── Installment plan (תוכנית החזרים) ────────────────────────────────────────
// A planned installment lives in loan_repayments with status='planned': it's an
// amount owed on a date that hasn't moved yet. It never reduces the outstanding
// balance — marking it paid does.

function validateInstallments(installments: InstallmentInput[]) {
  if (!Array.isArray(installments) || installments.length === 0) {
    return "יש להזין לפחות תשלום אחד.";
  }
  if (installments.length > 240) return "מספר התשלומים גדול מדי (עד 240).";
  for (const row of installments) {
    if (!row?.repayment_date) return "לכל תשלום חייב להיות תאריך.";
    if (!(Number(row.amount) > 0)) return "לכל תשלום חייב להיות סכום גדול מאפס.";
    const interest = Number(row.interest_amount) || 0;
    if (interest < 0) return "הריבית לא יכולה להיות שלילית.";
    if (interest > Number(row.amount) + 0.009) {
      return "הריבית לא יכולה לעלות על סכום התשלום.";
    }
  }
  return null;
}

/**
 * Replace a loan's PLANNED installments with `installments` (paid repayments are
 * never touched). An empty list just clears the plan. Returns a Hebrew error
 * string on failure, or null on success.
 */
async function replacePlannedInstallments(
  supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"],
  loanId: string,
  installments: InstallmentInput[],
  userId: string,
  /** A loan created a moment ago has no planned rows to clear — skip the delete.
   *  `plan`: a loan in dollars — its installments at the rate it was made. */
  { newLoan = false, plan = null }: { newLoan?: boolean; plan?: PlanRate } = {}
): Promise<string | null> {
  if (!newLoan) {
    const { error: delError } = await supabase
      .from("loan_repayments")
      .delete()
      .eq("loan_id", loanId)
      .eq("status", "planned");
    if (delError) {
      return installmentSchemaError(delError.message) ?? toHebrewError(delError.message);
    }
  }
  if (installments.length === 0) return null;

  const ordered = installments
    .slice()
    .sort((a, b) => a.repayment_date.localeCompare(b.repayment_date));
  const { error } = await supabase.from("loan_repayments").insert(
    ordered.map((row, index) => ({
      loan_id: loanId,
      repayment_date: row.repayment_date,
      ...plannedMoney(row, plan),
      status: "planned",
      installment_index: index + 1,
      installment_count: ordered.length,
      notes: clean(row.notes),
      created_by: userId,
    }))
  );
  if (error) return installmentSchemaError(error.message) ?? toHebrewError(error.message);
  return null;
}

/**
 * Save (replace) a loan's repayment plan on its own — used by the plan section
 * inside the repayments dialog. An empty list clears the plan.
 */
export async function saveInstallmentPlan(
  loanId: string,
  installments: InstallmentInput[]
): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!loanId) return { ok: false, error: "חסר מזהה הלוואה." };
    if (installments.length > 0) {
      const invalid = validateInstallments(installments);
      if (invalid) return { ok: false, error: invalid };
    }

    const planError = await replacePlannedInstallments(
      ctx.supabase,
      loanId,
      installments,
      ctx.profile.id,
      { plan: await planRateOf(ctx.supabase, loanId) }
    );
    if (planError) return { ok: false, error: planError };
    await syncLoanStatus(ctx.supabase, loanId);
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בשמירת תוכנית ההחזרים.") };
  }
}

/** Edit a single planned installment (date / amount / interest / note). */
export async function updateInstallment(
  id: string,
  loanId: string,
  input: InstallmentInput
): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה תשלום." };
    const invalid = validateInstallments([input]);
    if (invalid) return { ok: false, error: invalid };

    const { error } = await ctx.supabase
      .from("loan_repayments")
      .update({
        repayment_date: input.repayment_date,
        ...plannedMoney(input, loanId ? await planRateOf(ctx.supabase, loanId) : null),
        notes: clean(input.notes),
      })
      .eq("id", id)
      .eq("status", "planned");
    if (error) {
      return {
        ok: false,
        error: installmentSchemaError(error.message) ?? toHebrewError(error.message),
      };
    }
    if (loanId) await syncLoanStatus(ctx.supabase, loanId);
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בעדכון התשלום.") };
  }
}

/**
 * Mark a planned installment as actually paid. `parts` is one or more real cash
 * movements that TOGETHER settle this one due date — e.g. ₪1,000 cash + ₪4,000
 * bank transfer for a single ₪5,000 installment. The planned row is replaced by
 * one 'paid' row per part (all carrying the same installment_index/count, so the
 * paid history still shows them as one due date); no OTHER installment is
 * touched. The combined amount/dates can differ from the plan (paid early, paid
 * a bit less…).
 */
export async function markInstallmentPaid(
  id: string,
  loanId: string,
  parts: RepaymentInput[]
): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה תשלום." };
    if (!Array.isArray(parts) || parts.length === 0) {
      return { ok: false, error: "יש להזין לפחות תשלום אחד." };
    }
    for (const part of parts) {
      if (!part.repayment_date) return { ok: false, error: "חובה לבחור תאריך לכל תשלום." };
      if (!(part.amount > 0)) return { ok: false, error: "חובה להזין סכום לכל תשלום." };
      const interest = Number.isFinite(part.interest_amount) ? Math.max(part.interest_amount, 0) : 0;
      if (interest > part.amount + 0.009) {
        return { ok: false, error: "הריבית לא יכולה לעלות על סכום התשלום." };
      }
    }

    const { data: installmentRow } = await ctx.supabase
      .from("loan_repayments")
      .select("installment_index,installment_count")
      .eq("id", id)
      .eq("status", "planned")
      .maybeSingle();
    const position = installmentRow as { installment_index?: number; installment_count?: number } | null;

    // Insert the paid rows BEFORE deleting the planned one: if the insert fails,
    // the plan is still intact (worst case on a delete failure afterward is a
    // harmless duplicate, never a lost installment).
    // Each part in the loan's currency, at its own day's rate (or the one typed).
    const priced = [];
    for (const part of parts) {
      const money = await repaymentMoney(ctx.supabase, loanId, part);
      if ("error" in money) return { ok: false, error: money.error };
      priced.push({ part, money });
    }
    const { error: insError } = await ctx.supabase.from("loan_repayments").insert(
      priced.map(({ part, money }) => ({
        loan_id: loanId,
        status: "paid",
        repayment_date: part.repayment_date,
        ...money,
        method: clean(part.method),
        account_id: typeof part.account_id === "string" && part.account_id ? part.account_id : null,
        notes: clean(part.notes),
        installment_index: position?.installment_index ?? null,
        installment_count: position?.installment_count ?? null,
        created_by: ctx.profile.id,
      }))
    );
    if (insError) {
      return {
        ok: false,
        error: installmentSchemaError(insError.message) ?? toHebrewError(insError.message),
      };
    }

    const { error: delError } = await ctx.supabase
      .from("loan_repayments")
      .delete()
      .eq("id", id)
      .eq("status", "planned");
    if (delError) {
      return {
        ok: false,
        error: installmentSchemaError(delError.message) ?? toHebrewError(delError.message),
      };
    }

    if (loanId) await syncLoanStatus(ctx.supabase, loanId);
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בסימון התשלום.") };
  }
}

/** Edit an already-PAID repayment (date / amount / interest / method / account / note). */
export async function updateRepayment(
  id: string,
  loanId: string,
  input: RepaymentInput
): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה החזר." };
    if (!input.repayment_date) return { ok: false, error: "חובה לבחור תאריך החזר." };
    if (!(input.amount > 0)) return { ok: false, error: "חובה להזין סכום החזר." };
    const interest = Number.isFinite(input.interest_amount) ? Math.max(input.interest_amount, 0) : 0;
    if (interest > input.amount + 0.009) {
      return { ok: false, error: "הריבית לא יכולה לעלות על סכום ההחזר." };
    }
    const money = await repaymentMoney(ctx.supabase, loanId, input);
    if ("error" in money) return { ok: false, error: money.error };

    const { error } = await ctx.supabase
      .from("loan_repayments")
      .update({
        repayment_date: input.repayment_date,
        ...money,
        method: clean(input.method),
        account_id:
          typeof input.account_id === "string" && input.account_id ? input.account_id : null,
        notes: clean(input.notes),
      })
      .eq("id", id)
      // Editing a still-planned row belongs to updateInstallment, not here.
      .neq("status", "planned");
    if (error) return { ok: false, error: toHebrewError(error.message) };
    if (loanId) await syncLoanStatus(ctx.supabase, loanId);
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בעדכון ההחזר.") };
  }
}

/** Undo a mistaken "paid" — the row goes back to being a planned installment. */
export async function unmarkInstallmentPaid(id: string, loanId: string): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה תשלום." };
    const { error } = await ctx.supabase
      .from("loan_repayments")
      .update({ status: "planned" })
      .eq("id", id);
    if (error) {
      return {
        ok: false,
        error: installmentSchemaError(error.message) ?? toHebrewError(error.message),
      };
    }
    if (loanId) await syncLoanStatus(ctx.supabase, loanId);
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בביטול הסימון.") };
  }
}

export async function deleteRepayment(id: string, loanId: string): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה החזר." };
    const { error } = await ctx.supabase.from("loan_repayments").delete().eq("id", id);
    if (error) return { ok: false, error: toHebrewError(error.message) };
    if (loanId) await syncLoanStatus(ctx.supabase, loanId);
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה במחיקת ההחזר.") };
  }
}
