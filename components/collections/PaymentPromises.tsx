"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyAmountInput, useMoneyCurrency } from "@/components/fx/MoneyCurrency";
import { isForeignCurrency } from "@/lib/fx/currencies";
import { DateInput } from "@/components/ui/date-input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { WaitingBadge } from "@/components/ui/waiting-badge";
import { MetaRow } from "@/components/ui/meta-row";
import { toHebrewError } from "@/lib/error-messages";
import { formatMoneyWithForeign } from "@/lib/money";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import { offlineFetch } from "@/lib/offline-queue";
import { updatePaymentPromise } from "@/lib/collections/paymentPromises";
import { promiseStatusLabel, type PaymentPromise } from "@/lib/promises";
import { registerReversibleCreate, scheduleDeferredEdit } from "@/lib/undo-engine";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { useLocalAdditions, waitingRowId } from "@/hooks/useLocalAdditions";

// הבטחות תשלום — "the customer promised ₪X by date Y", on the customer page.
//
// Saves update the list in place (a new promise shows at once, a status change
// is a deferred edit with undo) instead of reading the whole page again. Both
// go through the send queue: with no connection a new promise shows marked as
// waiting, and a promise marked kept stays kept — it used to be a direct
// browser write that failed offline, and the undo engine then put the old
// status back (lib/collections/paymentPromises.ts).

// updated_at: when the status was last set — /api/payment-promises/update stamps
// it on every change. Optional: getCustomerPromises (lib/promises.ts) doesn't
// select it yet, and the line below simply leaves it out until it does.
type PromiseRow = PaymentPromise & { waiting?: boolean };

// "נוספה 14/10/26 15:32 · קוימה 15/10/26 09:10" — when the promise was made and
// when it was marked (owner, 2026-10-15: "see exactly when things happen").
function promiseTimesLine(p: PromiseRow): string | null {
  const parts: string[] = [];
  if (p.created_at) parts.push(`נוספה ${formatShortDateTime(p.created_at)}`);
  if (p.status !== "pending" && p.updated_at) {
    parts.push(`${promiseStatusLabel(p.status)} ${formatShortDateTime(p.updated_at)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function statusVariant(status: string): "success" | "destructive" | "neutral" | "warning" {
  if (status === "kept") return "success";
  if (status === "broken") return "destructive";
  if (status === "cancelled") return "neutral";
  return "warning";
}

/** Newest promised date first; the id breaks a tie so the list never reshuffles. */
function byPromisedDate(a: PromiseRow, b: PromiseRow) {
  if (a.promised_date !== b.promised_date) return a.promised_date < b.promised_date ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export default function PaymentPromises({
  customerId,
  promises: promisesProp,
  formOpen,
  onFormOpenChange,
  onPendingCountChange,
}: {
  customerId: string;
  promises: PaymentPromise[];
  /** The add form's state, when the page's section header holds its "+"; without it the form always shows. */
  formOpen?: boolean;
  onFormOpenChange?: (open: boolean) => void;
  /** How many promises are still open, as it changes — for a section header. */
  onPendingCountChange?: (count: number) => void;
}) {
  const local = useLocalAdditions<PromiseRow>(promisesProp);
  const sorted = useMemo(() => [...local.rows].sort(byPromisedDate), [local.rows]);
  const promises = useUndoOverlay(sorted, (p) => p.id, "payment-promise");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const showForm = formOpen ?? true;
  // Promised in ₪, US$ or C$ (2026-10-25): its shekels at the newest rate up to the promised date.
  const money = useMoneyCurrency({ open: showForm, date: date || null });

  const pendingCount = promises.filter((p) => p.status === "pending").length;
  useEffect(() => {
    onPendingCountChange?.(pendingCount);
  }, [pendingCount, onPendingCountChange]);

  function resetForm() {
    setAmount("");
    setDate("");
    setNotes("");
    onFormOpenChange?.(false);
  }

  async function add() {
    if (busy) return;
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value <= 0) {
      toast.error("יש להזין סכום.");
      return;
    }
    if (!date) {
      toast.error("יש לבחור תאריך הבטחה.");
      return;
    }
    if (isForeignCurrency(money.currency) && money.rate === null) {
      toast.error(money.loading ? "רגע, מביא את השער היציג…" : "יש להקליד את השער.");
      return;
    }
    const shekels = money.shekels(value) ?? value;
    const foreign =
      isForeignCurrency(money.currency) && money.rate
        ? { currency: money.currency, amount: value, rate: money.rate, rateManual: money.manual }
        : null;
    setBusy(true);
    try {
      const body = {
        customer_id: customerId,
        amount: value,
        ...money.body(),
        promised_date: date,
        notes: notes.trim() || undefined,
      };
      const result = await offlineFetch("/api/payment-promises/create", body, "הבטחת תשלום", { idempotent: true });
      if (!result.queued && !result.ok) {
        toast.error(toHebrewError(result.error, "שמירה נכשלה."));
        return;
      }
      const newId = result.queued ? null : ((result.data as { id?: string | null } | null)?.id ?? null);
      local.add({
        id: newId ?? waitingRowId(),
        customer_id: customerId,
        order_id: null,
        project_id: null,
        amount: shekels,
        foreign,
        promised_date: date,
        status: "pending",
        notes: notes.trim() || null,
        created_at: new Date().toISOString(),
        waiting: result.queued,
      });
      resetForm();
      if (!newId) {
        if (!result.queued) toast.success("ההבטחה נוספה.");
        return;
      }
      registerReversibleCreate({
        scope: "payment-promise",
        id: newId,
        message: "ההבטחה נוספה.",
        onUndo: async () => {
          const undone = await updatePaymentPromise(newId, { status: "cancelled" }, "ביטול הבטחת תשלום");
          if (!undone.ok) return { ok: false, error: toHebrewError(undone.error, "ביטול נכשל.") };
          local.remove(newId);
          return { ok: true };
        },
      });
    } catch (err) {
      toast.error(toHebrewError(err, "שמירה נכשלה."));
    } finally {
      setBusy(false);
    }
  }

  function setStatus(id: string, status: "kept" | "broken" | "cancelled") {
    scheduleDeferredEdit({
      scope: "payment-promise",
      id,
      message: "ההבטחה עודכנה.",
      patch: { status, updated_at: new Date().toISOString() },
      onCommit: async () => {
        const result = await updatePaymentPromise(id, { status });
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "עדכון נכשל.") };
        return { ok: true };
      },
    });
  }

  return (
    <div className="space-y-3">
      {showForm ? (
        <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_2fr]">
            <CurrencyAmountInput money={money} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="סכום" aria-label="סכום" />
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} aria-label="תאריך הבטחה" />
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערה (אופציונלי)" />
          </div>
          <div className="flex justify-end gap-2">
            {onFormOpenChange ? (
              <Button type="button" size="sm" variant="muted" onClick={() => onFormOpenChange(false)} disabled={busy}>
                ביטול
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => void add()} disabled={busy}>
              {busy ? "שומר..." : "הוספת הבטחה"}
            </Button>
          </div>
        </div>
      ) : null}

      {promises.length === 0 ? (
        <EmptyState dense>אין הבטחות תשלום ללקוח זה.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {promises.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 p-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums">{formatMoneyWithForeign(p.amount, p.foreign)}</span>
                  <span className="text-sm text-muted-foreground">עד {formatShortDate(p.promised_date, "—")}</span>
                  {p.waiting ? <WaitingBadge /> : <Badge variant={statusVariant(p.status)}>{promiseStatusLabel(p.status)}</Badge>}
                </div>
                {p.notes ? <MetaRow className="text-xs text-muted-foreground" items={[p.notes]} /> : null}
                {promiseTimesLine(p) ? (
                  <div className="text-[11px] text-muted-foreground/70">{promiseTimesLine(p)}</div>
                ) : null}
              </div>
              {p.status === "pending" && !p.waiting ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setStatus(p.id, "kept")}>
                    קוימה
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setStatus(p.id, "broken")}>
                    הופרה
                  </Button>
                  <Button size="sm" variant="muted" onClick={() => setStatus(p.id, "cancelled")}>
                    ביטול
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
