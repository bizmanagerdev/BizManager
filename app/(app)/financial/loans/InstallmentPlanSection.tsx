"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, CheckIcon, CloseIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { FormDialog } from "@/components/ui/form-dialog";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { type Loan, type LoanRepayment } from "@/lib/loans";
import { deleteRepayment, markInstallmentPaid, saveInstallmentPlan, updateInstallment } from "./actions";
import RepaymentPlanPicker, {
  planRows,
  planStateFromInstallments,
  type RepaymentPlanState,
} from "./RepaymentPlanPicker";
import { Field, METHOD_OPTIONS, formatDate, formatIls, todayIso } from "./shared";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

// ════════════════════════════════════════════════════════════════════════════
// The repayment schedule of one loan, inside the החזרים dialog: the list of
// payments still due (each with שולם / edit / delete) plus the same one-payment /
// several-payments picker used on the loan form.
// ════════════════════════════════════════════════════════════════════════════

export default function InstallmentPlanSection({ loan }: { loan: Loan }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = todayIso();

  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<RepaymentPlanState>(() =>
    planStateFromInstallments(loan.plannedInstallments, {
      amount: loan.outstanding,
      dueDate: loan.due_date,
    })
  );

  const [payTarget, setPayTarget] = useState<LoanRepayment | null>(null);
  const [editTarget, setEditTarget] = useState<LoanRepayment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LoanRepayment | null>(null);

  const planned = loan.plannedInstallments;
  const overdueCount = planned.filter((i) => i.repayment_date < today).length;

  function openEditor() {
    setPlan(
      planStateFromInstallments(loan.plannedInstallments, {
        amount: loan.outstanding,
        dueDate: loan.due_date,
      })
    );
    setEditing(true);
  }

  function savePlan() {
    const rows = planRows(plan, loan.outstanding).filter(
      (row) => row.date && Number(row.amount) > 0
    );
    if (rows.length === 0) {
      toast.error("יש לבחור תאריך לכל תשלום.");
      return;
    }
    startTransition(async () => {
      const res = await saveInstallmentPlan(
        loan.id,
        rows.map((row) => ({
          repayment_date: row.date,
          amount: Number(row.amount),
          interest_amount: 0,
          notes: "",
        }))
      );
      if (res.ok) {
        toast.success("התשלומים נשמרו.");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function removeInstallment() {
    const target = deleteTarget;
    if (!target) return;
    startTransition(async () => {
      const res = await deleteRepayment(target.id, loan.id);
      if (res.ok) {
        toast.success("התשלום נמחק.");
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          תשלומים לתשלום
          {planned.length > 0 ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              — {planned.length} תשלומים, {formatIls(loan.scheduledTotal)}
            </span>
          ) : null}
        </div>
        {/* Changing an existing plan is an edit — the pencil, like everywhere.
            Creating the first one is a create, so it keeps its label. */}
        {editing ? null : planned.length > 0 ? (
          <EditButton onClick={openEditor} disabled={pending} label="שינוי התשלומים" />
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={openEditor} disabled={pending}>
            <AddIcon className="h-4 w-4" />
            קביעת תשלומים
          </Button>
        )}
      </div>

      {planned.length === 0 && !editing ? (
        <div className="text-sm text-muted-foreground">לא נקבעו תאריכי החזר.</div>
      ) : null}

      {planned.length > 0 ? (
        <div className="space-y-2">
          {overdueCount > 0 ? (
            <div className={"rounded-md border px-3 py-2 text-sm " + getStatusColorClasses("danger")}>
              {overdueCount === 1
                ? "תשלום אחד עבר את התאריך שנקבע."
                : `${overdueCount} תשלומים עברו את התאריך שנקבע.`}
            </div>
          ) : null}
          {planned.map((installment) => {
            const overdue = installment.repayment_date < today;
            return (
              <div
                key={installment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span dir="ltr" className="font-medium tabular-nums">
                      {formatDate(installment.repayment_date)}
                    </span>
                    <span className="font-semibold tabular-nums" dir="ltr">
                      {formatIls(installment.amount)}
                    </span>
                    {installment.installment_index && installment.installment_count ? (
                      <span className="text-xs text-muted-foreground">
                        תשלום {installment.installment_index} מתוך {installment.installment_count}
                      </span>
                    ) : null}
                    {overdue ? (
                      <span
                        className={"rounded-md border px-2 py-0.5 text-xs " + getStatusColorClasses("danger")}
                      >
                        באיחור
                      </span>
                    ) : null}
                  </div>
                  {installment.notes ? (
                    <div className="text-xs text-muted-foreground">{installment.notes}</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setPayTarget(installment)}
                    disabled={pending}
                  >
                    <CheckIcon className="h-4 w-4" />
                    שולם
                  </Button>
                  <EditButton onClick={() => setEditTarget(installment)} disabled={pending} label="ערוך תשלום" />
                  <DeleteButton
                    onClick={() => setDeleteTarget(installment)}
                    disabled={pending}
                    label="מחיקת תשלום"
                  />
                </div>
              </div>
            );
          })}
          {loan.unscheduledPrincipal > 0.5 ? (
            <div className="px-1 text-xs text-muted-foreground">
              ללא תאריך:{" "}
              <span className="font-semibold tabular-nums" dir="ltr">
                {formatIls(loan.unscheduledPrincipal)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <FormDialog
        open={editing}
        onOpenChange={setEditing}
        title={planned.length > 0 ? "עריכת תשלומים" : "קביעת תשלומים"}
        description={
          planned.length > 0 ? "השמירה מחליפה את התשלומים שעדיין לא שולמו." : undefined
        }
        size="form2xl"
        onSubmit={savePlan}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={pending}
        showCancel
      >
        <RepaymentPlanPicker label="" state={plan} amount={loan.outstanding} onChange={setPlan} />
      </FormDialog>
      <MarkPaidDialog
        loan={loan}
        installment={payTarget}
        onOpenChange={(open) => !open && setPayTarget(null)}
      />
      <EditInstallmentDialog
        loan={loan}
        installment={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="מחיקת תשלום"
        description="התשלום המתוכנן יימחק."
        confirmLabel="מחיקה"
        destructive
        loading={pending}
        onConfirm={removeInstallment}
      />
    </div>
  );
}

// ── Mark a planned installment as actually paid ────────────────────────────
// One or more PARTS — e.g. ₪1,000 cash + ₪4,000 bank transfer settling one
// ₪5,000 due date in a single atomic action, so the split never touches the
// NEXT installment (which used to be the only way to log a second amount).
type PaymentPart = {
  date: string;
  amount: string;
  interest: string;
  method: string;
  accountId: string;
  notes: string;
};

function makePaymentPart(
  dueDate: string | undefined,
  seed?: Partial<Pick<PaymentPart, "amount" | "interest" | "method" | "accountId" | "notes">>
): PaymentPart {
  return {
    // Defaults to the installment's OWN due date, not today — a backdated
    // payment stays backdated unless the user actively changes it.
    date: dueDate || todayIso(),
    amount: seed?.amount ?? "",
    interest: seed?.interest ?? "",
    method: seed?.method ?? "",
    accountId: seed?.accountId ?? "",
    notes: seed?.notes ?? "",
  };
}

function MarkPaidDialog({
  loan,
  installment,
  onOpenChange,
}: {
  loan: Loan;
  installment: LoanRepayment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  function firstPart(target: LoanRepayment | null) {
    return makePaymentPart(target?.repayment_date, {
      amount: String(target?.amount ?? ""),
      interest: target?.interest_amount ? String(target.interest_amount) : "",
      method: target?.method ?? loan.repayment_method ?? "",
      accountId: target?.account_id ?? loan.account_id ?? "",
      notes: target?.notes ?? "",
    });
  }
  const [parts, setParts] = useState<PaymentPart[]>(() => [firstPart(installment)]);

  // Re-seed the form each time the dialog opens for a different installment.
  const [seedKey, setSeedKey] = useState("");
  const key = installment?.id ?? "";
  if (key && key !== seedKey) {
    setSeedKey(key);
    setParts([firstPart(installment)]);
  }

  // Parts are addressed by array index — they only ever get appended or removed
  // (never reordered), and every field is a fully controlled input, so an index
  // key is safe and avoids needing a ref-backed id generator during render.
  function setPart(index: number, patch: Partial<PaymentPart>) {
    setParts((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function addPart() {
    setParts((prev) => [...prev, makePaymentPart(installment?.repayment_date)]);
  }

  function removePart(index: number) {
    setParts((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const total = parts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  function submit() {
    if (!installment) return;
    for (const p of parts) {
      if (!p.date) {
        toast.error("חובה לבחור תאריך לכל תשלום.");
        return;
      }
      if (!(Number(p.amount) > 0)) {
        toast.error("חובה להזין סכום לכל תשלום.");
        return;
      }
    }
    if (accountsList.length > 0 && parts.some((p) => !p.accountId)) {
      toast.error("יש לבחור חשבון לכל תשלום.");
      return;
    }
    startTransition(async () => {
      const res = await markInstallmentPaid(
        installment.id,
        loan.id,
        parts.map((p) => ({
          repayment_date: p.date,
          amount: Number(p.amount) || 0,
          interest_amount: Number(p.interest) || 0,
          method: p.method,
          account_id: p.accountId || null,
          notes: p.notes,
        }))
      );
      if (res.ok) {
        toast.success(parts.length > 1 ? "התשלומים נרשמו." : "התשלום נרשם.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <FormDialog
      open={Boolean(installment)}
      onOpenChange={onOpenChange}
      title="רישום תשלום"
      description={
        installment
          ? `תשלום שנקבע ל-${formatDate(installment.repayment_date)} על ${formatIls(installment.amount)}. אפשר לשנות סכום ותאריך, ואם שולם בכמה אמצעים — לפצל לכמה תשלומים.`
          : undefined
      }
      onSubmit={submit}
      submitLabel="רישום התשלום"
      busyLabel="רושם..."
      busy={pending}
    >

        <div className="space-y-3">
          {parts.map((part, index) => (
            <div key={index} className="space-y-2 rounded-md border bg-muted/10 p-3">
              {parts.length > 1 ? (
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-muted-foreground">תשלום {index + 1}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removePart(index)}
                    aria-label="הסרת תשלום"
                    title="הסרת תשלום"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
              <AdaptiveGrid variant="formTwo">
                <Field label="תאריך בפועל">
                  <Input type="date" value={part.date} onChange={(e) => setPart(index, { date: e.target.value })} />
                </Field>
                <Field label="סכום ששולם">
                  <CurrencyInput value={part.amount} onChange={(e) => setPart(index, { amount: e.target.value })} />
                </Field>
                <Field label="מתוכו ריבית (אם יש)">
                  <CurrencyInput
                    value={part.interest}
                    onChange={(e) => setPart(index, { interest: e.target.value })}
                  />
                </Field>
                <Field label="אופן">
                  <NativeSelect
                    value={part.method}
                    onChange={(e) => {
                      const method = e.target.value;
                      setPart(index, {
                        method,
                        accountId: part.accountId || defaultAccountForMethod(accountsList, method),
                      });
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
                  value={part.accountId}
                  onChange={(value) => setPart(index, { accountId: value })}
                  onLoaded={(list) => {
                    setAccountsList(list);
                    setPart(index, { accountId: part.accountId || defaultAccountForMethod(list, part.method) });
                  }}
                />
              </AdaptiveGrid>
              <Input
                placeholder="הערה (לא חובה)"
                value={part.notes}
                onChange={(e) => setPart(index, { notes: e.target.value })}
              />
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={addPart}>
              <AddIcon className="h-4 w-4" />
              תשלום נוסף באמצעי אחר
            </Button>
            {parts.length > 1 ? (
              <div className="text-xs text-muted-foreground">
                סה&quot;כ {formatIls(total)} מתוך {formatIls(installment?.amount ?? 0)}
              </div>
            ) : null}
          </div>
        </div>
    </FormDialog>
  );
}

// ── Edit one planned installment ───────────────────────────────────────────
function EditInstallmentDialog({
  loan,
  installment,
  onOpenChange,
}: {
  loan: Loan;
  installment: LoanRepayment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ date: "", amount: "", interest: "", notes: "" });

  const [seedKey, setSeedKey] = useState("");
  const key = installment?.id ?? "";
  if (key && key !== seedKey) {
    setSeedKey(key);
    setForm({
      date: installment?.repayment_date ?? "",
      amount: String(installment?.amount ?? ""),
      interest: installment?.interest_amount ? String(installment.interest_amount) : "",
      notes: installment?.notes ?? "",
    });
  }

  function submit() {
    if (!installment) return;
    if (!form.date) {
      toast.error("חובה לבחור תאריך.");
      return;
    }
    if (!(Number(form.amount) > 0)) {
      toast.error("חובה להזין סכום.");
      return;
    }
    startTransition(async () => {
      const res = await updateInstallment(installment.id, loan.id, {
        repayment_date: form.date,
        amount: Number(form.amount),
        interest_amount: Number(form.interest) || 0,
        notes: form.notes,
      });
      if (res.ok) {
        toast.success("התשלום עודכן.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <FormDialog
      open={Boolean(installment)}
      onOpenChange={onOpenChange}
      title="עריכת תשלום"
      description="שינוי התאריך או הסכום של תשלום שטרם שולם."
      size="formMd"
      onSubmit={submit}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={pending}
    >

        <div className="space-y-3">
          <AdaptiveGrid variant="formTwo">
            <Field label="תאריך">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
              />
            </Field>
            <Field label="סכום">
              <CurrencyInput
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
              />
            </Field>
            <Field label="מתוכו ריבית (אם יש)">
              <CurrencyInput
                value={form.interest}
                onChange={(e) => setForm((prev) => ({ ...prev, interest: e.target.value }))}
              />
            </Field>
          </AdaptiveGrid>
          <Input
            placeholder="הערה (לא חובה)"
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </div>
    </FormDialog>
  );
}
