"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/requireProfile";
import { toHebrewError } from "@/lib/error-messages";

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
};

export type RepaymentInput = {
  repayment_date: string;
  amount: number;
  interest_amount: number;
  method: string;
  account_id: string | null;
  notes: string;
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

/** Recompute and persist the loan's status from its repayments (written-off is sticky). */
async function syncLoanStatus(
  supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"],
  loanId: string
) {
  const [{ data: loan }, { data: repayments }] = await Promise.all([
    supabase.from("loans").select("amount,status").eq("id", loanId).maybeSingle(),
    // `*` so this keeps working before the installment migration adds `status`.
    supabase.from("loan_repayments").select("*").eq("loan_id", loanId),
  ]);
  if (!loan) return;
  if ((loan as { status?: string }).status === "written_off") return; // manual terminal state
  const amount = Number((loan as { amount?: number }).amount ?? 0) || 0;
  // Planned installments are obligations, not payments — they don't repay anything.
  const repaidPrincipal = ((repayments ?? []) as Array<Record<string, unknown>>)
    .filter((r) => r.status !== "planned")
    .reduce(
      (sum, r) => sum + Math.max(Number(r.amount ?? 0) - Number(r.interest_amount ?? 0), 0),
      0
    );
  const outstanding = Math.max(amount - repaidPrincipal, 0);
  const status =
    outstanding <= 0.009 ? "repaid" : repaidPrincipal > 0.009 ? "partially_repaid" : "active";
  await supabase.from("loans").update({ status }).eq("id", loanId);
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

export async function createLoan(input: LoanInput): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!input.loan_date) return { ok: false, error: "חובה לבחור תאריך הלוואה." };
    if (!(input.amount > 0)) return { ok: false, error: "חובה להזין סכום הלוואה." };

    const { error } = await ctx.supabase
      .from("loans")
      .insert({ ...loanFields(input), created_by: ctx.profile.id });
    if (error) return { ok: false, error: toHebrewError(error.message) };
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה ביצירת ההלוואה.") };
  }
}

export async function updateLoan(id: string, input: LoanInput): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה הלוואה." };
    if (!input.loan_date) return { ok: false, error: "חובה לבחור תאריך הלוואה." };
    if (!(input.amount > 0)) return { ok: false, error: "חובה להזין סכום הלוואה." };

    const { error } = await ctx.supabase
      .from("loans")
      .update({ ...loanFields(input), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: toHebrewError(error.message) };
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

export async function setLoanWrittenOff(id: string, writtenOff: boolean): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה הלוואה." };
    if (writtenOff) {
      const { error } = await ctx.supabase
        .from("loans")
        .update({ status: "written_off" })
        .eq("id", id);
      if (error) return { ok: false, error: toHebrewError(error.message) };
    } else {
      // Un-write-off: recompute from repayments.
      await ctx.supabase.from("loans").update({ status: "active" }).eq("id", id);
      await syncLoanStatus(ctx.supabase, id);
    }
    revalidateLoans();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toHebrewError(error, "שגיאה בעדכון הסטטוס.") };
  }
}

export async function addRepayment(loanId: string, input: RepaymentInput): Promise<ActionResult> {
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

    const { error } = await ctx.supabase.from("loan_repayments").insert({
      loan_id: loanId,
      repayment_date: input.repayment_date,
      amount: input.amount,
      interest_amount: interest,
      method: clean(input.method),
      account_id: typeof input.account_id === "string" && input.account_id ? input.account_id : null,
      notes: clean(input.notes),
      created_by: ctx.profile.id,
    });
    if (error) return { ok: false, error: toHebrewError(error.message) };
    await syncLoanStatus(ctx.supabase, loanId);
    revalidateLoans();
    return { ok: true };
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
 * Save a repayment plan for a loan. `replaceExisting` wipes the loan's current
 * PLANNED installments first (paid repayments are never touched) so re-planning
 * a loan is one atomic-feeling action instead of a manual cleanup.
 */
export async function saveInstallmentPlan(
  loanId: string,
  installments: InstallmentInput[],
  replaceExisting = true
): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!loanId) return { ok: false, error: "חסר מזהה הלוואה." };
    const invalid = validateInstallments(installments);
    if (invalid) return { ok: false, error: invalid };

    if (replaceExisting) {
      const { error: delError } = await ctx.supabase
        .from("loan_repayments")
        .delete()
        .eq("loan_id", loanId)
        .eq("status", "planned");
      if (delError) {
        return {
          ok: false,
          error: installmentSchemaError(delError.message) ?? toHebrewError(delError.message),
        };
      }
    }

    const ordered = installments
      .slice()
      .sort((a, b) => a.repayment_date.localeCompare(b.repayment_date));
    const { error } = await ctx.supabase.from("loan_repayments").insert(
      ordered.map((row, index) => ({
        loan_id: loanId,
        repayment_date: row.repayment_date,
        amount: Number(row.amount),
        interest_amount: Number(row.interest_amount) || 0,
        status: "planned",
        installment_index: index + 1,
        installment_count: ordered.length,
        notes: clean(row.notes),
        created_by: ctx.profile.id,
      }))
    );
    if (error) {
      return {
        ok: false,
        error: installmentSchemaError(error.message) ?? toHebrewError(error.message),
      };
    }
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
        amount: Number(input.amount),
        interest_amount: Number(input.interest_amount) || 0,
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
 * Mark a planned installment as actually paid: it flips to status='paid' and
 * from that moment reduces the loan's outstanding balance and counts as cash.
 * The amount/date can differ from the plan (paid early, paid a bit less…).
 */
export async function markInstallmentPaid(
  id: string,
  loanId: string,
  input: RepaymentInput
): Promise<ActionResult> {
  try {
    const ctx = await getAdminContext();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (!id) return { ok: false, error: "חסר מזהה תשלום." };
    if (!input.repayment_date) return { ok: false, error: "חובה לבחור תאריך תשלום." };
    if (!(input.amount > 0)) return { ok: false, error: "חובה להזין סכום." };
    const interest = Number.isFinite(input.interest_amount) ? Math.max(input.interest_amount, 0) : 0;
    if (interest > input.amount + 0.009) {
      return { ok: false, error: "הריבית לא יכולה לעלות על סכום ההחזר." };
    }

    const { error } = await ctx.supabase
      .from("loan_repayments")
      .update({
        status: "paid",
        repayment_date: input.repayment_date,
        amount: input.amount,
        interest_amount: interest,
        method: clean(input.method),
        account_id:
          typeof input.account_id === "string" && input.account_id ? input.account_id : null,
        notes: clean(input.notes),
      })
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
    return { ok: false, error: toHebrewError(error, "שגיאה בסימון התשלום.") };
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
