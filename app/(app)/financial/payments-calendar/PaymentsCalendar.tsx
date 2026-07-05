"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { hebrewDayLabel, hebrewFullDate, getHolidaysInRange } from "@/lib/hebrew-calendar";
import { toHebrewError } from "@/lib/error-messages";
import type { PaymentCalendarItem } from "@/lib/payables";
import { PaymentDialog } from "./PaymentDialog";
import { SplitPaymentDialog } from "./SplitPaymentDialog";

// ── Date helpers (shared shape with ProjectsCalendar) ───────────────────────────
function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toDateOnly(value: string | null) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtMonthYear(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(d);
}
function fmtFullDay(d: Date) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(d);
}
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

const WEEK_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

type Props = {
  items: PaymentCalendarItem[];
  todayIso: string;
};

export default function PaymentsCalendar({ items, todayIso }: Props) {
  const router = useRouter();
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);
  const [showPaid, setShowPaid] = useState(false);

  // Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [splitItem, setSplitItem] = useState<PaymentCalendarItem | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [markItem, setMarkItem] = useState<PaymentCalendarItem | null>(null);

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

  const calendarDays = useMemo(() => {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = firstDay.getDay();
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - startOffset);
    return Array.from({ length: 42 }).map((_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [monthDate]);

  const holidaysByDay = useMemo(
    () => getHolidaysInRange(calendarDays[0], calendarDays[calendarDays.length - 1]),
    [calendarDays]
  );

  function itemsOnDay(day: Date) {
    return itemsByDay.get(isoLocal(day)) ?? [];
  }
  // "To pay" total for a day = amounts not yet paid (scheduled + pending).
  function unpaidTotalOnDay(day: Date) {
    return itemsOnDay(day).reduce((sum, i) => (i.stage === "posted" ? sum : sum + i.amount), 0);
  }

  const selectedIso = isoLocal(selectedDate);
  const selectedItems = itemsOnDay(selectedDate);
  const selectedTotal = unpaidTotalOnDay(selectedDate);

  const monthUnpaidTotal = useMemo(
    () =>
      visibleItems.reduce((sum, i) => {
        const d = toDateOnly(i.date);
        if (!d || d.getMonth() !== monthDate.getMonth() || d.getFullYear() !== monthDate.getFullYear()) return sum;
        return i.stage === "posted" ? sum : sum + i.amount;
      }, 0),
    [visibleItems, monthDate]
  );

  const prevMonth = () => setMonthDate((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1));
  const nextMonth = () => setMonthDate((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1));
  const goToday = () => {
    setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  };

  // Scroll (trackpad / wheel) and swipe over the grid change the month. A time
  // guard turns one continuous gesture into a single month step.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const lastNavRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const stepMonth = (forward: boolean) => {
    const now = Date.now();
    if (now - lastNavRef.current < 350) return;
    lastNavRef.current = now;
    if (forward) nextMonth();
    else prevMonth();
  };

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 4 && Math.abs(e.deltaX) < 4) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      stepMonth(delta > 0);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
    // Vertical swipe up OR (RTL) swipe right → next month.
    if (Math.abs(dy) >= Math.abs(dx)) stepMonth(dy < 0);
    else stepMonth(dx > 0);
  };

  const afterMutation = () => {
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Selected day panel */}
      <div className="rounded-2xl border bg-secondary/10 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-semibold">{fmtFullDay(selectedDate)}</div>
            <div className="text-xs text-muted-foreground">{hebrewFullDate(selectedDate)}</div>
            {holidaysByDay.get(selectedIso) ? (
              <div className="mt-0.5 text-sm font-medium text-info-soft-foreground">
                {holidaysByDay.get(selectedIso)}
              </div>
            ) : null}
            <div className="mt-1 text-sm text-muted-foreground">
              {selectedTotal > 0 ? (
                <>
                  לתשלום ביום זה: <span className="font-semibold text-foreground">{fmtIls(selectedTotal)}</span>
                </>
              ) : selectedItems.length > 0 ? (
                "כל התשלומים ביום זה שולמו"
              ) : (
                "אין תשלומים ביום זה"
              )}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="ml-1 h-4 w-4" />
            הוסף תשלום ליום זה
          </Button>
        </div>

        {selectedItems.length > 0 ? (
          <div className="space-y-2">
            {selectedItems.map((item) => {
              const stage = itemStageKey(item);
              const actionable = Boolean(item.expenseId);
              return (
                <div
                  key={item.id}
                  className="rounded-xl border bg-background p-3"
                >
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
      </div>

      {/* Navigation + month total */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={prevMonth}
          className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-secondary/10"
        >
          ›
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{fmtMonthYear(monthDate)}</span>
          <button
            type="button"
            onClick={goToday}
            className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/10"
          >
            היום
          </button>
        </div>
        <button
          type="button"
          onClick={nextMonth}
          className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-secondary/10"
        >
          ‹
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
        <span className="text-muted-foreground">
          סה״כ לתשלום החודש: <span className="font-semibold text-foreground">{fmtIls(monthUnpaidTotal)}</span>
        </span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
          הצג תשלומים ששולמו
        </label>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div
        ref={gridRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="grid grid-cols-7 gap-px rounded-xl border bg-secondary/30 overflow-hidden"
      >
        {calendarDays.map((day) => {
          const inMonth = day.getMonth() === monthDate.getMonth();
          const isToday = isSameDay(day, today);
          const isSelected = isSameDay(day, selectedDate);
          const dayItems = itemsOnDay(day);
          const unpaidTotal = unpaidTotalOnDay(day);
          const holiday = holidaysByDay.get(isoLocal(day)) ?? null;
          const stages = new Set(dayItems.map(itemStageKey));

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => setSelectedDate(day)}
              title={holiday ?? undefined}
              className={`flex min-h-[3.75rem] flex-col items-center gap-0.5 px-1 py-2 transition-colors ${
                holiday ? "bg-info-soft/40" : "bg-background"
              } ${isSelected ? "ring-1 ring-inset ring-primary/40" : "hover:bg-secondary/10"} ${
                !inMonth ? "opacity-35" : ""
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : isSelected
                      ? "bg-secondary/20 text-secondary font-semibold"
                      : ""
                }`}
              >
                {day.getDate()}
              </span>

              <span className={`text-[10px] leading-none ${holiday ? "text-info-soft-foreground" : "text-muted-foreground"}`}>
                {hebrewDayLabel(day)}
              </span>

              {/* Stage dots */}
              {stages.size > 0 && (
                <div className="flex gap-0.5">
                  {(["overdue", "pending", "scheduled", "posted"] as StageKey[])
                    .filter((s) => stages.has(s))
                    .map((s) => (
                      <span key={s} className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[s]}`} />
                    ))}
                </div>
              )}

              {/* Day "to pay" total */}
              {unpaidTotal > 0 ? (
                <span className="max-w-full truncate text-[10px] font-semibold leading-tight text-foreground">
                  {fmtIls(unpaidTotal)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />באיחור</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />ממתין</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" />צפוי</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />שולם</span>
      </div>

      {/* Add payment */}
      <PaymentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDate={selectedIso}
        onSaved={() => {
          setAddOpen(false);
          afterMutation();
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
          afterMutation();
        }}
      />

      {/* Mark paid */}
      <MarkPaidDialog
        item={markItem}
        onClose={() => setMarkItem(null)}
        onSaved={() => {
          setMarkItem(null);
          afterMutation();
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
