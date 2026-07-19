"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Check, Split, ExternalLink, Calendar as CalendarIcon, List as ListIcon, BellPlus } from "lucide-react";
import ReminderFormDialog from "@/components/reminders/ReminderFormDialog";
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
import { CurrencyInput } from "@/components/ui/currency-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { Account } from "@/lib/accounts";
import { hebrewFullDate } from "@/lib/hebrew-calendar";
import { toHebrewError } from "@/lib/error-messages";
import type { PaymentCalendarItem } from "@/lib/payables";
import MonthCalendar, {
  MonthNav,
  fmtFullDay,
  isoLocal,
  toDateOnly,
  type DayContext,
  type SelectedContext,
} from "@/components/ui/month-calendar";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import { SplitPaymentDialog } from "./SplitPaymentDialog";

function fmtIls(value: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

// A pre-filled note for a reminder created from a payment.
function reminderNoteFor(item: PaymentCalendarItem): string {
  const amt = item.variableAmount ? "סכום משתנה" : fmtIls(item.amount);
  return `תשלום: ${item.label} — ${amt}`;
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
// Status is NEVER blue (design rule): צפוי is slate/gray, not info-blue.
const STAGE_DOT: Record<StageKey, string> = {
  overdue: "bg-destructive",
  pending: "bg-warning",
  scheduled: "bg-muted-foreground/60",
  posted: "bg-success",
};
const STAGE_BADGE: Record<StageKey, "destructive" | "warning" | "neutral" | "success"> = {
  overdue: "destructive",
  pending: "warning",
  scheduled: "neutral",
  posted: "success",
};

type Option = { id: string; label: string };

type Props = {
  items: PaymentCalendarItem[];
  todayIso: string;
  projects: Option[];
  properties: Option[];
  orders: Option[];
  accounts: Account[];
};

export default function PaymentsCalendar({ items, todayIso, projects, properties, orders, accounts }: Props) {
  const router = useRouter();
  const [showPaid, setShowPaid] = useState(false);
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [layout, setLayout] = useState<"calendar" | "list">("calendar");
  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name] as const)), [accounts]);
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  // Month owned here so the calendar and the list stay on the same month.
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const visibleItems = useMemo(() => {
    let list = showPaid ? items : items.filter((i) => i.stage !== "posted");
    if (recurringOnly) list = list.filter((i) => i.recurringTemplateId);
    return list;
  }, [items, showPaid, recurringOnly]);

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

  // Dark "total to pay this month" pill shown in the month-nav row (both views).
  const totalPill = (m: Date) => (
    <div className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-background">
      <span className="text-sm font-bold tabular-nums">{fmtIls(monthUnpaidTotal(m))}</span>
      <span className="text-[11px] opacity-70">סה״כ לתשלום החודש</span>
    </div>
  );

  function renderSelectedPanel({ day, holiday, isToday }: SelectedContext) {
    return (
      <PaymentsDayPanel
        day={day}
        holiday={holiday}
        isToday={isToday}
        items={itemsOnDay(day)}
        total={unpaidTotalOnDay(day)}
        projects={projects}
        properties={properties}
        orders={orders}
        accountNameById={accountNameById}
        onMutate={afterMutation}
      />
    );
  }

  function renderDayContent({ day, holiday }: DayContext) {
    const dayItems = itemsOnDay(day);
    // Aggregate per stage → each shows as "<colored dot> <amount>" on one row.
    const byStage = new Map<StageKey, { amount: number; variable: boolean }>();
    for (const item of dayItems) {
      const st = itemStageKey(item);
      const cur = byStage.get(st) ?? { amount: 0, variable: false };
      if (item.variableAmount) cur.variable = true;
      else cur.amount += item.amount;
      byStage.set(st, cur);
    }
    return (
      <>
        {holiday ? (
          <span className="max-w-full truncate text-[9px] leading-tight text-secondary">{holiday}</span>
        ) : null}
        {(["overdue", "pending", "scheduled", "posted"] as StageKey[])
          .filter((s) => byStage.has(s))
          .map((s) => {
            const { amount, variable } = byStage.get(s)!;
            const text = amount > 0 ? fmtIls(amount) : variable ? "משתנה" : null;
            if (!text) return null;
            return (
              <span key={s} className="flex max-w-full items-center gap-1 text-[10px] font-semibold leading-tight text-foreground">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[s]}`} />
                <span className="truncate">{text}</span>
              </span>
            );
          })}
      </>
    );
  }

  function renderDayHover({ day }: DayContext) {
    const dayItems = itemsOnDay(day);
    if (dayItems.length === 0) return null;
    const total = unpaidTotalOnDay(day);
    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-1.5">
          <span className="text-sm font-semibold">{fmtFullDay(day)}</span>
          {total > 0 ? <span className="text-xs font-semibold">{fmtIls(total)}</span> : null}
        </div>
        <ul className="space-y-1">
          {dayItems.map((item) => {
            const stage = itemStageKey(item);
            return (
              <li key={item.id} className="flex items-center gap-1.5 text-xs">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[stage]}`} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 font-medium">{item.variableAmount ? "משתנה" : fmtIls(item.amount)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const legend = (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />באיחור</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />ממתין</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/60" />צפוי</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />שולם</span>
    </div>
  );

  // Order in the toolbar (RTL, right→left): month nav first, then the two toggles,
  // then the total pill last.
  const viewToggle = (
    <div className="inline-flex rounded-lg border bg-muted/60 p-0.5">
      {([
        { key: "calendar" as const, label: "לוח", icon: <CalendarIcon className="h-3.5 w-3.5" /> },
        { key: "list" as const, label: "רשימה", icon: <ListIcon className="h-3.5 w-3.5" /> },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => setLayout(opt.key)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            layout === opt.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
  const toggle = (on: boolean, set: () => void, label: string) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={set}
      className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
    >
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "right-0.5" : "right-[18px]"}`} />
      </span>
      {label}
    </button>
  );
  const showPaidToggle = toggle(showPaid, () => setShowPaid((v) => !v), "הצג ששולמו");
  const recurringOnlyToggle = toggle(recurringOnly, () => setRecurringOnly((v) => !v), "רק קבועות");

  // Compact toolbar: month nav (right) · toggles (middle) · total pill (far left).
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2">
      <MonthNav month={monthDate} todayDate={today} onChange={setMonthDate} />
      <div className="flex flex-wrap items-center gap-3">
        {viewToggle}
        {recurringOnlyToggle}
        {showPaidToggle}
      </div>
      {totalPill(monthDate)}
    </div>
  );

  return (
    <div className="space-y-3">
      {layout === "calendar" ? (
        <MonthCalendar
          todayIso={todayIso}
          month={monthDate}
          onMonthChange={setMonthDate}
          hideNav
          toolbar={toolbar}
          renderSelectedPanel={renderSelectedPanel}
          renderDayContent={renderDayContent}
          renderDayHover={renderDayHover}
          legend={legend}
        />
      ) : (
        <>
          {toolbar}
          <PaymentsMonthList
            items={visibleItems}
            month={monthDate}
            accountNameById={accountNameById}
            onMutate={afterMutation}
            legend={legend}
          />
        </>
      )}
    </div>
  );
}

// ── Shared item card (used by both the day panel and the list view) ──────────────
function PaymentItemCard({
  item,
  onMarkPaid,
  onSplit,
  onRemind,
  compact = false,
  accountName,
}: {
  item: PaymentCalendarItem;
  onMarkPaid: () => void;
  onSplit: () => void;
  onRemind: () => void;
  compact?: boolean;
  accountName?: string;
}) {
  const stage = itemStageKey(item);
  const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
  const canMarkPaid = Boolean(item.expenseId) || isForecast;
  const canSplit = Boolean(item.expenseId);
  const metaLine = [item.domainName, item.sourceLabel, accountName ? `מחשבון ${accountName}` : null]
    .filter(Boolean)
    .join(" • ");
  const amountText = item.variableAmount ? "סכום משתנה" : fmtIls(item.amount);
  const noteText = item.notes?.trim() || "";

  // Compact single-block row for the list view: title + amount on one line,
  // source + icon actions on the next. Icon-only buttons keep rows narrow.
  if (compact) {
    return (
      <div className="rounded-lg border bg-background px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[stage]}`} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
          {isForecast ? <Badge variant="neutral">קבועה</Badge> : null}
          <span className="shrink-0 text-sm font-semibold tabular-nums">{amountText}</span>
        </div>
        {noteText ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">הערה: {noteText}</div>
        ) : null}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {metaLine}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {canMarkPaid && item.stage !== "posted" ? (
              <Button type="button" size="icon-sm" variant="secondary" onClick={onMarkPaid} title="סמן כשולם" aria-label="סמן כשולם">
                <Check className="h-4 w-4" />
              </Button>
            ) : null}
            {canSplit && item.stage !== "posted" ? (
              <Button type="button" size="icon-sm" variant="secondary" onClick={onSplit} title="פיצול לתשלומים" aria-label="פיצול לתשלומים">
                <Split className="h-4 w-4" />
              </Button>
            ) : null}
            {item.sourceHref ? (
              <Button asChild type="button" size="icon-sm" variant="secondary" title="למקור" aria-label="למקור">
                <Link href={item.sourceHref}><ExternalLink className="h-4 w-4" /></Link>
              </Button>
            ) : null}
            <Button type="button" size="icon-sm" variant="secondary" onClick={onRemind} title="תזכורת" aria-label="תזכורת">
              <BellPlus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.label}</span>
        <span className="font-semibold">{amountText}</span>
        <Badge variant={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge>
        {isForecast ? <Badge variant="neutral">הוצאה קבועה</Badge> : null}
        {item.installmentGroupId && item.installmentIndex && item.installmentCount ? (
          <Badge variant="neutral">
            תשלום {item.installmentIndex}/{item.installmentCount}
          </Badge>
        ) : null}
      </div>
      <div className="mt-0.5 text-sm text-muted-foreground">
        {metaLine}
      </div>
      {noteText ? (
        <div className="mt-0.5 text-sm text-muted-foreground">הערה: {noteText}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {canMarkPaid && item.stage !== "posted" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onMarkPaid}>
            <Check className="ml-1 h-3.5 w-3.5" />
            סמן כשולם
          </Button>
        ) : null}
        {canSplit && item.stage !== "posted" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onSplit}>
            <Split className="ml-1 h-3.5 w-3.5" />
            פיצול לתשלומים
          </Button>
        ) : null}
        {item.sourceHref ? (
          <Button asChild type="button" size="sm" variant="secondary">
            <Link href={item.sourceHref}>
              <ExternalLink className="ml-1 h-3.5 w-3.5" />
              למקור
            </Link>
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={onRemind}>
          <BellPlus className="ml-1 h-3.5 w-3.5" />
          תזכורת
        </Button>
      </div>
    </div>
  );
}

// ── List view — the selected month's payments as a table ─────────────────────────
function PaymentsMonthList({
  items,
  month,
  accountNameById,
  onMutate,
  legend,
}: {
  items: PaymentCalendarItem[];
  month: Date;
  accountNameById: Map<string, string>;
  onMutate: () => void;
  legend: ReactNode;
}) {
  const [splitItem, setSplitItem] = useState<PaymentCalendarItem | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [markItem, setMarkItem] = useState<PaymentCalendarItem | null>(null);
  const [remindItem, setRemindItem] = useState<PaymentCalendarItem | null>(null);

  // Only this month's payments, sorted by date ascending.
  const monthItems = useMemo(() => {
    return items
      .filter((i) => {
        const d = toDateOnly(i.date);
        return d && d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [items, month]);

  const monthName = useMemo(() => new Intl.DateTimeFormat("he-IL", { month: "long" }).format(month), [month]);

  return (
    <div className="space-y-3">
      {monthItems.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">אין תשלומים בחודש זה.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table dir="rtl" className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right font-medium">תאריך</th>
                <th className="px-3 py-2 text-right font-medium">תשלום</th>
                <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                <th className="px-3 py-2 text-right font-medium">סכום</th>
                <th className="px-3 py-2 text-right font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {monthItems.map((item) => {
                const stage = itemStageKey(item);
                const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
                const canMarkPaid = Boolean(item.expenseId) || isForecast;
                const canSplit = Boolean(item.expenseId);
                const day = toDateOnly(item.date) ?? new Date(item.date);
                const accountName = item.accountId ? accountNameById.get(item.accountId) : undefined;
                const meta = [item.domainName, item.sourceLabel, accountName ? `מחשבון ${accountName}` : null]
                  .filter(Boolean)
                  .join(" • ");
                return (
                  <tr key={item.id} className="align-top hover:bg-secondary/10">
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold tabular-nums">{day.getDate()}</span>
                        <span className="text-xs text-muted-foreground">{monthName}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{hebrewFullDate(day)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.label}</div>
                      {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
                      {item.notes?.trim() ? <div className="text-xs text-muted-foreground">הערה: {item.notes.trim()}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge>
                        {isForecast ? <Badge variant="neutral">קבועה</Badge> : null}
                      </div>
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-3 py-2 text-left font-semibold tabular-nums">
                      {item.variableAmount ? "משתנה" : fmtIls(item.amount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-1">
                        {canMarkPaid && item.stage !== "posted" ? (
                          <Button type="button" size="icon-sm" variant="secondary" onClick={() => setMarkItem(item)} title="סמן כשולם" aria-label="סמן כשולם">
                            <Check className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canSplit && item.stage !== "posted" ? (
                          <Button type="button" size="icon-sm" variant="secondary" onClick={() => { setSplitItem(item); setSplitOpen(true); }} title="פיצול לתשלומים" aria-label="פיצול לתשלומים">
                            <Split className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {item.sourceHref ? (
                          <Button asChild type="button" size="icon-sm" variant="secondary" title="למקור" aria-label="למקור">
                            <Link href={item.sourceHref}><ExternalLink className="h-4 w-4" /></Link>
                          </Button>
                        ) : null}
                        <Button type="button" size="icon-sm" variant="secondary" onClick={() => setRemindItem(item)} title="תזכורת" aria-label="תזכורת">
                          <BellPlus className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {legend}

      <ReminderFormDialog
        mode="create"
        open={Boolean(remindItem)}
        onOpenChange={(o) => { if (!o) setRemindItem(null); }}
        category="task"
        links={remindItem?.expenseId ? { expense_id: remindItem.expenseId } : {}}
        defaultNote={remindItem ? reminderNoteFor(remindItem) : undefined}
        onSaved={() => setRemindItem(null)}
      />

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

// ── Selected-day panel (owns its own add/mark/split dialog state) ─────────────────
function PaymentsDayPanel({
  day,
  holiday,
  isToday,
  items,
  total,
  projects,
  properties,
  orders,
  accountNameById,
  onMutate,
}: {
  day: Date;
  holiday: string | null;
  isToday: boolean;
  items: PaymentCalendarItem[];
  total: number;
  projects: Option[];
  properties: Option[];
  orders: Option[];
  accountNameById: Map<string, string>;
  onMutate: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [splitItem, setSplitItem] = useState<PaymentCalendarItem | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [markItem, setMarkItem] = useState<PaymentCalendarItem | null>(null);
  const [remindItem, setRemindItem] = useState<PaymentCalendarItem | null>(null);

  const dayIso = isoLocal(day);

  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card p-4">
      <div>
        <div className="text-xs font-semibold text-primary">{isToday ? "היום · נבחר" : "נבחר"}</div>
        <div className="text-lg font-bold leading-tight">{fmtFullDay(day)}</div>
        <div className="text-xs text-muted-foreground">{hebrewFullDate(day)}</div>
        {holiday ? (
          <div className="mt-0.5 text-sm font-medium text-secondary">{holiday}</div>
        ) : null}
        <div className="mt-1 text-sm text-muted-foreground">
          {total > 0 ? (
            <>
              לתשלום ביום זה: <span className="font-semibold text-foreground">{fmtIls(total)}</span>
            </>
          ) : items.length > 0 ? (
            "כל התשלומים ביום זה שולמו"
          ) : null}
        </div>
      </div>

      {/* Body — grows to fill the panel so the add button pins to the bottom */}
      <div className="mt-3 flex-1">
        {items.length > 0 ? (
          <div className="space-y-1.5">
            {items.map((item) => (
              <PaymentItemCard
                key={item.id}
                item={item}
                compact
                accountName={item.accountId ? accountNameById.get(item.accountId) : undefined}
                onMarkPaid={() => setMarkItem(item)}
                onSplit={() => {
                  setSplitItem(item);
                  setSplitOpen(true);
                }}
                onRemind={() => setRemindItem(item)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CalendarIcon className="h-6 w-6" />
            </div>
            <div className="text-sm font-medium">אין תשלומים ביום זה</div>
            <div className="text-xs text-muted-foreground">לא נקבעו הוצאות קבועות לתאריך שנבחר.</div>
          </div>
        )}
      </div>

      {/* Add — pinned to the bottom, full width */}
      <div className="mt-3">
        <Button type="button" className="w-full" onClick={() => setAddOpen(true)}>
          <Plus className="ml-1 h-4 w-4" />
          הוסף תשלום ליום זה
        </Button>
        <div className="mt-2 text-center text-xs text-muted-foreground">
          לחצו על יום כדי לראות את התשלומים, או הוסיפו תשלום חדש.
        </div>
      </div>

      {/* Add expense/payment — the full shared expense dialog (one-time or
          recurring), prefilled to this day. No `users` prop, so the worker-session
          category is omitted on the payments calendar. */}
      <ExpenseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDate={dayIso}
        showAttachments
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
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

      {/* Reminder for this payment */}
      <ReminderFormDialog
        mode="create"
        open={Boolean(remindItem)}
        onOpenChange={(o) => { if (!o) setRemindItem(null); }}
        category="task"
        links={remindItem?.expenseId ? { expense_id: remindItem.expenseId } : {}}
        defaultNote={remindItem ? reminderNoteFor(remindItem) : undefined}
        onSaved={() => setRemindItem(null)}
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
  const [payAmount, setPayAmount] = useState("");

  const open = Boolean(item);
  const isVariable = Boolean(item?.variableAmount);

  // Clear the entered amount whenever a different item opens.
  useEffect(() => { setPayAmount(""); setError(""); }, [item?.id]);

  async function submit() {
    if (!item) return;
    const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
    if (!item.expenseId && !isForecast) return;
    if (accountsList.length > 0 && !accountId) {
      setError("יש לבחור חשבון לתנועה.");
      return;
    }
    const amountNum = Number(payAmount);
    if (isVariable && !(Number.isFinite(amountNum) && amountNum > 0)) {
      setError("יש להזין את סכום התשלום.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // A forecast (upcoming recurring occurrence) has no expense row yet →
      // materialize it and mark paid in one step; otherwise flip the existing row.
      const res = isForecast
        ? await fetch("/api/recurring-expenses/materialize-paid", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              template_id: item.recurringTemplateId,
              recurrence_key: item.recurrenceKey,
              expense_date: item.date.slice(0, 10),
              amount: isVariable ? amountNum : null,
              payment_method: method || null,
              account_id: accountId || null,
              paid_date: paidDate,
            }),
          })
        : await fetch("/api/expenses/mark-paid", {
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
            {item ? `${item.label} — ${isVariable ? "סכום משתנה" : fmtIls(item.amount)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          {isVariable ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">כמה שולם? *</div>
              <CurrencyInput value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" />
            </div>
          ) : null}
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
