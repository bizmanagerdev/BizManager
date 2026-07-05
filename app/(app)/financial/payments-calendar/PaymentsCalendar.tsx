"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Check, Split, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { DateInput } from "@/components/ui/date-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { Account } from "@/lib/accounts";
import { hebrewFullDate } from "@/lib/hebrew-calendar";
import { toHebrewError } from "@/lib/error-messages";
import type { PaymentCalendarItem } from "@/lib/payables";
import MonthCalendar, {
  fmtFullDay,
  isoLocal,
  toDateOnly,
  type DayContext,
  type SelectedContext,
} from "@/components/ui/month-calendar";
import { PaymentDialog } from "./PaymentDialog";
import { SplitPaymentDialog } from "./SplitPaymentDialog";

function fmtIls(value: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

// ── Stage presentation ──────────────────────────────────────────────────────────
type StageKey = "overdue" | "pending" | "scheduled" | "posted";
function itemStageKey(item: PaymentCalendarItem): StageKey {
  if (item.stage === "posted") return "posted";
  if (item.overdue) return "overdue";
  if (item.stage === "pending") return "pending";
  return "scheduled";
}
const STAGE_LABEL: Record<StageKey, string> = {
  overdue: "באיחור",
  pending: "ממתין",
  scheduled: "צפוי",
  posted: "שולם",
};
const STAGE_DOT: Record<StageKey, string> = {
  overdue: "bg-destructive",
  pending: "bg-warning",
  scheduled: "bg-info",
  posted: "bg-success",
};
const STAGE_BADGE: Record<StageKey, "destructive" | "warning" | "info" | "success"> = {
  overdue: "destructive",
  pending: "warning",
  scheduled: "info",
  posted: "success",
};

type Props = {
  items: PaymentCalendarItem[];
  todayIso: string;
};

export default function PaymentsCalendar({ items, todayIso }: Props) {
  const router = useRouter();
  const [showPaid, setShowPaid] = useState(false);

  const visibleItems = useMemo(
    () => (showPaid ? items : items.filter((i) => i.stage !== "posted")),
    [items, showPaid]
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, PaymentCalendarItem[]>();
    for (const item of visibleItems) {
      const key = item.date.slice(0, 10);
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [visibleItems]);

  const itemsOnDay = (day: Date) => itemsByDay.get(isoLocal(day)) ?? [];
  // "To pay" total for a day = amounts not yet paid (scheduled + pending).
  const unpaidTotalOnDay = (day: Date) =>
    itemsOnDay(day).reduce((sum, i) => (i.stage === "posted" ? sum : sum + i.amount), 0);

  const monthUnpaidTotal = (monthDate: Date) =>
    visibleItems.reduce((sum, i) => {
      const d = toDateOnly(i.date);
      if (!d || d.getMonth() !== monthDate.getMonth() || d.getFullYear() !== monthDate.getFullYear()) return sum;
      return i.stage === "posted" ? sum : sum + i.amount;
    }, 0);

  const afterMutation = () => router.refresh();

  function renderSelectedPanel({ day, holiday }: SelectedContext) {
    return (
      <PaymentsDayPanel
        day={day}
        holiday={holiday}
        items={itemsOnDay(day)}
        total={unpaidTotalOnDay(day)}
        onMutate={afterMutation}
      />
    );
  }

  function renderDayContent({ day, holiday, inMonth }: DayContext) {
    const dayItems = itemsOnDay(day);
    const unpaidTotal = unpaidTotalOnDay(day);
    const stages = new Set(dayItems.map(itemStageKey));
    const darkHoliday = Boolean(holiday) && inMonth; // light text on the dark holiday cell
    return (
      <>
        {stages.size > 0 && (
          <div className="flex gap-0.5">
            {(["overdue", "pending", "scheduled", "posted"] as StageKey[])
              .filter((s) => stages.has(s))
              .map((s) => (
                <span key={s} className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[s]}`} />
              ))}
          </div>
        )}
        {unpaidTotal > 0 ? (
          <span className={`max-w-full truncate text-[10px] font-semibold leading-tight ${darkHoliday ? "text-primary-foreground" : "text-foreground"}`}>
            {fmtIls(unpaidTotal)}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <MonthCalendar
      todayIso={todayIso}
      renderSelectedPanel={renderSelectedPanel}
      renderDayContent={renderDayContent}
      renderToolbar={(monthDate) => (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
          <span className="text-muted-foreground">
            סה״כ לתשלום החודש:{" "}
            <span className="font-semibold text-foreground">{fmtIls(monthUnpaidTotal(monthDate))}</span>
          </span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
            הצג תשלומים ששולמו
          </label>
        </div>
      )}
      legend={
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />באיחור</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />ממתין</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" />צפוי</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />שולם</span>
        </div>
      }
    />
  );
}

// ── Selected-day panel (owns its own add/mark/split dialog state) ─────────────────
function PaymentsDayPanel({
  day,
  holiday,
  items,
  total,
  onMutate,
}: {
  day: Date;
  holiday: string | null;
  items: PaymentCalendarItem[];
  total: number;
  onMutate: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [splitItem, setSplitItem] = useState<PaymentCalendarItem | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [markItem, setMarkItem] = useState<PaymentCalendarItem | null>(null);

  const dayIso = isoLocal(day);

  return (
    <div className="rounded-2xl border bg-secondary/10 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{fmtFullDay(day)}</div>
          <div className="text-xs text-muted-foreground">{hebrewFullDate(day)}</div>
          {holiday ? (
            <div className="mt-0.5 text-sm font-medium text-info-soft-foreground">{holiday}</div>
          ) : null}
          <div className="mt-1 text-sm text-muted-foreground">
            {total > 0 ? (
              <>
                לתשלום ביום זה: <span className="font-semibold text-foreground">{fmtIls(total)}</span>
              </>
            ) : items.length > 0 ? (
              "כל התשלומים ביום זה שולמו"
            ) : (
              "אין תשלומים ביום זה"
            )}
          </div>
        </div>
        <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="ml-1 h-4 w-4" />
          הוסף תשלום ליום זה
        </Button>
      </div>

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => {
            const stage = itemStageKey(item);
            const actionable = Boolean(item.expenseId);
            return (
              <div key={item.id} className="rounded-xl border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.label}</span>
                  <span className="font-semibold">{fmtIls(item.amount)}</span>
                  <Badge variant={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge>
                  {item.installmentGroupId && item.installmentIndex && item.installmentCount ? (
                    <Badge variant="neutral">
                      תשלום {item.installmentIndex}/{item.installmentCount}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {[item.domainName, item.sourceLabel].filter(Boolean).join(" • ")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {actionable && item.stage !== "posted" ? (
                    <>
                      <Button type="button" size="sm" onClick={() => setMarkItem(item)}>
                        <Check className="ml-1 h-3.5 w-3.5" />
                        סמן כשולם
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSplitItem(item);
                          setSplitOpen(true);
                        }}
                      >
                        <Split className="ml-1 h-3.5 w-3.5" />
                        פיצול לתשלומים
                      </Button>
                    </>
                  ) : null}
                  {item.sourceHref ? (
                    <Button asChild type="button" size="sm" variant="secondary">
                      <Link href={item.sourceHref}>
                        <ExternalLink className="ml-1 h-3.5 w-3.5" />
                        למקור
                      </Link>
                    </Button>
                  ) : null}
                  {!actionable && !item.sourceHref ? (
                    <span className="text-xs text-muted-foreground">מנוהל במקום אחר</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">לחצו על יום כדי לראות את התשלומים, או הוסיפו תשלום חדש.</div>
      )}

      {/* Add payment */}
      <PaymentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDate={dayIso}
        onSaved={() => {
          setAddOpen(false);
          onMutate();
        }}
      />

      {/* Split */}
      <SplitPaymentDialog
        open={splitOpen}
        onOpenChange={(o) => {
          setSplitOpen(o);
          if (!o) setSplitItem(null);
        }}
        sourceItem={splitItem}
        onSaved={() => {
          setSplitOpen(false);
          setSplitItem(null);
          onMutate();
        }}
      />

      {/* Mark paid */}
      <MarkPaidDialog
        item={markItem}
        onClose={() => setMarkItem(null)}
        onSaved={() => {
          setMarkItem(null);
          onMutate();
        }}
      />
    </div>
  );
}

// ── Inline mark-paid dialog (account required) ──────────────────────────────────
function MarkPaidDialog({
  item,
  onClose,
  onSaved,
}: {
  item: PaymentCalendarItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));

  const open = Boolean(item);

  async function submit() {
    if (!item?.expenseId) return;
    if (accountsList.length > 0 && !accountId) {
      setError("יש לבחור חשבון לתנועה.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/expenses/mark-paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: item.expenseId,
          payment_method: method || null,
          account_id: accountId || null,
          paid_date: paidDate,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "סימון התשלום נכשל.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("התשלום סומן כשולם");
      onSaved();
    } catch (err) {
      const msg = toHebrewError(err, "סימון התשלום נכשל.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <AdaptiveDialog size="formMd">
        <DialogHeader>
          <DialogTitle>סימון תשלום כשולם</DialogTitle>
          <DialogDescription>
            {item ? `${item.label} — ${fmtIls(item.amount)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">תאריך תשלום</div>
            <DateInput value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">אמצעי תשלום</div>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">בחר אמצעי</option>
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <AccountSelect
            required
            value={accountId}
            onChange={setAccountId}
            onLoaded={setAccountsList}
          />
          {error ? (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter className="mt-6">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? (<><Loader2 className="ml-2 h-4 w-4 animate-spin" />שומר...</>) : "סמן כשולם"}
          </Button>
        </DialogFooter>
      </AdaptiveDialog>
    </Dialog>
  );
}
