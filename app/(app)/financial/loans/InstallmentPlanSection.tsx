"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { type Loan, type LoanRepayment } from "@/lib/loans";
import { deleteRepayment, markInstallmentPaid, saveInstallmentPlan, updateInstallment } from "./actions";
import RepaymentPlanPicker, {
  planRows,
  planStateFromInstallments,
  type RepaymentPlanState,
} from "./RepaymentPlanPicker";
import { Field, METHOD_OPTIONS, SELECT_CLASS, formatDate, formatIls, todayIso } from "./shared";

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
        {!editing ? (
          <Button type="button" variant="secondary" size="sm" onClick={openEditor} disabled={pending}>
            <Pencil className="h-4 w-4" />
            {planned.length > 0 ? "שינוי התשלומים" : "קביעת תשלומים"}
          </Button>
        ) : null}
      </div>

      {planned.length === 0 && !editing ? (
        <div className="text-sm text-muted-foreground">לא נקבעו תאריכי החזר.</div>
      ) : null}

      {editing ? (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <RepaymentPlanPicker
            label=""
            state={plan}
            amount={loan.outstanding}
            onChange={setPlan}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              ביטול
            </Button>
            <Button type="button" onClick={savePlan} disabled={pending}>
              {pending ? "שומר..." : "שמירה"}
            </Button>
          </div>
          {planned.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              השמירה מחליפה את התשלומים שעדיין לא שולמו.
            </div>
          ) : null}
        </div>
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
                    <Check className="h-4 w-4" />
                    שולם
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => setEditTarget(installment)}
                    disabled={pending}
                    aria-label="ערוך תשלום"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive-outline"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(installment)}
                    disabled={pending}
                    aria-label="מחק תשלום"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
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
  const [form, setForm] = useState({
    date: todayIso(),
    amount: "",
    interest: "",
    method: "",
    accountId: "",
    notes: "",
  });

  // Re-seed the form each time the dialog opens for a different installment.
  const [seedKey, setSeedKey] = useState("");
  const key = installment?.id ?? "";
  if (key && key !== seedKey) {
    setSeedKey(key);
    setForm({
      date: todayIso(),
      amount: String(installment?.amount ?? ""),
      interest: installment?.interest_amount ? String(installment.interest_amount) : "",
      method: installment?.method ?? loan.repayment_method ?? "",
      accountId: installment?.account_id ?? loan.account_id ?? "",
      notes: installment?.notes ?? "",
    });
  }

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function submit() {
    if (!installment) return;
    const amount = Number(form.amount) || 0;
    if (!form.date) {
      toast.error("חובה לבחור תאריך תשלום.");
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
      const res = await markInstallmentPaid(installment.id, loan.id, {
        repayment_date: form.date,
        amount,
        interest_amount: Number(form.interest) || 0,
        method: form.method,
        account_id: form.accountId || null,
        notes: form.notes,
      });
      if (res.ok) {
        toast.success("התשלום נרשם.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={Boolean(installment)} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>רישום תשלום</DialogTitle>
          <DialogDescription>
            {installment
              ? `תשלום שנקבע ל-${formatDate(installment.repayment_date)} על ${formatIls(installment.amount)}. אפשר לשנות את הסכום והתאריך בפועל.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <AdaptiveGrid variant="formTwo">
            <Field label="תאריך בפועל">
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="סכום ששולם">
              <CurrencyInput value={form.amount} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field label="מתוכו ריבית (אם יש)">
              <CurrencyInput
                value={form.interest}
                onChange={(e) => set("interest", e.target.value)}
              />
            </Field>
            <Field label="אופן">
              <select
                className={SELECT_CLASS}
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
              </select>
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
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              ביטול
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? "רושם..." : "רישום התשלום"}
            </Button>
          </div>
        </div>
      </AdaptiveDialog>
    </Dialog>
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
    <Dialog open={Boolean(installment)} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="formMd">
        <DialogHeader>
          <DialogTitle>עריכת תשלום</DialogTitle>
          <DialogDescription>שינוי התאריך או הסכום של תשלום שטרם שולם.</DialogDescription>
        </DialogHeader>

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
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              ביטול
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </div>
      </AdaptiveDialog>
    </Dialog>
  );
}
