"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FormDialog } from "@/components/ui/form-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { buildRentSchedule, stepMonthly, type RentScheduleRow } from "@/lib/rentSchedule";
import { type LeaseAgreement, type PropertyPayment } from "@/lib/properties";
import { scheduleRentPayments } from "../actions";
import { DeleteButton } from "@/components/ui/icon-button";
import { dayKey } from "./propertyMovements";
import { israelDateKey } from "@/lib/timezone";

/** Rent can be paid any way — the check-only fields appear only for צ'ק. */
function isCheck(method: string) {
  return method === "check";
}

/**
 * Setting a lease's rent payments ahead of time (the checks a tenant hands
 * over for the year). The payments themselves are listed in the property's
 * money table, with its נפרע / עריכה / מחיקה — this is only the dialog that
 * makes them.
 */
export default function RentScheduleDialog({
  open,
  onOpenChange,
  propertyId,
  currentLease,
  payments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  currentLease: LeaseAgreement | null;
  /** The property's checks — the next schedule starts the month after the last one. */
  payments: PropertyPayment[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => { router.refresh(); });

  // payment_date is a timestamp: its day, not the raw value (that broke the next month).
  const lastScheduled = payments.reduce<string | null>((max, p) => {
    const day = dayKey(p.date);
    return day && (!max || day > max) ? day : max;
  }, null);
  const defaultFirstMonth = lastScheduled
    ? stepMonthly(lastScheduled, 1)
    : dayKey(currentLease?.startDate) ?? israelDateKey();

  const emptyForm = () => ({
    count: "12",
    firstMonth: defaultFirstMonth,
    monthlyAmount: currentLease ? String(currentLease.monthlyRentAmount) : "",
    paymentMethod: "check",
    startingCheckNumber: "",
    accountId: "",
  });
  const [genForm, setGenForm] = useState(emptyForm);
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [previewRows, setPreviewRows] = useState<RentScheduleRow[] | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const genIsCheck = isCheck(genForm.paymentMethod);

  // Each opening starts from this lease and the month after the last check.
  useEffect(() => {
    if (!open) return;
    setGenForm(emptyForm());
    setPreviewRows(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Switching the method re-points the batch at the account kind that method
   * lands in (cash → the cash box, transfer/check → the bank), and drops the
   * check numbers, which only describe a physical check book.
   */
  function pickMethod(method: string) {
    setGenForm((prev) => ({
      ...prev,
      paymentMethod: method,
      startingCheckNumber: isCheck(method) ? prev.startingCheckNumber : "",
      accountId: defaultAccountForMethod(accountsList, method) || prev.accountId,
    }));
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
        startingCheckNumber: genIsCheck ? genForm.startingCheckNumber : "",
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
        const result = await scheduleRentPayments(
          propertyId,
          previewRows,
          genForm.accountId,
          genForm.paymentMethod
        );
        if (result.ok) {
          toast.success(
            result.skipped > 0
              ? `נקבעו ${result.inserted} תשלומי שכירות (${result.skipped} חודשים דולגו — כבר נקבע להם תשלום).`
              : `נקבעו ${result.inserted} תשלומי שכירות.`
          );
          onOpenChange(false);
          refresh();
        } else {
          toast.error(result.error);
        }
      } finally {
        setGenBusy(false);
      }
    })();
  }

  return (
    <>
      {/* Generator dialog */}
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="קביעת תשלומי שכירות מראש"
        description="כל תשלום מציין את התאריך לפי חודש השכירות, ואת תאריך הפרעון לפי המועד שבו הכסף מתקבל בפועל."
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
                <span className="font-medium">אמצעי תשלום</span>
                <NativeSelect
                  value={genForm.paymentMethod}
                  onChange={(e) => pickMethod(e.target.value)}
                >
                  {PAYMENT_METHOD_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              {genIsCheck ? (
                <label className="space-y-1 text-sm">
                  <span className="font-medium">מספר צ&apos;ק ראשון (אופציונלי)</span>
                  <Input
                    value={genForm.startingCheckNumber}
                    onChange={(e) => setGenForm((prev) => ({ ...prev, startingCheckNumber: e.target.value }))}
                  />
                </label>
              ) : null}
              <div className="sm:col-span-2">
                <AccountSelect
                  required
                  value={genForm.accountId}
                  onChange={(value) => setGenForm((prev) => ({ ...prev, accountId: value }))}
                  onLoaded={(list) => {
                    setAccountsList(list);
                    setGenForm((prev) => ({
                      ...prev,
                      accountId: prev.accountId || defaultAccountForMethod(list, prev.paymentMethod),
                    }));
                  }}
                />
              </div>
              {accountsList.length === 0 ? null : null}
            </div>
          ) : (
            <div className="space-y-2">
              {/* The check-number column only exists for צ'ק — every other
                  method has nothing to number, so the grid drops to 3 fields. */}
              <div
                className={
                  "grid items-center gap-2 text-xs text-muted-foreground " +
                  (genIsCheck ? "grid-cols-[1fr_1fr_1fr_1fr_auto]" : "grid-cols-[1fr_1fr_1fr_auto]")
                }
              >
                <span>חודש</span>
                <span>תאריך פרעון</span>
                <span>סכום</span>
                {genIsCheck ? <span>מספר צ&apos;ק</span> : null}
                <span />
              </div>
              {previewRows.map((row, index) => (
                <div
                  key={index}
                  className={
                    "grid items-center gap-2 " +
                    (genIsCheck ? "grid-cols-[1fr_1fr_1fr_1fr_auto]" : "grid-cols-[1fr_1fr_1fr_auto]")
                  }
                >
                  <DateInput value={row.paymentDate} onChange={(e) => setPreviewRow(index, "paymentDate", e.target.value)} />
                  <DateInput value={row.dueDate} onChange={(e) => setPreviewRow(index, "dueDate", e.target.value)} />
                  <CurrencyInput value={String(row.amount)} onChange={(e) => setPreviewRow(index, "amount", e.target.value)} />
                  {genIsCheck ? (
                    <Input value={row.checkNumber} onChange={(e) => setPreviewRow(index, "checkNumber", e.target.value)} />
                  ) : null}
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

    </>
  );
}
