"use client";

// The loan create/edit dialog, the repayments panel (+ its dialog wrapper), and
// the documents dialog — shared between the loans list (app/.../loans/LoansClient.tsx)
// and a single loan's detail page (app/.../loans/[id]/LoanDetailClient.tsx) so
// both "edit" and "add a payment" behave identically wherever they're triggered.

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UndoIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { CustomerPicker, type PickedCustomer } from "@/components/customers/CustomerPicker";
import { toHebrewError } from "@/lib/error-messages";
import { offlineUpload } from "@/lib/offline-upload";
import { FormDialog } from "@/components/ui/form-dialog";
import { ViewDialog } from "@/components/ui/view-dialog";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { type Loan, type LoanDirection, type LoanRepayment } from "@/lib/loans";
import {
  addRepayment,
  createLoan,
  deleteRepayment,
  unmarkInstallmentPaid,
  updateLoan,
  updateRepayment,
  type LoanInput,
} from "./actions";
import InstallmentPlanSection from "./InstallmentPlanSection";
import RepaymentPlanPicker, {
  emptyPlanState,
  planLastDate,
  planRows,
  planStateFromInstallments,
  type RepaymentPlanState,
} from "./RepaymentPlanPicker";
import { Field, METHOD_OPTIONS, StatBox, formatDate, formatIls, todayIso } from "./shared";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

// The business owner — auto-filled on "our" side of every loan.
const BUSINESS_OWNER_NAME = "יעקב הלר";

type FormState = {
  direction: LoanDirection;
  // The external party (a customer); which label it carries depends on direction.
  counterpartyCustomer: PickedCustomer | null;
  // Our side of the deal (defaults to the business owner).
  ourSide: string;
  loan_date: string;
  amount: string;
  due_date: string;
  interest_amount: string;
  loan_method: string;
  repayment_method: string;
  account_id: string;
  documentation: string;
  notes: string;
};

function loanToForm(loan: Loan | null): FormState {
  const direction = loan?.direction ?? "taken";
  // taken (we borrowed): counterparty is the lender (מלווה), our side is the borrower (לווה).
  // given (we lent):     counterparty is the borrower (לווה), our side is the lender (מלווה).
  const counterpartyName = loan ? (direction === "taken" ? loan.lender : loan.borrower) : null;
  const ourSideName = loan ? (direction === "taken" ? loan.borrower : loan.lender) : null;
  return {
    direction,
    counterpartyCustomer:
      loan && (loan.counterparty_customer_id || counterpartyName)
        ? { id: loan.counterparty_customer_id ?? "", name: counterpartyName ?? "", phone: null }
        : null,
    ourSide: ourSideName ?? BUSINESS_OWNER_NAME,
    loan_date: loan?.loan_date ?? todayIso(),
    amount: loan ? String(loan.amount) : "",
    due_date: loan?.due_date ?? "",
    interest_amount: loan && loan.interest_amount ? String(loan.interest_amount) : "",
    loan_method: loan?.loan_method ?? "",
    repayment_method: loan?.repayment_method ?? "",
    account_id: loan?.account_id ?? "",
    documentation: loan?.documentation ?? "",
    notes: loan?.notes ?? "",
  };
}

// ── Loan create / edit dialog ──────────────────────────────────────────────
export function LoanFormDialog({
  open,
  loan,
  onOpenChange,
}: {
  open: boolean;
  loan: Loan | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => loanToForm(loan));
  const [loanAccountsList, setLoanAccountsList] = useState<Account[]>([]);
  const [pending, startTransition] = useTransition();
  // How the loan gets paid back — chosen here, on the same form as the loan.
  const [plan, setPlan] = useState<RepaymentPlanState>(() =>
    loan
      ? planStateFromInstallments(loan.plannedInstallments, {
          amount: loan.outstanding,
          dueDate: loan.due_date,
        })
      : emptyPlanState()
  );
  // Only send the plan on save if it was actually touched, so editing a loan's
  // notes doesn't rewrite installments that are already planned.
  const [planDirty, setPlanDirty] = useState(false);
  // Re-seed the form whenever the dialog opens for a different loan.
  const [seedKey, setSeedKey] = useState<string>("");
  const key = `${open ? "open" : "closed"}:${loan?.id ?? "new"}`;
  if (open && key !== seedKey) {
    setSeedKey(key);
    setForm(loanToForm(loan));
    setPlan(
      loan
        ? planStateFromInstallments(loan.plannedInstallments, {
            amount: loan.outstanding,
            dueDate: loan.due_date,
          })
        : emptyPlanState()
    );
    setPlanDirty(false);
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function submit() {
    const taken = form.direction === "taken";
    const counterpartyName = form.counterpartyCustomer?.name.trim() ?? "";
    const ourSide = form.ourSide.trim() || BUSINESS_OWNER_NAME;
    const loanAmount = Number(form.amount) || 0;
    // The repayment plan covers what's still owed (a partly-repaid loan plans the
    // rest); the loan's תאריך פרעון is simply the date of its last payment.
    const planAmount = loan ? Math.max(loanAmount - loan.repaidPrincipal, 0) : loanAmount;
    const rows = planRows(plan, planAmount).filter((row) => row.date && Number(row.amount) > 0);
    const installments = rows.map((row) => ({
      repayment_date: row.date,
      amount: Number(row.amount),
      interest_amount: 0,
      notes: "",
    }));
    const payload: LoanInput = {
      direction: form.direction,
      // taken: counterparty = lender (מלווה), us = borrower (לווה). given: the reverse.
      lender: taken ? counterpartyName : ourSide,
      borrower: taken ? ourSide : counterpartyName,
      counterparty_customer_id: form.counterpartyCustomer?.id || null,
      loan_date: form.loan_date,
      loan_method: form.loan_method,
      repayment_method: form.repayment_method,
      documentation: form.documentation,
      amount: loanAmount,
      due_date: planLastDate(plan, planAmount) || form.due_date,
      interest_amount: Number(form.interest_amount) || 0,
      // Loans are always general — no per-domain breakdown for them.
      business_domain: "general_business",
      account_id: form.account_id || null,
      notes: form.notes,
    };
    if (!payload.loan_date) {
      toast.error("חובה לבחור תאריך הלוואה.");
      return;
    }
    if (!(payload.amount > 0)) {
      toast.error("חובה להזין סכום הלוואה.");
      return;
    }
    if (!counterpartyName) {
      toast.error(taken ? "חובה לבחור ממי לקחת את ההלוואה." : "חובה לבחור למי נתת את ההלוואה.");
      return;
    }
    if (loanAccountsList.length > 0 && !payload.account_id) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    // Send the plan when it was edited — or when an older loan has a repayment
    // date but no scheduled payment yet, so saving it once fills that in.
    const sendPlan =
      planDirty || (loan ? loan.plannedInstallments.length === 0 && installments.length > 0 : true);
    startTransition(async () => {
      const res = loan
        ? await updateLoan(loan.id, payload, sendPlan ? installments : undefined)
        : await createLoan(payload, installments);
      if (res.ok) {
        toast.success(
          loan
            ? "ההלוואה עודכנה."
            : installments.length > 1
              ? `ההלוואה נוספה עם ${installments.length} תשלומים.`
              : "ההלוואה נוספה."
        );
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={loan ? "עריכת הלוואה" : "הלוואה חדשה"}
      size="form2xl"
      onSubmit={submit}
      submitLabel={loan ? "שמירה" : "הוספה"}
      busyLabel="שומר..."
      busy={pending}
    >

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={form.direction === "taken" ? "default" : "outline"}
              onClick={() => set("direction", "taken")}
            >
              הלוואה שלקחתי
            </Button>
            <Button
              type="button"
              variant={form.direction === "given" ? "default" : "outline"}
              onClick={() => set("direction", "given")}
            >
              הלוואה שנתתי
            </Button>
          </div>

          <AdaptiveGrid variant="formTwo">
            <Field label={form.direction === "taken" ? "מלווה — ממי לקחתי (לקוח)" : "לווה — למי נתתי (לקוח)"}>
              <CustomerPicker
                key={seedKey || "loan-customer"}
                value={form.counterpartyCustomer}
                onChange={(customer) => set("counterpartyCustomer", customer)}
              />
            </Field>
            <Field label={form.direction === "taken" ? "לווה (הצד שלנו)" : "מלווה (הצד שלנו)"}>
              <Input value={form.ourSide} onChange={(e) => set("ourSide", e.target.value)} />
            </Field>
            <Field label="תאריך הלוואה">
              <Input type="date" value={form.loan_date} onChange={(e) => set("loan_date", e.target.value)} />
            </Field>
            <Field label="סכום ההלוואה">
              <CurrencyInput
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </Field>
            <Field label="ריבית (אם יש)">
              <CurrencyInput
                value={form.interest_amount}
                onChange={(e) => set("interest_amount", e.target.value)}
              />
            </Field>
            <Field label="אופן ההלוואה">
              <NativeSelect
                value={form.loan_method}
                onChange={(e) => {
                  const m = e.target.value;
                  setForm((current) => ({
                    ...current,
                    loan_method: m,
                    account_id: current.account_id || defaultAccountForMethod(loanAccountsList, m),
                  }));
                }}
              >
                {METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <AccountSelect
              required
              value={form.account_id}
              onChange={(accountId) => set("account_id", accountId)}
              onLoaded={(list) => {
                setLoanAccountsList(list);
                setForm((current) => ({
                  ...current,
                  account_id: current.account_id || defaultAccountForMethod(list, current.loan_method),
                }));
              }}
            />
            <Field label="אופן ההחזרה">
              <NativeSelect
                value={form.repayment_method}
                onChange={(e) => set("repayment_method", e.target.value)}
              >
                {METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="תיעוד ההלוואה">
              <Input
                value={form.documentation}
                onChange={(e) => set("documentation", e.target.value)}
              />
            </Field>
          </AdaptiveGrid>

          <div className="rounded-md border bg-muted/20 p-3">
            <RepaymentPlanPicker
              label={form.direction === "taken" ? "איך אחזיר?" : "איך יחזירו לי?"}
              state={plan}
              amount={Math.max((Number(form.amount) || 0) - (loan?.repaidPrincipal ?? 0), 0)}
              onChange={(next) => {
                setPlan(next);
                setPlanDirty(true);
              }}
            />
            {loan && loan.paidRepayments.length > 0 ? (
              <div className="mt-2 text-xs text-muted-foreground">
                שינוי כאן מחליף רק את התשלומים שעדיין לא שולמו.
              </div>
            ) : null}
          </div>

          <Field label="הערות">
            <textarea
              className="min-h-[72px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

        </div>
    </FormDialog>
  );
}

// ── Repayments panel: the plan + paid history + ad-hoc add-repayment form ──
// Pure content, no dialog chrome — embedded directly on the loan detail page,
// and wrapped in a ViewDialog below for the loans list's own "החזרים" button.
export function LoanRepaymentsPanel({ loan }: { loan: Loan }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("");
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [notes, setNotes] = useState("");
  // Recording a repayment that isn't one of the planned payments — the exception,
  // so it stays folded away.
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LoanRepayment | null>(null);

  function add() {
    const amt = Number(amount) || 0;
    if (!date) {
      toast.error("חובה לבחור תאריך החזר.");
      return;
    }
    if (!(amt > 0)) {
      toast.error("חובה להזין סכום החזר.");
      return;
    }
    if (accountsList.length > 0 && !accountId) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    startTransition(async () => {
      const res = await addRepayment(loan.id, {
        repayment_date: date,
        amount: amt,
        interest_amount: Number(interest) || 0,
        method,
        account_id: accountId || null,
        notes,
      });
      if (res.ok) {
        toast.success("ההחזר נרשם.");
        setAdHocOpen(false);
        setAmount("");
        setInterest("");
        setAccountId("");
        setNotes("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function removeRepayment(id: string) {
    startTransition(async () => {
      const res = await deleteRepayment(id, loan.id);
      if (res.ok) {
        toast.success("ההחזר נמחק.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // Undo a repayment that was marked paid by mistake: it returns to the plan as
  // a planned installment instead of being deleted outright.
  function revertRepayment(id: string) {
    startTransition(async () => {
      const res = await unmarkInstallmentPaid(id, loan.id);
      if (res.ok) {
        toast.success("ההחזר הוחזר לתוכנית כתשלום מתוכנן.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <AdaptiveGrid variant="customerStats">
        <StatBox label="סכום ההלוואה" value={formatIls(loan.amount)} />
        <StatBox label="נפרע (קרן)" value={formatIls(loan.repaidPrincipal)} />
        <StatBox
          label="יתרה"
          value={formatIls(loan.outstanding)}
          tone={loan.direction === "taken" ? "debt" : "asset"}
        />
      </AdaptiveGrid>

      <InstallmentPlanSection loan={loan} />

      <div className="space-y-2">
        <div className="text-sm font-semibold">היסטוריית החזרים ששולמו</div>
        {loan.paidRepayments.length === 0 ? (
          <div className="text-sm text-muted-foreground">עדיין לא נרשמו החזרים.</div>
        ) : (
          loan.paidRepayments
            .slice()
            .sort((a, b) => b.repayment_date.localeCompare(a.repayment_date))
            .map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span dir="ltr" className="font-medium tabular-nums">
                    {formatDate(r.repayment_date)}
                  </span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {formatIls(r.amount)}
                    {r.interest_amount > 0 ? ` (מתוכו ריבית ${formatIls(r.interest_amount)})` : ""}
                    {r.installment_index && r.installment_count
                      ? ` · תשלום ${r.installment_index} מתוך ${r.installment_count}`
                      : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <EditButton onClick={() => setEditTarget(r)} disabled={pending} label="עריכת החזר" />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => revertRepayment(r.id)}
                    disabled={pending}
                    aria-label="החזר לתשלום מתוכנן"
                    title="סומן בטעות? החזר אותו לתוכנית כתשלום מתוכנן"
                  >
                    <UndoIcon className="h-4 w-4" />
                  </Button>
                  <DeleteButton
                    onClick={() => removeRepayment(r.id)}
                    disabled={pending}
                    label="מחיקת החזר"
                  />
                </div>
              </div>
            ))
        )}
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={() => setAdHocOpen(true)}>
          רישום החזר
        </Button>
      </div>

      <FormDialog
        open={adHocOpen}
        onOpenChange={setAdHocOpen}
        title="רישום החזר שלא נקבע מראש"
        size="formLg"
        onSubmit={add}
        submitLabel="הוסף החזר"
        busyLabel="רושם..."
        busy={pending}
        showCancel
      >
        <div className="space-y-2">
          <AdaptiveGrid variant="formTwo">
            <Field label="תאריך">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="סכום">
              <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="מתוכו ריבית (אם יש)">
              <CurrencyInput value={interest} onChange={(e) => setInterest(e.target.value)} />
            </Field>
            <Field label="אופן">
              <NativeSelect
                value={method}
                onChange={(e) => {
                  const m = e.target.value;
                  setMethod(m);
                  setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                }}
              >
                {METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <AccountSelect
              required
              value={accountId}
              onChange={setAccountId}
              onLoaded={(list) => {
                setAccountsList(list);
                setAccountId((prev) => prev || defaultAccountForMethod(list, method));
              }}
            />
          </AdaptiveGrid>
          <Input
            placeholder="הערה (לא חובה)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </FormDialog>

      <EditPaidRepaymentDialog
        loan={loan}
        repayment={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />
    </div>
  );
}

// ── Edit an already-paid repayment ─────────────────────────────────────────
function EditPaidRepaymentDialog({
  loan,
  repayment,
  onOpenChange,
}: {
  loan: Loan;
  repayment: LoanRepayment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [form, setForm] = useState({ date: "", amount: "", interest: "", method: "", accountId: "", notes: "" });

  // Re-seed the form each time the dialog opens for a different repayment.
  const [seedKey, setSeedKey] = useState("");
  const key = repayment?.id ?? "";
  if (key && key !== seedKey) {
    setSeedKey(key);
    setForm({
      date: repayment?.repayment_date ?? "",
      amount: String(repayment?.amount ?? ""),
      interest: repayment?.interest_amount ? String(repayment.interest_amount) : "",
      method: repayment?.method ?? "",
      accountId: repayment?.account_id ?? "",
      notes: repayment?.notes ?? "",
    });
  }

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function submit() {
    if (!repayment) return;
    const amount = Number(form.amount) || 0;
    if (!form.date) {
      toast.error("חובה לבחור תאריך.");
      return;
    }
    if (!(amount > 0)) {
      toast.error("חובה להזין סכום.");
      return;
    }
    if (accountsList.length > 0 && !form.accountId) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    startTransition(async () => {
      const res = await updateRepayment(repayment.id, loan.id, {
        repayment_date: form.date,
        amount,
        interest_amount: Number(form.interest) || 0,
        method: form.method,
        account_id: form.accountId || null,
        notes: form.notes,
      });
      if (res.ok) {
        toast.success("ההחזר עודכן.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <FormDialog
      open={Boolean(repayment)}
      onOpenChange={onOpenChange}
      title="עריכת החזר"
      size="formMd"
      onSubmit={submit}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={pending}
    >
        <div className="space-y-3">
          <AdaptiveGrid variant="formTwo">
            <Field label="תאריך">
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="סכום">
              <CurrencyInput value={form.amount} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field label="מתוכו ריבית (אם יש)">
              <CurrencyInput value={form.interest} onChange={(e) => set("interest", e.target.value)} />
            </Field>
            <Field label="אופן">
              <NativeSelect
                value={form.method}
                onChange={(e) => {
                  const method = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    method,
                    accountId: prev.accountId || defaultAccountForMethod(accountsList, method),
                  }));
                }}
              >
                {METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <AccountSelect
              required
              value={form.accountId}
              onChange={(value) => set("accountId", value)}
              onLoaded={(list) => {
                setAccountsList(list);
                setForm((prev) => ({
                  ...prev,
                  accountId: prev.accountId || defaultAccountForMethod(list, prev.method),
                }));
              }}
            />
          </AdaptiveGrid>
          <Input
            placeholder="הערה (לא חובה)"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
    </FormDialog>
  );
}

// ── Repayment log dialog (list page) — same panel, in a modal ─────────────
export function RepaymentsDialog({
  loan,
  onOpenChange,
}: {
  loan: Loan | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ViewDialog
      open={Boolean(loan)}
      onOpenChange={onOpenChange}
      title="החזרים ותוכנית תשלומים"
      description={
        loan
          ? `${loan.direction === "taken" ? "החזר שלי למלווה" : "החזר מהלווה"} · יתרה לתשלום: ${formatIls(loan.outstanding)}`
          : undefined
      }
    >
      {loan ? <LoanRepaymentsPanel loan={loan} /> : null}
    </ViewDialog>
  );
}

// ── Documents dialog ───────────────────────────────────────────────────────
type LoanDoc = {
  id: string;
  fileName: string;
  documentType: string | null;
  uploadedAt: string | null;
  url: string | null;
};

export function LoanDocumentsDialog({
  loan,
  onOpenChange,
}: {
  loan: Loan | null;
  onOpenChange: (open: boolean) => void;
}) {
  const loanId = loan?.id ?? null;
  const [docs, setDocs] = useState<LoanDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadDocs = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/financial/loans/documents/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loan_id: id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; documents?: LoanDoc[] };
      if (res.ok) setDocs(json.documents ?? []);
      else setError(toHebrewError(json.error, "טעינת המסמכים נכשלה."));
    } catch (e) {
      setError(toHebrewError(e, "שגיאה בטעינת המסמכים."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loanId) {
      void loadDocs(loanId);
    } else {
      setDocs([]);
      setFiles([]);
      setError("");
    }
  }, [loanId, loadDocs]);

  async function upload() {
    if (!loanId || busy) return;
    if (files.length === 0) {
      setError("יש לבחור קובץ להעלאה.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let uploaded = 0;
      // uploaded + queued files are both "done" (removed from the pending list); a
      // queued upload was saved on the device and replays on reconnect
      // (ConnectionToasts announces it).
      let done = 0;
      for (const file of files) {
        const result = await offlineUpload("/api/financial/loans/documents/upload", {
          fields: { loan_id: loanId },
          file,
          label: file.name,
        });
        if (result.queued) {
          done += 1;
        } else if (result.ok) {
          uploaded += 1;
          done += 1;
        } else {
          setError(result.error || `העלאת ${file.name} נכשלה.`);
          break;
        }
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? "המסמך הועלה." : `${uploaded} מסמכים הועלו.`);
        await loadDocs(loanId);
      }
      setFiles(files.slice(done));
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc(id: string) {
    if (!loanId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/documents/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: id }),
      });
      if (res.ok) {
        toast.success("המסמך נמחק.");
        await loadDocs(loanId);
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(toHebrewError(json.error, "מחיקת המסמך נכשלה."));
      }
    } finally {
      setBusy(false);
    }
  }

  const counterparty = loan
    ? (loan.direction === "taken" ? loan.lender : loan.borrower)?.trim() || "הלוואה"
    : "";

  return (
    <ViewDialog
      open={Boolean(loan)}
      onOpenChange={onOpenChange}
      title="מסמכים"
      description={counterparty}
    >

        <div className="space-y-3">
          <FileUploadActions
            files={files}
            onFilesSelected={setFiles}
            multiple
            disabled={busy}
            chooseLabel="בחירת קבצים"
          />
          {files.length > 0 ? (
            <div className="flex justify-end">
              <Button type="button" onClick={() => void upload()} disabled={busy}>
                {busy ? "מעלה..." : "העלאה"}
              </Button>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="space-y-2">
            <div className="text-sm font-semibold">קבצים מצורפים</div>
            {loading ? (
              <div className="text-sm text-muted-foreground">טוען...</div>
            ) : docs.length === 0 ? (
              <div className="text-sm text-muted-foreground">אין מסמכים מצורפים עדיין.</div>
            ) : (
              docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <div className="min-w-0 truncate">
                    {doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        {doc.fileName}
                      </a>
                    ) : (
                      <span className="font-medium">{doc.fileName}</span>
                    )}
                    {doc.uploadedAt ? (
                      <span className="text-muted-foreground"> · {formatDate(doc.uploadedAt)}</span>
                    ) : null}
                  </div>
                  <DeleteButton
                    onClick={() => void removeDoc(doc.id)}
                    disabled={busy}
                    label="מחיקת מסמך"
                  />
                </div>
              ))
            )}
          </div>
        </div>
    </ViewDialog>
  );
}
