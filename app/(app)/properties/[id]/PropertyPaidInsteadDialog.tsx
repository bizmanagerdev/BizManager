"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { FormDialog } from "@/components/ui/form-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { AddIcon, CloseIcon } from "@/components/ui/icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { loadAccounts } from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, getAccountKindLabel, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { LeaseAgreement, PropertyPayment } from "@/lib/properties";
import { rentCoverage } from "@/lib/property-rent";
import { formatCurrency } from "@/lib/payroll";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredEdit } from "@/lib/undo-engine";
import { israelDateKey } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { toRentPayment } from "./propertyMovements";

// A month paid another way than its check (owner, 2026-10-22: "if he paid a
// different way that month, then we rip up that check … mark it as ripped …
// so that if we ever want to bring it back, we could"): what came instead is
// recorded as that month's rent, and the check is torn — kept, greyed,
// counting nowhere (payments.check_torn_at, its status rejected), and it can
// be brought back. (The day before, the check moved on to the next month no
// payment covered; the owner: "it's wrong — the check just disappears".)
//
// What came instead can be several payments (owner, 2026-10-22: "1000 cash and
// a 1000 transfer and 1000 a transfer to another account"): a line each — how
// much, how, into which account, when. Less than the check: the check is torn
// all the same (a check can't be cashed for part of it), and the rest is owed.

/** Every way but a check (and a card, which a tenant's rent never comes by). */
const OTHER_METHODS = PAYMENT_METHOD_OPTIONS.filter((m) => m.value !== "check" && m.value !== "credit_card");

type Line = { key: number; amount: string; method: string; accountId: string; date: string };

/** One line's columns: amount, how, account, date, its ×. On a phone each line is a small card of two rows. */
const LINE_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.3fr)_8.5rem_2.25rem] sm:items-center";
const FIELD_LABEL = "mb-1 block text-xs text-muted-foreground sm:sr-only";

const methodLabel = (method: string) => OTHER_METHODS.find((m) => m.value === method)?.label ?? "תשלום";
const amountOf = (line: Line) => Number(line.amount) || 0;

/** Each line its own key, for React: removing one keeps the others' typing where it was. */
let lineKeys = 0;

export default function PropertyPaidInsteadDialog({
  check,
  lease,
  propertyId,
  title,
  onClose,
  onRecorded,
}: {
  /** The check; null keeps the dialog closed. */
  check: PropertyPayment | null;
  /** Its lease: whose month this is. */
  lease: LeaseAgreement | null;
  propertyId: string;
  /** What it's for ("שכירות כסלו תשפ״ז"). */
  title: string;
  onClose: () => void;
  /**
   * Each payment as it will be recorded (id "instead:<check id>#<n>") — the
   * rent roll shows the month paid at once, while the check's tearing can
   * still be undone.
   */
  onRecorded?: (payment: PropertyPayment) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const firstLine = (amount: number, list: Account[]): Line => ({
    key: ++lineKeys,
    amount: amount > 0 ? String(Math.round(amount)) : "",
    method: "bank_transfer",
    accountId: defaultAccountForMethod(list, "bank_transfer"),
    date: israelDateKey(),
  });
  const [lines, setLines] = useState<Line[]>(() => [firstLine(check?.amount ?? 0, [])]);
  const [linesFor, setLinesFor] = useState<PropertyPayment | null>(check);
  if (check !== linesFor) {
    setLinesFor(check);
    setLines([firstLine(check?.amount ?? 0, accounts)]);
  }

  useEffect(() => {
    let active = true;
    void loadAccounts().then((list) => {
      if (!active) return;
      setAccounts(list);
      setLines((prev) => prev.map((l) => (l.accountId ? l : { ...l, accountId: defaultAccountForMethod(list, l.method) })));
    });
    return () => {
      active = false;
    };
  }, []);

  // The check's month(s): what the payments that came instead pay.
  const cover = useMemo(() => (check && lease ? rentCoverage(lease, toRentPayment(check)) : null), [check, lease]);

  const expected = check?.amount ?? 0;
  const total = lines.reduce((sum, l) => sum + amountOf(l), 0);
  const missing = expected - total;

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  function pickMethod(key: number, method: string) {
    setLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, method, accountId: defaultAccountForMethod(accounts, method) || l.accountId } : l,
      ),
    );
  }
  /** Another payment: for what's still missing, the way the one before it came. */
  function addLine() {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          ...firstLine(missing, accounts),
          method: last?.method ?? "bank_transfer",
          accountId: last ? defaultAccountForMethod(accounts, last.method) : "",
          date: last?.date ?? israelDateKey(),
        },
      ];
    });
  }
  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  const checkName = check?.checkNumber ? `צ׳ק #${check.checkNumber}` : "הצ׳ק";

  function submit() {
    if (!check || !lease || !cover) return;
    if (lines.some((l) => !(amountOf(l) > 0))) {
      toast.error("יש לרשום סכום לכל תשלום.");
      return;
    }
    if (lines.some((l) => !l.date)) {
      toast.error("יש לבחור תאריך לכל תשלום.");
      return;
    }
    if (accounts.length > 0 && lines.some((l) => !l.accountId)) {
      toast.error("יש לבחור חשבון לכל תשלום.");
      return;
    }
    if (missing < -0.5) {
      toast.error(`סכום התשלומים גבוה מ${checkName} (${formatCurrency(expected)}).`);
      return;
    }
    const saved = lines;
    const short = missing > 0.5 ? missing : 0;
    const tornAt = new Date().toISOString();
    onClose();
    saved.forEach((line, i) =>
      onRecorded?.({
        ...check,
        id: `instead:${check.id}#${i}`,
        date: line.date,
        amount: amountOf(line),
        method: line.method,
        dueDate: null,
        checkNumber: null,
        paymentStatus: "cleared",
        tornAt: null,
        accountId: line.accountId || null,
        notes: null,
        referenceNumber: null,
        createdAt: tornAt,
        leaseId: lease.id,
        rentPeriodStart: cover.start,
        rentPeriods: cover.periods,
        countsAsRent: true,
        attachments: [],
      }),
    );
    const recorded = saved.length === 1 ? `נרשם: שולם ב${methodLabel(saved[0].method)}.` : `נרשמו ${saved.length} תשלומים.`;
    scheduleDeferredEdit({
      scope: "property-payment",
      id: check.id,
      message: `${recorded} ${checkName} נקרע.${short ? ` חסר ${formatCurrency(short)}.` : ""}`,
      // The check, at once, torn.
      patch: { paymentStatus: "rejected", tornAt },
      onCommit: async () => {
        // The month's rent, as it really came — a payment each …
        for (const [i, line] of saved.entries()) {
          const created = await fetch("/api/payments/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              business_domain: "property_management",
              property_id: propertyId,
              payment_date: line.date,
              amount_total: amountOf(line),
              payment_method: line.method,
              reference_number: "",
              notes: "",
              account_id: line.accountId || null,
              requires_split: false,
              lease_id: lease.id,
              rent_period_start: cover.start,
              rent_periods: cover.periods,
              counts_as_rent: true,
            }),
          });
          const createdJson = await created.json().catch(() => ({}));
          if (!created.ok) {
            if (i > 0) startTransition(() => router.refresh());
            const done = i > 0 ? `נרשמו ${i} מתוך ${saved.length} תשלומים, ו${checkName} לא נקרע. ` : "";
            return { ok: false, error: done + toHebrewError(createdJson?.error, "רישום התשלום נכשל.") };
          }
        }
        // … and the check, torn: kept, counting nowhere, and it can be brought back.
        const torn = await fetch("/api/payments/mark-collected", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: check.id, torn: true }),
        });
        const tornJson = await torn.json().catch(() => ({}));
        if (!torn.ok) {
          startTransition(() => router.refresh());
          return { ok: false, error: toHebrewError(tornJson?.error, "התשלומים נרשמו, אבל סימון הצ׳ק כנקרע נכשל.") };
        }
        startTransition(() => router.refresh());
        return { ok: true };
      },
    });
  }

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name, hint: getAccountKindLabel(a.kind) }));

  return (
    <FormDialog
      open={Boolean(check)}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="שולם אחרת החודש"
      description={check ? `${title} · ${formatCurrency(check.amount)}` : undefined}
      size="form2xl"
      onSubmit={submit}
      submitLabel="שמירה"
    >
      <div className="mt-4 space-y-3">
        <div className="space-y-2">
          <div className={cn(LINE_GRID, "hidden text-xs text-muted-foreground sm:grid")} aria-hidden>
            <span>סכום</span>
            <span>איך שולם</span>
            <span>חשבון</span>
            <span>תאריך</span>
            <span />
          </div>
          {lines.map((line, i) => (
            <div
              key={line.key}
              className={cn(LINE_GRID, "rounded-xl border border-border/60 p-2 sm:rounded-none sm:border-0 sm:p-0")}
              role="group"
              aria-label={`תשלום ${i + 1}`}
            >
              <label className="min-w-0">
                <span className={FIELD_LABEL}>סכום</span>
                <CurrencyInput
                  aria-label="סכום"
                  value={line.amount}
                  onChange={(e) => setLine(line.key, { amount: e.target.value })}
                />
              </label>
              <label className="min-w-0">
                <span className={FIELD_LABEL}>איך שולם</span>
                <NativeSelect aria-label="איך שולם" value={line.method} onChange={(e) => pickMethod(line.key, e.target.value)}>
                  {OTHER_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <div className="min-w-0">
                {accounts.length > 0 ? (
                  <>
                    <span className={FIELD_LABEL}>חשבון</span>
                    <SearchableSelect
                      ariaLabel="חשבון"
                      value={line.accountId}
                      onChange={(value) => setLine(line.key, { accountId: value })}
                      placeholder=""
                      options={accountOptions}
                    />
                  </>
                ) : null}
              </div>
              <label className="min-w-0">
                <span className={FIELD_LABEL}>תאריך</span>
                <DateInput aria-label="תאריך" value={line.date} onChange={(e) => setLine(line.key, { date: e.target.value })} />
              </label>
              <div className="col-span-2 flex justify-end sm:col-span-1">
                {lines.length > 1 ? (
                  <IconButton icon={CloseIcon} label="הסרת התשלום" variant="ghost" onClick={() => removeLine(line.key)} />
                ) : null}
              </div>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-secondary" onClick={addLine}>
            <AddIcon className="h-4 w-4" />
            עוד תשלום
          </Button>
        </div>
        <p className="text-sm">
          סה״כ <span className="font-semibold tabular-nums">{formatCurrency(total)}</span> מתוך{" "}
          <span className="tabular-nums">{formatCurrency(expected)}</span>
          {missing > 0.5 ? (
            <span className="font-medium text-warning-strong"> · חסר {formatCurrency(missing)}</span>
          ) : missing < -0.5 ? (
            <span className="font-medium text-destructive"> · יותר ב־{formatCurrency(-missing)}</span>
          ) : null}
        </p>
        {check ? (
          <p className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
            <span className="font-semibold">{checkName}</span> נקרע — לא ייפרע ולא נספר בשום מקום. אפשר לשחזר אותו אם צריך.
            {missing > 0.5 ? ` החסר (${formatCurrency(missing)}) יישאר חוב של החודש.` : ""}
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
