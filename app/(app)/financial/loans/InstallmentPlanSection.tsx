"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import {
  buildInstallmentSchedule,
  type Loan,
  type LoanRepayment,
} from "@/lib/loans";
import {
  deleteRepayment,
  markInstallmentPaid,
  saveInstallmentPlan,
  updateInstallment,
} from "./actions";
import { Field, METHOD_OPTIONS, SELECT_CLASS, formatDate, formatIls, todayIso } from "./shared";

// ════════════════════════════════════════════════════════════════════════════
// תוכנית החזרים — split a loan into installments (5 × ₪20,000 on five dates),
// then tick them off one by one. A planned installment is a future obligation:
// it shows on the payments calendar and in the cash forecast, but only becomes
// real money — and only then lowers the outstanding balance — once it's paid.
// ════════════════════════════════════════════════════════════════════════════

type PlanRow = { date: string; amount: string };

const INTERVALS = [
  { value: "m1", label: "כל חודש" },
  { value: "m2", label: "כל חודשיים" },
  { value: "m3", label: "כל 3 חודשים" },
  { value: "m6", label: "כל חצי שנה" },
  { value: "m12", label: "כל שנה" },
  { value: "w1", label: "כל שבוע" },
  { value: "w2", label: "כל שבועיים" },
];

type BuilderState = { total: string; count: string; firstDate: string; interval: string };

function generateRows(state: BuilderState): PlanRow[] {
  const isWeeks = state.interval.startsWith("w");
  const step = Number(state.interval.slice(1)) || 1;
  return buildInstallmentSchedule({
    total: Number(state.total) || 0,
    count: Number(state.count) || 0,
    firstDate: state.firstDate,
    intervalMonths: isWeeks ? 1 : step,
    intervalDays: isWeeks ? step * 7 : 0,
  }).map((row) => ({ date: row.date, amount: String(row.amount) }));
}

function sumRows(rows: PlanRow[]) {
  return rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

export default function InstallmentPlanSection({ loan }: { loan: Loan }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = todayIso();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builder, setBuilder] = useState<BuilderState>(() => ({
    total: String(Math.round(loan.outstanding)),
    count: "3",
    firstDate: loan.due_date && loan.due_date >= today ? loan.due_date : today,
    interval: "m1",
  }));
  const [rows, setRows] = useState<PlanRow[]>([]);

  const [payTarget, setPayTarget] = useState<LoanRepayment | null>(null);
  const [editTarget, setEditTarget] = useState<LoanRepayment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LoanRepayment | null>(null);

  const planned = loan.plannedInstallments;
  const overdueCount = useMemo(
    () => planned.filter((i) => i.repayment_date < today).length,
    [planned, today]
  );
  const rowsTotal = sumRows(rows);
  const outstandingGap = Math.round(loan.outstanding - rowsTotal);

  function openBuilder() {
    const next: BuilderState = {
      total: String(Math.round(loan.outstanding)),
      count: builder.count,
      firstDate: loan.due_date && loan.due_date >= today ? loan.due_date : today,
      interval: builder.interval,
    };
    setBuilder(next);
    setRows(generateRows(next));
    setBuilderOpen(true);
  }

  // Every builder field regenerates the preview immediately — no effect needed.
  function setParam(key: keyof BuilderState, value: string) {
    const next = { ...builder, [key]: value };
    setBuilder(next);
    setRows(generateRows(next));
  }

  function setRowField(index: number, key: keyof PlanRow, value: string) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  function addRow() {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, { date: last?.date ?? builder.firstDate, amount: last?.amount ?? "" }];
    });
  }

  function savePlan() {
    const cleaned = rows.filter((row) => row.date && Number(row.amount) > 0);
    if (cleaned.length === 0) {
      toast.error("יש להזין לפחות תשלום אחד עם תאריך וסכום.");
      return;
    }
    startTransition(async () => {
      const res = await saveInstallmentPlan(
        loan.id,
        cleaned.map((row) => ({
          repayment_date: row.date,
          amount: Number(row.amount),
          interest_amount: 0,
          notes: "",
        })),
        true
      );
      if (res.ok) {
        toast.success("תוכנית ההחזרים נשמרה.");
        setBuilderOpen(false);
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
        toast.success("התשלום נמחק מהתוכנית.");
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
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" />
          תוכנית החזרים
          {planned.length > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">
              {planned.length} תשלומים · {formatIls(loan.scheduledTotal)}
            </span>
          ) : null}
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={openBuilder} disabled={pending}>
          {planned.length > 0 ? <RotateCcw className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {planned.length > 0 ? "בנה תוכנית מחדש" : "בנה תוכנית"}
        </Button>
      </div>

      {planned.length === 0 && !builderOpen ? (
        <div className="text-sm text-muted-foreground">
          אין עדיין תוכנית. אפשר לפרוס את היתרה ({formatIls(loan.outstanding)}) לתשלומים בתאריכים
          קבועים, ואז לסמן כל תשלום כשמשולם.
        </div>
      ) : null}

      {/* ── Plan builder ── */}
      {builderOpen ? (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <AdaptiveGrid variant="formTwo">
            <Field label="סכום לפריסה">
              <CurrencyInput
                value={builder.total}
                onChange={(e) => setParam("total", e.target.value)}
              />
            </Field>
            <Field label="מספר תשלומים">
              <Input
                inputMode="numeric"
                value={builder.count}
                onChange={(e) => setParam("count", e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <Field label="תאריך התשלום הראשון">
              <Input
                type="date"
                value={builder.firstDate}
                onChange={(e) => setParam("firstDate", e.target.value)}
              />
            </Field>
            <Field label="כל כמה זמן">
              <select
                className={SELECT_CLASS}
                value={builder.interval}
                onChange={(e) => setParam("interval", e.target.value)}
              >
                {INTERVALS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </AdaptiveGrid>

          <div className="space-y-2">
            <div className="text-sm font-medium">התשלומים (ניתן לשנות כל תאריך וסכום)</div>
            {rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                יש להזין סכום ומספר תשלומים כדי לראות את הפריסה.
              </div>
            ) : (
              rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <span className="min-w-[5.5rem] pb-3 text-xs text-muted-foreground">
                    תשלום {index + 1}
                  </span>
                  <div className="min-w-[9rem] flex-1">
                    <Input
                      type="date"
                      value={row.date}
                      onChange={(e) => setRowField(index, "date", e.target.value)}
                    />
                  </div>
                  <div className="min-w-[8rem] flex-1">
                    <CurrencyInput
                      value={row.amount}
                      onChange={(e) => setRowField(index, "amount", e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive-outline"
                    size="icon-sm"
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="הסר תשלום"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
            <Button type="button" variant="secondary" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4" />
              הוסף תשלום
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span>
              <span className="text-muted-foreground">סך התוכנית </span>
              <span className="font-semibold tabular-nums" dir="ltr">
                {formatIls(rowsTotal)}
              </span>
            </span>
            {Math.abs(outstandingGap) >= 1 ? (
              <span className={"rounded-md border px-2 py-0.5 text-xs " + getStatusColorClasses("warning")}>
                {outstandingGap > 0
                  ? `נשארו ${formatIls(outstandingGap)} ללא תשלום מתוכנן`
                  : `התוכנית גבוהה ב-${formatIls(Math.abs(outstandingGap))} מהיתרה`}
              </span>
            ) : (
              <span className={"rounded-md border px-2 py-0.5 text-xs " + getStatusColorClasses("success")}>
                מכסה את מלוא היתרה
              </span>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setBuilderOpen(false)}
              disabled={pending}
            >
              ביטול
            </Button>
            <Button type="button" onClick={savePlan} disabled={pending}>
              {pending ? "שומר..." : "שמור תוכנית"}
            </Button>
          </div>
          {planned.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              שמירה תחליף את התשלומים המתוכננים הקיימים. החזרים שכבר שולמו לא ישתנו.
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Planned installments ── */}
      {planned.length > 0 ? (
        <div className="space-y-2">
          {overdueCount > 0 ? (
            <div className={"rounded-md border px-3 py-2 text-sm " + getStatusColorClasses("danger")}>
              {overdueCount === 1
                ? "תשלום אחד עבר את תאריך היעד ועדיין לא סומן כשולם."
                : `${overdueCount} תשלומים עברו את תאריך היעד ועדיין לא סומנו כשולמו.`}
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
                    <span
                      className={
                        "rounded-md border px-2 py-0.5 text-xs " +
                        getStatusColorClasses(overdue ? "danger" : "warning")
                      }
                    >
                      {overdue ? "באיחור" : "מתוכנן"}
                    </span>
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
                    aria-label="מחק תשלום מהתוכנית"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
            <span>
              נותר בתוכנית{" "}
              <span className="font-semibold tabular-nums" dir="ltr">
                {formatIls(loan.scheduledTotal)}
              </span>
            </span>
            {loan.unscheduledPrincipal > 0.5 ? (
              <span>
                ללא תשלום מתוכנן{" "}
                <span className="font-semibold tabular-nums" dir="ltr">
                  {formatIls(loan.unscheduledPrincipal)}
                </span>
              </span>
            ) : null}
          </div>
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
        title="מחיקת תשלום מהתוכנית"
        description="התשלום המתוכנן יימחק. אפשר תמיד לבנות תוכנית מחדש."
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
        toast.success("התשלום סומן כשולם.");
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
          <DialogTitle>סימון תשלום כשולם</DialogTitle>
          <DialogDescription>
            {installment
              ? `תשלום מתוכנן ל-${formatDate(installment.repayment_date)} על ${formatIls(installment.amount)}. אפשר לשנות את הסכום והתאריך בפועל.`
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
              {pending ? "רושם..." : "סמן כשולם"}
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
          <DialogTitle>עריכת תשלום מתוכנן</DialogTitle>
          <DialogDescription>שינוי התאריך או הסכום של תשלום בתוכנית.</DialogDescription>
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
