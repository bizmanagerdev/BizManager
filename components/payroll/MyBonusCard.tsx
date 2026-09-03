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
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/types";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import { profileDict } from "@/lib/i18n/dictionaries/profile";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, registerReversibleCreate } from "@/lib/undo-engine";

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
export default function MyBonusCard({ bonuses: bonusesProp, locale = "he" }: { bonuses: PayslipItemRow[]; /** Office/admin are always "he"; only a worker ever sees "ar". */ locale?: Locale }) {
  const router = useRouter();
  const bonuses = useUndoOverlay(bonusesProp, (b) => b.id, "my-bonus");
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
      toast.error(t(profileDict, locale, "errSelectDate"));
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error(t(profileDict, locale, "errPositiveBonusAmount"));
      return;
    }
    if (!notes.trim()) {
      toast.error(t(profileDict, locale, "errBonusReasonRequired"));
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/payroll/bonuses/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bonus_date: bonusDate, amount: parsedAmount, notes: notes.trim() }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        item?: { id?: string };
      };
      if (!response.ok) {
        toast.error(toHebrewError(json.error ?? "", t(profileDict, locale, "saveFailedGeneric")));
        return;
      }
      setAmount("");
      setNotes("");
      setBonusDate(new Date().toISOString().slice(0, 10));
      setOpen(false);
      startSaving(() => router.refresh());
      const newId = json.item?.id;
      if (!newId) {
        // Defensive — the route always returns the inserted row on success.
        toast.success(t(profileDict, locale, "bonusAddedToast"));
        return;
      }
      registerReversibleCreate({
        scope: "my-bonus",
        id: newId,
        message: t(profileDict, locale, "bonusAddedToast"),
        onUndo: async () => {
          const res = await fetch("/api/payroll/bonuses/my", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_id: newId }),
          });
          const undoJson = (await res.json().catch(() => ({}))) as { error?: string };
          startSaving(() => router.refresh());
          if (!res.ok) {
            return { ok: false, error: toHebrewError(undoJson.error ?? "", t(profileDict, locale, "deleteFailedGeneric")) };
          }
          return { ok: true };
        },
      });
    } catch (error: unknown) {
      toast.error(toHebrewError(error, t(profileDict, locale, "noServerConnection")));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    if (!pendingDeleteId) return;
    const itemId = pendingDeleteId;
    setPendingDeleteId(null);
    scheduleDeferredDelete({
      scope: "my-bonus",
      id: itemId,
      message: t(profileDict, locale, "bonusDeletedToast"),
      onCommit: async () => {
        const response = await fetch("/api/payroll/bonuses/my", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: itemId }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          return { ok: false, error: toHebrewError(json.error ?? "", t(profileDict, locale, "deleteFailedGeneric")) };
        }
        startSaving(() => router.refresh());
        return { ok: true };
      },
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-right" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-base font-semibold">
            <CoinsIcon className="h-5 w-5 shrink-0" />
            <span className="break-words">{t(profileDict, locale, "bonusesTitle")}</span>
          </div>
          {!open ? (
            <Button type="button" size="sm" disabled={working} onClick={() => setOpen(true)}>
              {t(profileDict, locale, "addBonusLabel")}
            </Button>
          ) : null}
        </div>

        {thisMonthTotal > 0 ? (
          <div className="text-sm text-muted-foreground">
            {t(profileDict, locale, "addedToSalaryOfTemplate").replace("{month}", monthLabelFromKey(currentMonthKey, locale))}
            <span className="font-semibold text-foreground">{formatCurrency(thisMonthTotal)}</span>
          </div>
        ) : null}

        {open ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "whichDayLabel")}</span>
                <DateInput
                  value={bonusDate}
                  onChange={(event) => setBonusDate(event.target.value)}
                  disabled={working}
                  aria-label={t(profileDict, locale, "bonusDateAriaLabel")}
                />
              </label>
              <label className="block space-y-1">
                <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "amountLabel")}</span>
                <CurrencyInput
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={working}
                  aria-label={t(profileDict, locale, "bonusAmountAriaLabel")}
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "whatForLabel")}</span>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={working}
                aria-label={t(profileDict, locale, "whatForLabel")}
              />
            </label>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={working} onClick={() => void submit()}>
                {working ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : null}
                {t(commonDict, locale, "save")}
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
                {t(commonDict, locale, "cancel")}
              </Button>
            </div>
          </div>
        ) : null}

        {bonuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(profileDict, locale, "noBonusesYetHint")}
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
                  <span className="text-xs text-muted-foreground">{t(profileDict, locale, "includedInPayslipLabel")}</span>
                ) : (
                  <DeleteButton
                    onClick={() => setPendingDeleteId(bonus.id)}
                    label={t(profileDict, locale, "deleteBonusLabel")}
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
          title={t(profileDict, locale, "deleteBonusTitle")}
          description={t(profileDict, locale, "deleteBonusDescription")}
          confirmLabel={t(commonDict, locale, "delete")}
          onConfirm={confirmDelete}
        />
      </CardContent>
    </Card>
  );
}
