"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CoinsIcon, SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DeleteButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCurrency, formatDate, monthKeyFromDate, monthLabelFromKey, toNumber } from "@/lib/payroll";
import { toHebrewError } from "@/lib/error-messages";
import { itemMonthKey, type PayslipItemRow } from "@/lib/payroll-bonuses";

/**
 * "בונוסים" — the worker's own.
 *
 * He needs three things and nothing else: add one, see that it went in, and see
 * that it's counted in this month's total. There's no approval and no status
 * badge — it's a רכיב שכר the moment he saves it, exactly like one the boss types.
 *
 * The only state worth showing is whether the month has been closed into a payslip
 * yet, because that's when he can no longer take it back himself.
 */
export default function MyBonusCard({ bonuses }: { bonuses: PayslipItemRow[] }) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [busy, setBusy] = useState(false);
  // Behind a press: most visits here are to look at hours, and an always-open
  // form would push the list down.
  const [open, setOpen] = useState(false);
  const [bonusDate, setBonusDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const working = busy || saving;

  const currentMonthKey = monthKeyFromDate(new Date());
  // "What this adds to my pay this month" — the number he actually wants.
  const thisMonthTotal = useMemo(
    () =>
      bonuses
        .filter((bonus) => itemMonthKey(bonus) === currentMonthKey)
        .reduce((sum, bonus) => sum + toNumber(bonus.amount), 0),
    [bonuses, currentMonthKey]
  );

  async function submit() {
    const parsedAmount = Number(amount);
    if (!bonusDate) {
      toast.error("יש לבחור תאריך.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error("יש להזין סכום בונוס חיובי.");
      return;
    }
    if (!notes.trim()) {
      toast.error("יש לכתוב על מה הבונוס.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/payroll/bonuses/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bonus_date: bonusDate, amount: parsedAmount, notes: notes.trim() }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(toHebrewError(json.error ?? "", "השמירה נכשלה."));
        return;
      }
      setAmount("");
      setNotes("");
      setBonusDate(new Date().toISOString().slice(0, 10));
      setOpen(false);
      toast.success("הבונוס נוסף לשכר של החודש.");
      startSaving(() => router.refresh());
    } catch (error: unknown) {
      toast.error(toHebrewError(error, "אין חיבור לשרת."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(itemId: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/payroll/bonuses/my", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(toHebrewError(json.error ?? "", "המחיקה נכשלה."));
        return;
      }
      setPendingDeleteId(null);
      toast.success("הבונוס נמחק.");
      startSaving(() => router.refresh());
    } catch (error: unknown) {
      toast.error(toHebrewError(error, "אין חיבור לשרת."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-right" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-base font-semibold">
            <CoinsIcon className="h-5 w-5 shrink-0" />
            <span className="break-words">בונוסים</span>
          </div>
          {!open ? (
            <Button type="button" size="sm" disabled={working} onClick={() => setOpen(true)}>
              הוספת בונוס
            </Button>
          ) : null}
        </div>

        {thisMonthTotal > 0 ? (
          <div className="text-sm text-muted-foreground">
            {`נוסף לשכר של ${monthLabelFromKey(currentMonthKey)}: `}
            <span className="font-semibold text-foreground">{formatCurrency(thisMonthTotal)}</span>
          </div>
        ) : null}

        {open ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">על איזה יום</span>
                <DateInput
                  value={bonusDate}
                  onChange={(event) => setBonusDate(event.target.value)}
                  disabled={working}
                  aria-label="תאריך הבונוס"
                />
              </label>
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">סכום</span>
                <CurrencyInput
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={working}
                  aria-label="סכום הבונוס"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="block text-xs text-muted-foreground">על מה הבונוס</span>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={working}
                aria-label="על מה הבונוס"
              />
            </label>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={working} onClick={() => void submit()}>
                {working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
                שמירה
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={working}
                onClick={() => {
                  setOpen(false);
                  setAmount("");
                  setNotes("");
                }}
              >
                ביטול
              </Button>
            </div>
          </div>
        ) : null}

        {bonuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            עוד לא הוספת בונוס. בונוס שתוסיף נכנס לשכר של החודש שבו התאריך נמצא.
          </p>
        ) : (
          <div className="space-y-2">
            {bonuses.map((bonus) => (
              <div
                key={bonus.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{formatCurrency(bonus.amount)}</div>
                  <div className="text-xs text-muted-foreground">
                    {bonus.item_date ? formatDate(bonus.item_date) : ""}
                    {bonus.notes ? ` • ${bonus.notes}` : ""}
                  </div>
                </div>
                {/* Once the month is closed into a payslip it's payroll, and the
                    delete is the boss's. Saying so beats a button that fails. */}
                {bonus.payslip_id ? (
                  <span className="text-xs text-muted-foreground">נכנס לתלוש</span>
                ) : (
                  <DeleteButton
                    onClick={() => setPendingDeleteId(bonus.id)}
                    label="מחיקת הבונוס"
                    disabled={working}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <ConfirmDialog
          open={Boolean(pendingDeleteId)}
          onOpenChange={(next) => {
            if (!next) setPendingDeleteId(null);
          }}
          title="מחיקת בונוס"
          description="הבונוס יימחק ולא ייכנס לשכר."
          confirmLabel="מחיקה"
          loading={working}
          onConfirm={() => {
            if (pendingDeleteId) void remove(pendingDeleteId);
          }}
        />
      </CardContent>
    </Card>
  );
}
