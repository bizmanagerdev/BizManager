"use client";

import { useCallback, useMemo, useState } from "react";
import { CloseIcon, FilterIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import MarkPaidDialog, { type MarkPaidTarget } from "@/app/(app)/financial/payments-calendar/MarkPaidDialog";
import { ExpenseDialog } from "@/app/(app)/financial/payments-calendar/LazyExpenseDialog";
import { useRefreshAndWait } from "@/app/(app)/financial/payments-calendar/useRefreshAndWait";
import { DEBT_TIMING_LABEL, installmentLabel, totalDebts, type DebtItem, type ExpenseDebtLine } from "@/lib/debts";
import {
  TIMING_FILTER_OPTIONS,
  domainOptions,
  filterDebts,
  groupByKind,
  parseTimingFilter,
  type TimingFilter,
} from "./debts.helpers";
import { KindSection, type ExpenseLineActions } from "./DebtsList.ui";
import { formatIls } from "./shared";

// The חובות tab: what the business still owes that isn't a loan, grouped by
// kind — unpaid expenses, wages — most urgent first. Pay an expense right here
// (סמן כשולם, or edit it to record a partial payment); wages are paid on the
// worker's card, where the payment is allocated properly. Loans have their own
// tab.
export default function DebtsList({ items, todayIso }: { items: DebtItem[]; todayIso: string }) {
  const [timing, setTiming] = useState<TimingFilter>("all");
  const [domain, setDomain] = useState("all");
  const [search, setSearch] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [markTarget, setMarkTarget] = useState<MarkPaidTarget | null>(null);
  const [editing, setEditing] = useState<{ item: DebtItem; line: ExpenseDebtLine } | null>(null);
  // Dialogs stay busy until the list already shows the change (house rule for
  // payment dialogs) — then close.
  const { refreshAndWait } = useRefreshAndWait();

  const domains = useMemo(() => domainOptions(items), [items]);
  const filtered = useMemo(
    () => filterDebts(items, { timing, domain, search }, todayIso),
    [items, timing, domain, search, todayIso]
  );
  const groups = useMemo(() => groupByKind(filtered), [filtered]);
  const totals = useMemo(() => totalDebts(filtered, todayIso), [filtered, todayIso]);
  const filtersActive = timing !== "all" || domain !== "all";

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const actions = useMemo<ExpenseLineActions>(
    () => ({
      onMarkPaid: (item, line) =>
        setMarkTarget({
          id: `expense:${line.expenseId}`,
          label: [item.title, installmentLabel(line)].filter(Boolean).join(" — "),
          // What's left — a partly-paid bill is closed for its remainder.
          amount: line.open,
          variableAmount: false,
          expenseId: line.expenseId,
          recurringTemplateId: null,
          recurrenceKey: null,
          date: line.date,
        }),
      onEdit: (item, line) => setEditing({ item, line }),
    }),
    []
  );

  // On desktop the select stands alone, so its options say what they filter
  // ("הצג: באיחור"); in the phone panel a label above already does.
  const timingSelect = (className: string, prefixed: boolean) => (
    <NativeSelect dense value={timing} onChange={(e) => setTiming(parseTimingFilter(e.target.value))} className={className}>
      {TIMING_FILTER_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {prefixed ? `הצג: ${o.label}` : o.label}
        </option>
      ))}
    </NativeSelect>
  );
  const domainSelect = (className: string) =>
    domains.length > 1 ? (
      <NativeSelect dense value={domain} onChange={(e) => setDomain(e.target.value)} className={className}>
        <option value="all">כל התחומים</option>
        {domains.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </NativeSelect>
    ) : null;

  const editLine = editing?.line ?? null;

  return (
    <div className="space-y-4">
      {/* Totals first, right under the tab bar — the same spot as the חייבים list. */}
      {/* Each figure stays with its label when the line wraps on a phone; the
          separator leads the next figure so a line never ends on a stray dot. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="whitespace-nowrap">
          <span className="text-muted-foreground">{timing === "all" ? "סה״כ חובות" : `סה״כ ${DEBT_TIMING_LABEL[timing]}`}</span>{" "}
          <span className="font-semibold tabular-nums" dir="ltr">{formatIls(totals.open)}</span>
        </span>
        {timing === "all" ? (
          <>
            <span className="whitespace-nowrap">
              <span className="text-border">·</span> <span className="text-muted-foreground">באיחור</span>{" "}
              <span className="font-semibold tabular-nums text-destructive" dir="ltr">{formatIls(totals.overdue)}</span>
            </span>
            <span className="whitespace-nowrap">
              <span className="text-border">·</span> <span className="text-muted-foreground">{DEBT_TIMING_LABEL.soon}</span>{" "}
              <span className="font-semibold tabular-nums" dir="ltr">{formatIls(totals.soon)}</span>
            </span>
          </>
        ) : null}
      </div>

      {/* Desktop: search + the two filters on one row. */}
      <div className="hidden items-center gap-2 sm:flex sm:flex-wrap">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם, פרויקט או קטגוריה..."
          className="h-9 w-64"
        />
        {timingSelect("w-auto", true)}
        {domainSelect("w-auto")}
      </div>

      {/* Phone: search + a filter button whose panel opens OVER the list. */}
      <div className="relative sm:hidden">
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש..."
            className="h-9 flex-1"
          />
          <Button
            type="button"
            size="icon"
            variant={filtersActive ? "default" : "outline"}
            className="h-9 w-9 shrink-0"
            aria-label={mobileFiltersOpen ? "הסתרת סינון" : "סינון"}
            aria-expanded={mobileFiltersOpen}
            onClick={() => setMobileFiltersOpen((v) => !v)}
          >
            <FilterIcon className="h-4 w-4" />
          </Button>
        </div>
        {mobileFiltersOpen ? (
          <>
            <button
              type="button"
              aria-label="סגירת סינון"
              className="fixed inset-0 z-30 bg-black/30"
              onClick={() => setMobileFiltersOpen(false)}
            />
            <div className="absolute inset-x-0 top-full z-40 mt-2 grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">סינון</span>
                <button
                  type="button"
                  aria-label="סגירת סינון"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground"
                  onClick={() => setMobileFiltersOpen(false)}
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">מתי</label>
                <div className="mt-1">{timingSelect("w-full", false)}</div>
              </div>
              {domains.length > 1 ? (
                <div>
                  <label className="text-xs text-muted-foreground">תחום</label>
                  <div className="mt-1">{domainSelect("w-full")}</div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
          {items.length === 0 ? "אין חובות פתוחים — הכל שולם." : "אין חובות שתואמים לסינון."}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <KindSection
              key={group.kind}
              kind={group.kind}
              items={group.items}
              expanded={expanded}
              onToggle={toggle}
              actions={actions}
            />
          ))}
        </div>
      )}

      <MarkPaidDialog
        item={markTarget}
        onClose={() => setMarkTarget(null)}
        onSaved={async () => {
          await refreshAndWait();
          setMarkTarget(null);
        }}
      />

      {/* Edit the expense in place — the shared dialog, seeded the way the
          payments calendar seeds it. Recording a partial payment happens here
          (status "שולם חלקית" + how much). Its source stays locked. */}
      <ExpenseDialog
        open={Boolean(editing)}
        onOpenChange={(o: boolean) => {
          if (!o) setEditing(null);
        }}
        editingExpense={
          editLine
            ? {
                id: editLine.expenseId,
                amount: editLine.amount,
                category: editLine.category,
                description: editLine.description,
                notes: editLine.notes,
                expense_date: editLine.date,
                business_domain: editLine.businessDomain,
                payment_status: editLine.paymentStatus,
                paid_amount: editLine.paidAmount,
                payment_method: editLine.paymentMethod,
                paid_date: editLine.paidDate,
                account_id: editLine.accountId,
                project_id: editLine.projectId,
                order_id: editLine.orderId,
                property_id: editLine.propertyId,
              }
            : null
        }
        editingSourceLabel={editing?.item.link?.label ?? null}
        lockedProjectId={editLine?.projectId}
        lockedOrderId={editLine?.orderId}
        lockedPropertyId={editLine?.propertyId}
        onSaved={async () => {
          await refreshAndWait();
        }}
      />
    </div>
  );
}
