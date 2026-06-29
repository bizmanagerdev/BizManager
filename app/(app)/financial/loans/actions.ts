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
}

/** Recompute and persist the loan's status from its repayments (written-off is sticky). */
async function syncLoanStatus(
  supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"],
  loanId: string
) {
  const [{ data: loan }, { data: repayments }] = await Promise.all([
    supabase.from("loans").select("amount,status").eq("id", loanId).maybeSingle(),
    supabase.from("loan_repayments").select("amount,interest_amount").eq("loan_id", loanId),
  ]);
  if (!loan) return;
  if ((loan as { status?: string }).status === "written_off") return; // manual terminal state
  const amount = Number((loan as { amount?: number }).amount ?? 0) || 0;
  const repaidPrincipal = ((repayments ?? []) as Array<Record<string, unknown>>).reduce(
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
