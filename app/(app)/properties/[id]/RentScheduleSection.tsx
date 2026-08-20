"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, CheckIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { formatCurrency } from "@/lib/payroll";
import { normalizeCheckStatus, checkStatusLabel, checkStatusClasses } from "@/lib/checks";
import { buildRentSchedule, stepMonthly, type RentScheduleRow } from "@/lib/rentSchedule";
import { type LeaseAgreement, type PropertyPayment } from "@/lib/properties";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleRentPayments } from "../actions";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

function monthLabel(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

type EditForm = { paymentDate: string; dueDate: string; amount: string; checkNumber: string };

export default function RentScheduleSection({
  propertyId,
  currentLease,
  payments,
  onDeleteRequest,
}: {
  propertyId: string;
  currentLease: LeaseAgreement | null;
  payments: PropertyPayment[];
  onDeleteRequest: (id: string, label: string) => void;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  const lastScheduled = payments.reduce<string | null>(
    (max, p) => (p.date && (!max || p.date > max) ? p.date : max),
    null
  );
  const defaultFirstMonth = lastScheduled
    ? stepMonthly(lastScheduled, 1)
    : currentLease?.startDate ?? new Date().toISOString().slice(0, 10);

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genForm, setGenForm] = useState({
    count: "12",
    firstMonth: defaultFirstMonth,
    monthlyAmount: currentLease ? String(currentLease.monthlyRentAmount) : "",
    startingCheckNumber: "",
    accountId: "",
  });
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [previewRows, setPreviewRows] = useState<RentScheduleRow[] | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  const [editTarget, setEditTarget] = useState<PropertyPayment | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ paymentDate: "", dueDate: "", amount: "", checkNumber: "" });
  const [editBusy, setEditBusy] = useState(false);

  const [clearingId, setClearingId] = useState<string | null>(null);

  function openGenerator() {
    setGenForm({
      count: "12",
      firstMonth: defaultFirstMonth,
      monthlyAmount: currentLease ? String(currentLease.monthlyRentAmount) : "",
      startingCheckNumber: "",
      accountId: "",
    });
    setPreviewRows(null);
    setGeneratorOpen(true);
  }

  function generatePreview() {
    const count = Number(genForm.count);
    const amount = Number(genForm.monthlyAmount);
    if (!genForm.firstMonth) {
      toast.error("יש לבחור חודש ראשון.");
      return;
    }
    if (!(count > 0)) {
      toast.error("יש להזין מספר תשלומים תקין.");
      return;
    }
    if (!(amount > 0)) {
      toast.error("יש להזין סכום חודשי תקין.");
      return;
    }
    setPreviewRows(
      buildRentSchedule({
        firstMonth: genForm.firstMonth,
        count,
        monthlyAmount: amount,
        startingCheckNumber: genForm.startingCheckNumber,
      })
    );
  }

  function setPreviewRow(index: number, key: keyof RentScheduleRow, value: string) {
    setPreviewRows((rows) =>
      (rows ?? []).map((row, i) =>
        i === index ? { ...row, [key]: key === "amount" ? Number(value) || 0 : value } : row
      )
    );
  }

  function saveSchedule() {
    if (!previewRows || previewRows.length === 0) return;
    if (!genForm.accountId) {
      toast.error("יש לבחור חשבון.");
      return;
    }
    setGenBusy(true);
    (async () => {
      try {
        const result = await scheduleRentPayments(propertyId, previewRows, genForm.accountId);
        if (result.ok) {
          toast.success(
            result.skipped > 0
              ? `נקבעו ${result.inserted} תשלומי שכירות (${result.skipped} חודשים דולגו — כבר נקבע להם תשלום).`
              : `נקבעו ${result.inserted} תשלומי שכירות.`
          );
          setGeneratorOpen(false);
          refresh();
        } else {
          toast.error(result.error);
        }
      } finally {
        setGenBusy(false);
      }
    })();
  }

  function openEdit(payment: PropertyPayment) {
    setEditTarget(payment);
    setEditForm({
      paymentDate: payment.date ?? "",
      dueDate: payment.dueDate ?? "",
      amount: String(payment.amount ?? ""),
      checkNumber: payment.checkNumber ?? "",
    });
  }

  function submitEdit() {
    if (!editTarget) return;
    if (!editForm.paymentDate || !editForm.dueDate) {
      toast.error("יש להזין תאריך לחודש ותאריך פרעון.");
      return;
    }
    if (!(Number(editForm.amount) > 0)) {
      toast.error("יש להזין סכום תקין.");
      return;
    }
    setEditBusy(true);
    (async () => {
      try {
        const res = await fetch("/api/payments/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: editTarget.id,
            business_domain: "property_management",
            payment_date: editForm.paymentDate,
            due_date: editForm.dueDate,
            amount_total: Number(editForm.amount),
            payment_method: "check",
            check_number: editForm.checkNumber || null,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error("שגיאה בעדכון התשלום", { description: toHebrewError(json?.error, "") });
          return;
        }
        toast.success("התשלום עודכן.");
        setEditTarget(null);
        refresh();
      } finally {
        setEditBusy(false);
      }
    })();
  }

  function toggleCleared(payment: PropertyPayment) {
    const collected = normalizeCheckStatus(payment.paymentStatus) !== "cleared";
    setClearingId(payment.id);
    (async () => {
      try {
        const res = await fetch("/api/payments/mark-collected", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: payment.id, collected }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error("שגיאה בעדכון הסטטוס", { description: toHebrewError(json?.error, "") });
          return;
        }
        toast.success(collected ? "התשלום סומן כנפרע." : "הסימון בוטל.");
        refresh();
      } finally {
        setClearingId(null);
      }
    })();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">תשלומי שכירות ({payments.length})</CardTitle>
        <Button size="sm" onClick={openGenerator} disabled={!currentLease}>
          <AddIcon className="h-4 w-4" />
          קביעת תשלומים מראש
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!currentLease ? (
          <p className="text-sm text-muted-foreground">אין חוזה שכירות פעיל — אי אפשר לקבוע תשלומים.</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">עדיין לא נקבעו תשלומי שכירות.</p>
        ) : (
          payments.map((p) => {
            const status = normalizeCheckStatus(p.paymentStatus);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{monthLabel(p.date)}</span>
                    <span className={"rounded-md border px-2 py-0.5 text-xs " + checkStatusClasses(status)}>
                      {checkStatusLabel(status)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[p.checkNumber ? `צ'ק #${p.checkNumber}` : null, `פרעון: ${fmtDate(p.dueDate)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="font-semibold">{formatCurrency(p.amount)}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={status === "cleared" ? "secondary" : "default"}
                    onClick={() => toggleCleared(p)}
                    disabled={clearingId === p.id}
                  >
                    <CheckIcon className="h-4 w-4" />
                    {status === "cleared" ? "בטל סימון" : "נפרע"}
                  </Button>
                  <EditButton onClick={() => openEdit(p)} label="עריכת תשלום" />
                  <DeleteButton onClick={() => onDeleteRequest(p.id, `תשלום שכירות (${monthLabel(p.date)})`)} label="מחיקת תשלום" />
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      {/* Generator dialog */}
      <FormDialog
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        title="קביעת תשלומי שכירות מראש"
        description="כל תשלום מציין את התאריך לפי חודש השכירות, ואת תאריך הפרעון לפי תאריך הצ'ק בפועל."
        size="form2xl"
        onSubmit={previewRows ? saveSchedule : generatePreview}
        submitLabel={previewRows ? "שמירה" : "תצוגה מקדימה"}
        busyLabel="שומר..."
        busy={genBusy}
      >
        <div className="mt-4 space-y-4">
          {!previewRows ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">מספר תשלומים</span>
                <Input
                  inputMode="numeric"
                  value={genForm.count}
                  onChange={(e) => setGenForm((prev) => ({ ...prev, count: e.target.value.replace(/[^\d]/g, "") }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">חודש ראשון</span>
                <DateInput
                  value={genForm.firstMonth}
                  onChange={(e) => setGenForm((prev) => ({ ...prev, firstMonth: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">סכום חודשי</span>
                <CurrencyInput
                  value={genForm.monthlyAmount}
                  onChange={(e) => setGenForm((prev) => ({ ...prev, monthlyAmount: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">מספר צ&apos;ק ראשון (אופציונלי)</span>
                <Input
                  value={genForm.startingCheckNumber}
                  onChange={(e) => setGenForm((prev) => ({ ...prev, startingCheckNumber: e.target.value }))}
                />
              </label>
              <div className="sm:col-span-2">
                <AccountSelect
                  required
                  value={genForm.accountId}
                  onChange={(value) => setGenForm((prev) => ({ ...prev, accountId: value }))}
                  onLoaded={(list) => {
                    setAccountsList(list);
                    setGenForm((prev) => ({ ...prev, accountId: prev.accountId || defaultAccountForMethod(list, "check") }));
                  }}
                />
              </div>
              {accountsList.length === 0 ? null : null}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2 text-xs text-muted-foreground">
                <span>חודש</span>
                <span>תאריך פרעון (צ&apos;ק)</span>
                <span>סכום</span>
                <span>מספר צ&apos;ק</span>
                <span />
              </div>
              {previewRows.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2">
                  <DateInput value={row.paymentDate} onChange={(e) => setPreviewRow(index, "paymentDate", e.target.value)} />
                  <DateInput value={row.dueDate} onChange={(e) => setPreviewRow(index, "dueDate", e.target.value)} />
                  <CurrencyInput value={String(row.amount)} onChange={(e) => setPreviewRow(index, "amount", e.target.value)} />
                  <Input value={row.checkNumber} onChange={(e) => setPreviewRow(index, "checkNumber", e.target.value)} />
                  <DeleteButton
                    onClick={() => setPreviewRows((rows) => (rows ?? []).filter((_, i) => i !== index))}
                    label="הסרת שורה"
                  />
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewRows(null)}>
                חזרה לעריכת הפרמטרים
              </Button>
            </div>
          )}
        </div>
      </FormDialog>

      {/* Edit one scheduled payment */}
      <FormDialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title="עריכת תשלום שכירות"
        size="formMd"
        onSubmit={submitEdit}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={editBusy}
      >
        <div className="mt-4 space-y-4">
          <label className="space-y-1 text-sm">
            <span className="font-medium">תאריך (לחודש השכירות)</span>
            <DateInput value={editForm.paymentDate} onChange={(e) => setEditForm((prev) => ({ ...prev, paymentDate: e.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">תאריך פרעון (צ&apos;ק)</span>
            <DateInput value={editForm.dueDate} onChange={(e) => setEditForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">סכום</span>
            <CurrencyInput value={editForm.amount} onChange={(e) => setEditForm((prev) => ({ ...prev, amount: e.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">מספר צ&apos;ק</span>
            <Input value={editForm.checkNumber} onChange={(e) => setEditForm((prev) => ({ ...prev, checkNumber: e.target.value }))} />
          </label>
        </div>
      </FormDialog>
    </Card>
  );
}
