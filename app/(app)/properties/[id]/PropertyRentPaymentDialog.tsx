"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { LineAmountInput, lineShekels, type LineCurrency } from "@/components/fx/MoneyCurrency";
import { CURRENCY_SYMBOL, isForeignCurrency } from "@/lib/fx/currencies";
import { formatCurrencyAmount } from "@/lib/money";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { AddIcon, CloseIcon } from "@/components/ui/icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TOGGLE_ON, TOGGLE_ON_HOVER } from "@/components/ui/filter-chip";
import { loadAccounts } from "@/components/financial/AccountSelect";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { defaultAccountForMethod, getAccountKindLabel, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { offlineFetch } from "@/lib/offline-queue";
import { sendChange } from "@/lib/offline-send";
import { registerReversibleCreate } from "@/lib/undo-engine";
import { uploadTogether } from "@/lib/upload-together";
import { queueFinancialAttachmentsAfter } from "@/lib/payments/uploadCheckPhotos";
import { toHebrewError } from "@/lib/error-messages";
import { israelDateKey } from "@/lib/timezone";
import { formatCurrency } from "@/lib/payroll";
import { formatShortDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  allocateRent,
  nextUncoveredPeriod,
  paidTowards,
  rentPeriodsLabel,
  rentPeriodStatus,
  rentThisPeriod,
  type RentShare,
} from "@/lib/property-rent";
import { rentPeriodChoices, rentPeriodLabel, rentPeriodOf } from "@/lib/rent-periods";
import type { LeaseAgreement, PropertyPayment } from "@/lib/properties";
import { uploadFinancialAttachment } from "@/app/(app)/dashboard/DashboardActions.helpers";
import { toRentPayment } from "./propertyMovements";

// Recording a lease's rent (owner, 2026-10-20 — the ניהול נכסים card: "every
// rent payment says which month it covers"), by the lease's own calendar (א׳
// חשון, not 1 November, for a Hebrew lease). It goes up through the same route
// as every income, with its lease and the months it pays.
//
// The months are ticked one by one (owner, 2026-10-22: "what happens when a
// renter transfers money for a few months at once either ahead or back … I
// choose what months it will cover"): the money fills them oldest first, a
// month part-paid getting only what it's missing, so ₪10,000 for three months
// of ₪4,000 is ₪4,000, ₪4,000 and ₪2,000 short — saved with each payment
// (payments.rent_allocation). It can be several payments ("1000 cash and a
// 1000 transfer and 1000 a transfer to another account"), filling the months
// in turn. A ticked month whose check is still waiting: the check is torn (it
// can be brought back) — and if it's the check itself that came in, the
// dialog says so and leads to marking it cleared instead ("won't the user think
// just to press that instead of opening the row to mark the check deposited?").
//
// A payment can be in US$ or C$ (owner, 2026-10-25: "rent stays in shekels; a
// tenant can pay in dollars and the shekels come off the month"): the sign on
// its amount opens ₪ / $ / C$, and its shekels — at its day's Bank of Israel
// rate, or the rate typed — are what fill the months.

/** Where a new rent payment starts: a given month (the rent roll's row), paid the lease's usual way when that's known. */
export type RentPaymentPrefill = { periodStart?: string | null; method?: string | null; accountId?: string | null };

type Line = {
  key: number;
  amount: string;
  method: string;
  accountId: string;
  date: string;
  checkNumber: string;
  photos: File[];
  /** Its currency and rate, as its amount field tells them; absent: shekels. */
  currency?: LineCurrency;
};

/** A month the payment can be for: where it stands, and its checks still waiting. */
type Month = { period: string; label: string; rent: number; collected: number; pending: number; checks: PropertyPayment[] };

/** One line's columns: amount, how, account, date, its ×. On a phone each line is a small card of two rows. */
const LINE_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1.3fr)_8.5rem_2.25rem] sm:items-start";
const FIELD_LABEL = "mb-1 block text-xs text-muted-foreground sm:sr-only";
const YEAR = / (תש\S*|\d{4})$/;

/** Each line its own key, for React: removing one keeps the others' typing where it was. */
let lineKeys = 0;

const amountOf = (line: Line) => Number(line.amount) || 0;
/** What a line comes to in shekels — what fills the months (0 while a US$ / C$ line has no rate yet). */
const shekelsOf = (line: Line) => lineShekels(amountOf(line), line.currency);
const foreignLine = (line: Line) => Boolean(line.currency && isForeignCurrency(line.currency.currency));
/** Shekels the months still need, as an amount in the line's currency — rounded up a cent, so its shekels cover them. */
function inLineCurrency(need: number, currency: LineCurrency | undefined): string {
  if (!(need > 0)) return "";
  if (!currency || !isForeignCurrency(currency.currency)) return String(Math.round(need * 100) / 100);
  return currency.rate ? String(Math.ceil((need / currency.rate) * 100 - 1e-6) / 100) : "";
}
const checkName = (check: PropertyPayment) => (check.checkNumber ? `צ׳ק #${check.checkNumber}` : "הצ׳ק");

/** The months offered: three back (and any older one still owing) to a year ahead — and the one it opened on. */
function monthsOf(lease: LeaseAgreement, payments: PropertyPayment[], today: string, also: string | null): Month[] {
  const rent = payments.map(toRentPayment);
  const yearly = Number(lease.periodMonths) === 12;
  const periods = [
    ...new Set([...rentPeriodChoices(lease, today, yearly ? 2 : 12, yearly ? 2 : 12), ...(also ? [also] : [])]),
  ].sort();
  const at = periods.indexOf(rentPeriodOf(lease, today));
  const recent = at >= 0 ? periods[Math.max(0, at - (yearly ? 1 : 3))] : periods[0];
  return periods
    .map((period) => {
      const status = rentPeriodStatus(lease, rent, period, today);
      const checks = payments.filter(
        (p) => p.method === "check" && p.paymentStatus === "pending" && paidTowards(lease, toRentPayment(p), period) > 0
      );
      return {
        period,
        label: rentPeriodLabel(lease, period),
        rent: status.rent,
        collected: status.collected,
        pending: status.pending,
        checks,
      };
    })
    .filter((m) => m.period >= recent || m.period === also || (m.period < today && m.rent - m.collected - m.pending > 0.5));
}

/** What a month still needs from this payment: its rent less what's in — and less its checks that stay. */
function needOf(lease: LeaseAgreement, month: Month, torn: (check: PropertyPayment) => boolean): number {
  const kept = month.checks
    .filter((c) => !torn(c))
    .reduce((sum, c) => sum + paidTowards(lease, toRentPayment(c), month.period), 0);
  const other = month.pending - month.checks.reduce((sum, c) => sum + paidTowards(lease, toRentPayment(c), month.period), 0);
  return Math.max(0, Math.round((month.rent - month.collected - other - kept) * 100) / 100);
}

export default function PropertyRentPaymentDialog({
  open,
  onOpenChange,
  propertyId,
  lease,
  payments,
  prefill,
  onRecorded,
  onUndone,
  onCheckCleared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  lease: LeaseAgreement | null;
  /** The property's incomes: where this lease's rent stands. */
  payments: PropertyPayment[];
  /** The month it's for and the usual way it's paid (the rent roll's row). */
  prefill?: RentPaymentPrefill;
  /** Each payment as recorded — the rent roll shows its months paid at once, before the page reads it again. */
  onRecorded?: (payment: PropertyPayment) => void;
  /** It was undone (its "בטל"): gone again. */
  onUndone?: (paymentId: string) => void;
  /** A ticked month's waiting check was the money after all: mark it cleared instead (the dialog closes). */
  onCheckCleared?: (check: PropertyPayment) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(() => israelDateKey());
  const [ticked, setTicked] = useState<string[]>([]);
  // Checks of ticked months kept — every other one is torn.
  const [kept, setKept] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  // The one line's amount follows the months ticked until it's typed by hand.
  const [amountTouched, setAmountTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [openFor, setOpenFor] = useState(false);

  const newLine = (amount: number, method: string, accountId: string, date: string): Line => ({
    key: ++lineKeys,
    amount: amount > 0 ? String(Math.round(amount * 100) / 100) : "",
    method,
    accountId,
    date,
    checkNumber: "",
    photos: [],
  });

  // Each opening starts from where the rent stands now.
  if (open !== openFor) {
    setOpenFor(open);
    if (open && lease) {
      const day = israelDateKey();
      const rent = payments.map(toRentPayment);
      const status = prefill?.periodStart ? null : rentThisPeriod(lease, rent, day);
      // Not told which month: this one while it's unpaid; paid, or its check waiting, the next one nothing covers.
      let start =
        prefill?.periodStart ??
        (status && (status.state === "paid" || status.state === "check" || !status.periodStart)
          ? nextUncoveredPeriod(lease, rent, day)
          : (status?.periodStart ?? null));
      const months = monthsOf(lease, payments, day, start);
      let first = months.find((m) => m.period === start) ?? null;
      // A month already paid in full: the next one that isn't.
      if (first && needOf(lease, first, () => true) <= 0.5) {
        start = nextUncoveredPeriod(lease, rent, day);
        first = months.find((m) => m.period === start) ?? null;
      }
      // A month whose check is waiting: what comes instead is rarely another check.
      const usual = prefill?.method || "bank_transfer";
      const method = first && first.checks.length > 0 && usual === "check" ? "bank_transfer" : usual;
      setToday(day);
      setTicked(first ? [first.period] : []);
      setKept([]);
      setAmountTouched(false);
      setNotes("");
      setLines([
        newLine(
          first ? needOf(lease, first, () => true) : lease.monthlyRentAmount,
          method,
          (method === usual ? prefill?.accountId : "") || defaultAccountForMethod(accounts, method),
          day
        ),
      ]);
    }
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

  if (!lease) return null;
  const rentLease = lease;

  const months = monthsOf(rentLease, payments, today, ticked[0] ?? null);
  const torn = (check: PropertyPayment) => !kept.includes(check.id);
  const chosen = months.filter((m) => ticked.includes(m.period));
  const needs = chosen.map((m) => ({ period: m.period, need: needOf(rentLease, m, torn) }));
  const totalNeed = needs.reduce((sum, n) => sum + n.need, 0);
  // In shekels: a line in US$ / C$ fills the months with its shekels.
  const { shares, short, extra } = allocateRent(lines.map(shekelsOf), needs);
  const given = new Map<string, number>();
  for (const share of shares.flat()) given.set(share.period, (given.get(share.period) ?? 0) + share.amount);
  const total = lines.reduce((sum, l) => sum + shekelsOf(l), 0);
  // The waiting checks of the months ticked, each once.
  const waiting = [...new Map(chosen.flatMap((m) => m.checks).map((c) => [c.id, c])).values()];
  const tearing = waiting.filter(torn);
  // Those already due: maybe it's the check itself that came in.
  const deposited = waiting.filter((c) => (c.dueDate ?? c.date ?? "").slice(0, 10) <= today);

  /** The one line's amount, following the months while it isn't typed by hand. */
  function follow(nextTicked: string[], nextKept: string[]) {
    if (amountTouched || lines.length !== 1) return;
    const tornNext = (c: PropertyPayment) => !nextKept.includes(c.id);
    const need = months.filter((m) => nextTicked.includes(m.period)).reduce((sum, m) => sum + needOf(rentLease, m, tornNext), 0);
    setLines((prev) => prev.map((l, i) => (i === 0 ? { ...l, amount: inLineCurrency(need, l.currency) } : l)));
  }
  /** A line's currency (or its rate) as its field tells it; the one line not typed by hand follows it. */
  function setLineCurrency(key: number, currency: LineCurrency) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const sameMoney = l.currency?.currency === currency.currency && l.currency?.rate === currency.rate;
        if (sameMoney && JSON.stringify(l.currency?.body) === JSON.stringify(currency.body)) return l;
        const follows = !amountTouched && prev.length === 1 && !sameMoney;
        return { ...l, currency, ...(follows ? { amount: inLineCurrency(totalNeed, currency) } : {}) };
      })
    );
  }
  function toggleMonth(period: string) {
    const next = ticked.includes(period) ? ticked.filter((p) => p !== period) : [...ticked, period].sort();
    setTicked(next);
    follow(next, kept);
  }
  function toggleTear(check: PropertyPayment) {
    const next = kept.includes(check.id) ? kept.filter((id) => id !== check.id) : [...kept, check.id];
    setKept(next);
    follow(ticked, next);
  }
  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  function pickMethod(key: number, method: string) {
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              method,
              checkNumber: method === "check" ? l.checkNumber : "",
              accountId: defaultAccountForMethod(accounts, method) || l.accountId,
            }
          : l
      )
    );
  }
  /** Another payment: for what the months still lack (in shekels — its sign can change it), the way the one before it came. */
  function addLine() {
    const last = lines[lines.length - 1];
    const method = last?.method ?? "bank_transfer";
    setLines((prev) => [
      ...prev,
      newLine(totalNeed - total, method, defaultAccountForMethod(accounts, method), last?.date ?? today),
    ]);
  }
  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key));

  async function submit() {
    if (busy) return;
    if (chosen.length === 0) {
      toast.error("יש לסמן לפחות חודש אחד.");
      return;
    }
    if (lines.some((l) => !(amountOf(l) > 0))) {
      toast.error("יש לרשום סכום לכל תשלום.");
      return;
    }
    if (lines.some((l) => !l.date)) {
      toast.error(
        lines.some((l) => l.method === "check" && !l.date) ? "יש להזין תאריך פירעון לצ׳ק." : "יש לבחור תאריך לכל תשלום."
      );
      return;
    }
    if (accounts.length > 0 && lines.some((l) => !l.accountId)) {
      toast.error("יש לבחור חשבון לכל תשלום.");
      return;
    }
    if (lines.some((l) => foreignLine(l) && !l.currency?.rate)) {
      toast.error("יש להקליד את השער לתשלום במטבע זר.");
      return;
    }
    if (extra > 0.5) {
      toast.error(`הסכום גבוה ב־${formatCurrency(extra)} ממה שהחודשים שסומנו צריכים — אפשר לסמן עוד חודש.`);
      return;
    }
    const sent = lines;
    const sentShares = shares;
    const tear = tearing;
    const note = notes.trim();
    const paidFor = rentPeriodsLabel(rentLease, [...given.keys()]);
    setBusy(true);
    try {
      // A payment each, with the months it fills.
      const created: PropertyPayment[] = [];
      let failed: string | null = null;
      for (const [i, line] of sent.entries()) {
        const isCheck = line.method === "check";
        // In US$ / C$: the amount as typed, with its currency; the months get its shekels.
        const shekels = shekelsOf(line);
        // … all of them: the agorot its rate leaves over go to its last month (the
        // server wants the months to add up to the payment).
        const share: RentShare[] = sentShares[i].map((s) => ({ ...s }));
        const leftOver = Math.round((shekels - share.reduce((sum, s) => sum + s.amount, 0)) * 100) / 100;
        if (foreignLine(line) && share.length > 0 && leftOver > 0 && leftOver <= 0.05) {
          share[share.length - 1].amount = Math.round((share[share.length - 1].amount + leftOver) * 100) / 100;
        }
        const foreign =
          line.currency && isForeignCurrency(line.currency.currency) && line.currency.rate
            ? {
                currency: line.currency.currency,
                amount: amountOf(line),
                rate: line.currency.rate,
                rateManual: line.currency.body.fx_rate_manual === true,
              }
            : null;
        const result = await offlineFetch(
          "/api/payments/create",
          {
            business_domain: "property_management",
            property_id: propertyId,
            // A check: received today, due on its line's date.
            payment_date: isCheck ? today : line.date,
            due_date: isCheck ? line.date : null,
            amount_total: amountOf(line),
            ...(line.currency?.body ?? {}),
            payment_method: line.method,
            check_number: isCheck ? line.checkNumber.trim() : "",
            reference_number: "",
            notes: note,
            account_id: line.accountId || null,
            requires_split: false,
            lease_id: rentLease.id,
            rent_allocation: share,
            counts_as_rent: true,
          },
          "תשלום שכירות",
          { idempotent: true }
        );
        // As it went up — for a page to show at once (an id only once the server has it).
        const recorded = (id: string): PropertyPayment => ({
          id,
          date: isCheck ? today : line.date,
          amount: shekels,
          foreign,
          method: line.method,
          dueDate: isCheck ? line.date : null,
          checkNumber: isCheck ? line.checkNumber.trim() || null : null,
          paymentStatus: isCheck ? "pending" : "cleared",
          tornAt: null,
          accountId: line.accountId || null,
          notes: note || null,
          referenceNumber: null,
          requiresSplit: false,
          createdAt: new Date().toISOString(),
          leaseId: rentLease.id,
          rentPeriodStart: share[0]?.period ?? null,
          rentPeriods: Math.max(1, share.length),
          rentAllocation: share,
          countsAsRent: true,
          attachments: [],
        });
        if (result.queued) {
          // Kept on the device: the check's photos go up once it reaches the server.
          if (isCheck) await queueFinancialAttachmentsAfter(result.key, "payment.id", "payment", line.photos);
          created.push(recorded(`queued:${result.key ?? crypto.randomUUID()}`));
          continue;
        }
        if (!result.ok) {
          failed = toHebrewError(result.error, "שמירת התשלום נכשלה.");
          break;
        }
        const paymentId = (result.data as { payment?: { id?: string } })?.payment?.id ?? null;
        if (paymentId && isCheck && line.photos.length > 0) {
          await uploadTogether(line.photos, (file) => uploadFinancialAttachment("payment", paymentId, file));
        }
        created.push(recorded(paymentId ?? `saved:${crypto.randomUUID()}`));
      }
      for (const payment of created) onRecorded?.(payment);
      if (failed) {
        if (created.length === 0) {
          toast.error(failed);
          return;
        }
        // Some went up: they stand; the checks stay as they were.
        onOpenChange(false);
        startTransition(() => router.refresh());
        toast.error(`נרשמו ${created.length} מתוך ${sent.length} תשלומים, והצ׳קים לא נקרעו. ${failed}`);
        return;
      }

      // … and the checks of those months, torn: kept, counting nowhere, and they can be brought back.
      const tornIds: string[] = [];
      for (const check of tear) {
        const result = await offlineFetch("/api/payments/mark-collected", { id: check.id, torn: true }, "קריעת צ׳ק");
        if (result.queued || result.ok) tornIds.push(check.id);
        else toast.error(toHebrewError(result.error, `התשלום נרשם, אבל ${checkName(check)} לא נקרע.`));
      }
      onOpenChange(false);
      startTransition(() => router.refresh());

      const tornWords =
        tornIds.length === 0
          ? ""
          : tornIds.length === 1
            ? ` ${checkName(tear.find((c) => c.id === tornIds[0]) as PropertyPayment)} נקרע.`
            : ` ${tornIds.length} צ׳קים נקרעו.`;
      const message =
        (created.length === 1 ? `נרשם תשלום שכירות ל${paidFor}.` : `נרשמו ${created.length} תשלומים ל${paidFor}.`) +
        tornWords +
        (short > 0.5 ? ` חסר ${formatCurrency(short)}.` : "");
      const ids = created.map((p) => p.id);
      if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
        toast.success(message);
        return;
      }
      registerReversibleCreate({
        scope: "payment",
        id: ids[0],
        message,
        // With no signal the undo waits on the device too, and goes out with the connection.
        onUndo: async () => {
          for (const id of ids) {
            const sent = await sendChange("/api/payments/delete", { id }, "ביטול תשלום שכירות", "ביטול נכשל.");
            if (!sent.ok) return { ok: false, error: sent.error };
            onUndone?.(id);
          }
          // The checks back to waiting, not torn.
          for (const id of tornIds) {
            await sendChange("/api/payments/mark-collected", { id, collected: false }, "צ׳ק לממתין", "");
          }
          startTransition(() => router.refresh());
          return { ok: true };
        },
      });
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name, hint: getAccountKindLabel(a.kind) }));
  let lastYear: string | null = null;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="רישום תשלום שכירות"
      description={rentLease.customerName ?? undefined}
      size="form2xl"
      onSubmit={() => void submit()}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={busy}
    >
      <div className="mt-4 space-y-4">
        {onCheckCleared
          ? deposited.map((check) => (
              <div
                key={check.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted/40 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  יש <span className="font-semibold">{checkName(check)}</span> שממתין לפירעון
                  {check.dueDate ? ` ב־${formatShortDate(check.dueDate)}` : ""}. הוא הופקד?
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => {
                    onOpenChange(false);
                    onCheckCleared(check);
                  }}
                >
                  סימון כנפרע
                </Button>
              </div>
            ))
          : null}

        <div className="space-y-1.5">
          <div className="text-sm font-medium">על אילו חודשים</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {months.map((m) => {
              const on = ticked.includes(m.period);
              const name = m.label.replace(YEAR, "");
              const year = YEAR.exec(m.label)?.[1] ?? null;
              const showYear = year !== lastYear;
              lastYear = year;
              const missing = Math.max(0, m.rent - m.collected);
              const settled = missing <= 0.5;
              const need = needOf(rentLease, m, torn);
              const got = given.get(m.period) ?? 0;
              const note = on
                ? got + 0.5 < need
                  ? `${formatCurrency(got)} · חסר ${formatCurrency(need - got)}`
                  : formatCurrency(got)
                : settled
                  ? "שולם"
                  : m.checks.length > 0 && m.collected <= 0.5
                    ? checkName(m.checks[0])
                    : m.collected > 0.5
                      ? `חסר ${formatCurrency(missing)}`
                      : m.period <= today
                        ? "לא שולם"
                        : formatCurrency(m.rent);
              return (
                <button
                  key={m.period}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${m.label}: ${note}`}
                  disabled={settled && !on}
                  onClick={() => toggleMonth(m.period)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-start transition-colors disabled:cursor-default",
                    on ? cn(TOGGLE_ON, TOGGLE_ON_HOVER, "border-secondary") : "border-border/60 hover:bg-accent/60",
                    settled && !on && "opacity-50"
                  )}
                >
                  <div className="text-sm font-medium">
                    {name}
                    {showYear && year ? <span className="font-normal opacity-70"> {year}</span> : null}
                  </div>
                  <div className={cn("text-xs tabular-nums", on ? "opacity-90" : "text-muted-foreground")}>{note}</div>
                </button>
              );
            })}
          </div>
        </div>

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
              role="group"
              aria-label={`תשלום ${i + 1}`}
              className="space-y-2 rounded-xl border border-border/60 p-2 sm:rounded-none sm:border-0 sm:p-0"
            >
              <div className={LINE_GRID}>
                {/* Not a <label>: the sign in the field is a button, and a label would pass its click on. */}
                <div className="min-w-0">
                  <span className={FIELD_LABEL}>סכום</span>
                  {/* ₪ / $ / C$: a click on the sign; the account's own when it's kept in dollars. */}
                  <LineAmountInput
                    aria-label="סכום"
                    currency={line.currency?.currency ?? null}
                    accountCurrency={accounts.find((a) => a.id === line.accountId)?.currency ?? null}
                    // The day it's priced at: a check's is the day it's received.
                    date={line.method === "check" ? today : line.date}
                    onCurrency={(currency) => setLineCurrency(line.key, currency)}
                    value={line.amount}
                    onChange={(e) => {
                      setLine(line.key, { amount: e.target.value });
                      setAmountTouched(true);
                    }}
                  />
                </div>
                <label className="min-w-0">
                  <span className={FIELD_LABEL}>איך שולם</span>
                  <NativeSelect aria-label="איך שולם" value={line.method} onChange={(e) => pickMethod(line.key, e.target.value)}>
                    {PAYMENT_METHOD_OPTIONS.map((m) => (
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
                  <span className={FIELD_LABEL}>{line.method === "check" ? "פירעון" : "תאריך"}</span>
                  <DateInput
                    aria-label={line.method === "check" ? "תאריך פירעון" : "תאריך"}
                    value={line.date}
                    onChange={(e) => setLine(line.key, { date: e.target.value })}
                  />
                </label>
                <div className="col-span-2 flex justify-end sm:col-span-1">
                  {lines.length > 1 ? (
                    <IconButton icon={CloseIcon} label="הסרת התשלום" variant="ghost" onClick={() => removeLine(line.key)} />
                  ) : null}
                </div>
              </div>
              {line.method === "check" ? (
                <div className="rounded-lg bg-muted/30 p-2">
                  <CheckDetailsFields
                    checkNumber={line.checkNumber}
                    onCheckNumberChange={(value) => setLine(line.key, { checkNumber: value })}
                    photoFiles={line.photos}
                    onPhotoFilesChange={(files) => setLine(line.key, { photos: files })}
                  />
                </div>
              ) : null}
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-secondary" onClick={addLine}>
            <AddIcon className="h-4 w-4" />
            עוד תשלום
          </Button>
        </div>

        <p className="text-sm">
          סה״כ <span className="font-semibold tabular-nums">{formatCurrency(total)}</span>
          {lines.some(foreignLine) ? (
            <span className="text-muted-foreground">
              {" "}
              (
              {lines
                .filter(foreignLine)
                .map((l) => formatCurrencyAmount(amountOf(l), l.currency!.currency as keyof typeof CURRENCY_SYMBOL))
                .join(" + ")}
              {lines.some((l) => !foreignLine(l)) ? " ועוד בשקלים" : ""})
            </span>
          ) : null}
          {given.size > 0 ? <> · ל{rentPeriodsLabel(rentLease, [...given.keys()])}</> : null}
          {short > 0.5 ? <span className="font-medium text-warning-strong"> · חסר {formatCurrency(short)}</span> : null}
          {extra > 0.5 ? <span className="font-medium text-destructive"> · יותר ב־{formatCurrency(extra)}</span> : null}
        </p>

        {waiting.length > 0 ? (
          <div className="space-y-1.5 rounded-xl bg-muted/40 px-3 py-2 text-sm">
            {waiting.map((check) => (
              <label key={check.id} className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={torn(check)} onChange={() => toggleTear(check)} />
                <span>
                  לקרוע את <span className="font-semibold">{checkName(check)}</span>
                  {check.amount ? ` (${formatCurrency(check.amount)})` : ""} — לא ייפרע ולא נספר בשום מקום. אפשר לשחזר אותו אם
                  צריך.
                </span>
              </label>
            ))}
          </div>
        ) : null}

        <Field label="הערה" hint="רשות">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={given.size > 0 ? `שכירות ${rentPeriodsLabel(rentLease, [...given.keys()])}` : "שכירות"}
          />
        </Field>
      </div>
    </FormDialog>
  );
}
