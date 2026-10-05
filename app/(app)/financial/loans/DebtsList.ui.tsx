"use client";

// Presentational pieces of the חובות list. No data logic lives here (that's
// lib/debts.ts + debts.helpers.ts); these render an item and call back. Same
// shapes as the collections (חייבים) page — its mirror image: a desktop table
// with expandable rows, phone cards that open on tap.

import { memo, type ReactNode } from "react";
import { BankIcon, CheckIcon, ChevronDownIcon, ExpenseIcon, ExternalLinkIcon, LaborIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/ui/icon-button";
import { NavLink } from "@/components/NavLink";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { formatShortDate } from "@/lib/date";
import { clickableRowProps } from "@/lib/ui/row-navigation";
import {
  DEBT_KIND_LABEL,
  installmentLabel,
  type DebtItem,
  type DebtKind,
  type DebtTiming,
  type ExpenseDebtLine,
} from "@/lib/debts";
import { formatIls } from "./shared";

export const KIND_ICON: Record<DebtKind, IconComponent> = {
  expense: ExpenseIcon,
  wages: LaborIcon,
  loan: BankIcon,
};

const TIMING_BADGE: Record<DebtTiming, { label: string; variant: "destructive" | "warning" | "neutral" }> = {
  overdue: { label: "באיחור", variant: "destructive" },
  soon: { label: "בקרוב", variant: "warning" },
  later: { label: "בהמשך", variant: "neutral" },
  undated: { label: "ללא תאריך", variant: "neutral" },
};

export function TimingBadge({ timing, className }: { timing: DebtTiming; className?: string }) {
  const badge = TIMING_BADGE[timing];
  return (
    <Badge variant={badge.variant} className={className}>
      {badge.label}
    </Badge>
  );
}

/** "12/09/26" and, when late, "23 ימים באיחור" under it. */
function DueText({ date, daysLate, compact = false }: { date: string | null; daysLate: number; compact?: boolean }) {
  if (!date) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className={compact ? "text-xs" : undefined}>
      <span className={daysLate > 0 ? "font-medium text-destructive" : "text-muted-foreground"}>{formatShortDate(date)}</span>
      {daysLate > 0 ? <span className="block text-[11px] text-destructive">{daysLate} ימים באיחור</span> : null}
    </span>
  );
}

/** What's left, and — once something was paid — what it was out of. */
function OpenAmount({ item, large = false }: { item: Pick<DebtItem, "open" | "paid" | "total">; large?: boolean }) {
  return (
    <span className="inline-flex flex-col items-end">
      <span className={(large ? "text-lg " : "") + "font-semibold tabular-nums"} dir="ltr">
        {formatIls(item.open)}
      </span>
      {item.paid > 0.009 && item.total > item.open + 0.009 ? (
        <span className="text-[11px] text-muted-foreground">
          שולם {formatIls(item.paid)} מתוך {formatIls(item.total)}
        </span>
      ) : null}
    </span>
  );
}

function SourceLink({ item }: { item: DebtItem }) {
  if (!item.link) return <span className="text-muted-foreground/60">—</span>;
  return (
    <NavLink to={item.link.href} className="text-primary hover:underline">
      {item.link.label}
    </NavLink>
  );
}

export type ExpenseLineActions = {
  onMarkPaid: (item: DebtItem, line: ExpenseDebtLine) => void;
  onEdit: (item: DebtItem, line: ExpenseDebtLine) => void;
};

// Row actions are the quiet outline style (as on the collections list) — the
// bold fill is kept for a page's main action, not repeated on every row.
const ROW_ACTION = "h-8 px-2.5 text-xs";

function ExpenseLineButtons({
  item,
  line,
  actions,
}: {
  item: DebtItem;
  line: ExpenseDebtLine;
  actions: ExpenseLineActions;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={ROW_ACTION}
        onClick={() => actions.onMarkPaid(item, line)}
      >
        <CheckIcon className="h-3.5 w-3.5" />
        סמן כשולם
      </Button>
      <EditButton onClick={() => actions.onEdit(item, line)} label="עריכת ההוצאה" />
    </div>
  );
}

/** The one-line action a debt offers (or nothing, when its lines carry the actions). */
function ItemPrimaryAction({ item, actions }: { item: DebtItem; actions: ExpenseLineActions }) {
  if (item.kind === "expense") {
    const lines = item.expenseLines ?? [];
    return lines.length === 1 ? <ExpenseLineButtons item={item} line={lines[0]} actions={actions} /> : null;
  }
  if (item.kind === "wages" && item.link) {
    // Wages are paid from the worker's card, where the payment is allocated to shifts/payslips.
    return (
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline" className={ROW_ACTION}>
          <NavLink to={item.link.href}>לתשלום</NavLink>
        </Button>
      </div>
    );
  }
  if (item.kind === "loan" && item.link) {
    // Loans show in the דוח tab's lists (the חובות tab leaves them to their own tab).
    return (
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline" className={ROW_ACTION}>
          <NavLink to={item.link.href}>רישום החזר</NavLink>
        </Button>
      </div>
    );
  }
  return null;
}

export function isExpandable(item: DebtItem): boolean {
  if (item.kind === "expense") return (item.expenseLines?.length ?? 0) > 1;
  if (item.kind === "wages") return (item.wageLines?.length ?? 0) > 0;
  return item.parts.length > 1;
}

/** What opens under an item: its installments, a worker's shifts/payslips, a loan's plan. */
export function ItemDetail({ item, actions }: { item: DebtItem; actions: ExpenseLineActions }) {
  if (item.kind === "expense") {
    return (
      <div className="space-y-1.5">
        {(item.expenseLines ?? []).map((line) => (
          <div
            key={line.expenseId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/60 px-2.5 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={line.timing === "overdue" ? "font-medium text-destructive" : "text-muted-foreground"}>
                {formatShortDate(line.date)}
              </span>
              {installmentLabel(line) ? <span>{installmentLabel(line)}</span> : null}
              {line.paymentStatus === "partial" ? (
                <span className="text-xs text-muted-foreground">
                  שולם {formatIls(line.paid)} מתוך {formatIls(line.amount)}
                </span>
              ) : null}
              <span className="font-semibold tabular-nums" dir="ltr">{formatIls(line.open)}</span>
            </div>
            <ExpenseLineButtons item={item} line={line} actions={actions} />
          </div>
        ))}
      </div>
    );
  }
  if (item.kind === "wages") {
    return (
      <div className="space-y-1.5">
        {(item.wageLines ?? []).map((line) => (
          <div
            key={line.key}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/60 px-2.5 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{line.label}</span>
              {line.projectId ? (
                <NavLink to={`/projects/${line.projectId}`} className="text-xs text-primary hover:underline">
                  {line.projectName ?? "פרויקט"}
                </NavLink>
              ) : null}
              <span className="text-xs text-muted-foreground">לתשלום עד {line.date ? formatShortDate(line.date) : "—"}</span>
            </div>
            <span className="font-semibold tabular-nums" dir="ltr">{formatIls(line.open)}</span>
          </div>
        ))}
        {item.unallocatedCredit && item.unallocatedCredit > 0.009 ? (
          <div className="flex items-center justify-between gap-2 px-2.5 text-xs text-muted-foreground">
            <span>תשלום לעובד שעוד לא שויך למשמרת/משכורת (קוזז מהישנים ביותר)</span>
            <span className="tabular-nums" dir="ltr">−{formatIls(item.unallocatedCredit)}</span>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {item.parts.map((part, index) => (
        <div
          key={`${part.date ?? "none"}-${index}`}
          className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/60 px-2.5 py-2 text-sm"
        >
          <span className="text-muted-foreground">{part.date ? `החזר ב-${formatShortDate(part.date)}` : "ללא מועד פירעון"}</span>
          <span className="font-semibold tabular-nums" dir="ltr">{formatIls(part.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Desktop ─────────────────────────────────────────────────────────────────

const DebtRow = memo(function DebtRow({
  item,
  isOpen,
  onToggle,
  actions,
}: {
  item: DebtItem;
  isOpen: boolean;
  onToggle: (key: string) => void;
  actions: ExpenseLineActions;
}) {
  const expandable = isExpandable(item);
  const tint = item.timing === "overdue" ? "bg-destructive/[0.03]" : "";
  return (
    <>
      <tr data-focus-id={item.key} className={`border-b border-border/50 align-top hover:bg-muted/30 ${tint}`}>
        <td className="px-3 py-2.5">
          {expandable ? (
            <button
              type="button"
              onClick={() => onToggle(item.key)}
              aria-expanded={isOpen}
              className="flex items-start gap-1 text-right hover:underline"
            >
              <ChevronDownIcon
                className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
              <span className="font-medium">{item.title}</span>
            </button>
          ) : (
            <span className="font-medium">{item.title}</span>
          )}
          {item.subtitle ? <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.subtitle}</div> : null}
        </td>
        <td className="px-3 py-2.5">
          <SourceLink item={item} />
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <DueText date={item.dueDate} daysLate={item.daysLate} />
        </td>
        <td className="px-3 py-2.5">
          <TimingBadge timing={item.timing} />
        </td>
        <td className="px-3 py-2.5 text-end">
          <OpenAmount item={item} />
        </td>
        <td className="px-2 py-2.5">
          <ItemPrimaryAction item={item} actions={actions} />
        </td>
      </tr>
      {expandable && isOpen ? (
        <tr className="border-b border-border/50 bg-muted/10">
          <td colSpan={6} className="px-3 py-3">
            <ItemDetail item={item} actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
});
DebtRow.displayName = "DebtRow";

// ── Phone ───────────────────────────────────────────────────────────────────

const DebtCard = memo(function DebtCard({
  item,
  isOpen,
  onToggle,
  actions,
}: {
  item: DebtItem;
  isOpen: boolean;
  onToggle: (key: string) => void;
  actions: ExpenseLineActions;
}) {
  const tint = item.timing === "overdue" ? "bg-destructive/[0.03]" : "bg-background/60";
  return (
    <div data-focus-id={item.key} className={`rounded-2xl border border-border/70 p-3 ${tint}`}>
      {/* Default role on purpose: the helper skips clicks on [role="button"]
          elements, which would include this card itself. */}
      <div className="flex cursor-pointer items-start justify-between gap-2 text-right" {...clickableRowProps(() => onToggle(item.key))}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ChevronDownIcon
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
            <span className="font-semibold">{item.title}</span>
          </div>
          {item.subtitle ? <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.subtitle}</div> : null}
          {item.link ? (
            <NavLink to={item.link.href} className="mt-1 inline-block text-xs text-primary hover:underline">
              {item.link.label}
            </NavLink>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <OpenAmount item={item} large />
          <TimingBadge timing={item.timing} />
          {item.dueDate ? (
            <span className={`text-xs ${item.daysLate > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}>
              {item.daysLate > 0 ? `${item.daysLate} ימים באיחור` : formatShortDate(item.dueDate)}
            </span>
          ) : null}
        </div>
      </div>
      {isOpen ? (
        <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
          {isExpandable(item) ? <ItemDetail item={item} actions={actions} /> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ItemPrimaryAction item={item} actions={actions} />
            {item.link ? (
              <Button asChild size="sm" variant="ghost" className={ROW_ACTION}>
                <NavLink to={item.link.href}>
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                  למקור
                </NavLink>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
DebtCard.displayName = "DebtCard";

// ── One kind (הוצאות / שכר / הלוואות) ────────────────────────────────────────

export function KindSection({
  kind,
  items,
  expanded,
  onToggle,
  actions,
  headerAside,
}: {
  kind: DebtKind;
  items: DebtItem[];
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  actions: ExpenseLineActions;
  headerAside?: ReactNode;
}) {
  const Icon = KIND_ICON[kind];
  const total = items.reduce((sum, item) => sum + item.open, 0);
  const overdue = items.filter((i) => i.timing === "overdue").length;
  return (
    <section aria-label={DEBT_KIND_LABEL[kind]} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{DEBT_KIND_LABEL[kind]}</h2>
          <Badge variant="neutral" className="px-2 py-0 text-[11px]">{items.length}</Badge>
          {overdue > 0 ? (
            <span className="text-xs font-medium text-destructive">{overdue} באיחור</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-sm">
          {headerAside}
          <span className="text-muted-foreground">סה״כ</span>
          <span className="font-semibold tabular-nums" dir="ltr">{formatIls(total)}</span>
        </div>
      </div>
      <ResponsiveDataView
        breakpoint="md"
        desktop={
          <div className="overflow-auto rounded-2xl border border-border/70">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="bg-muted">
                <tr className="border-b border-border/70 text-xs text-muted-foreground">
                  <th className="w-[30%] px-3 py-2 text-right font-medium">פריט</th>
                  <th className="px-3 py-2 text-right font-medium">שייך ל</th>
                  <th className="px-3 py-2 text-right font-medium">מועד</th>
                  <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                  <th className="px-3 py-2 text-end font-medium">נשאר לשלם</th>
                  <th className="px-2 py-2 text-end font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <DebtRow key={item.key} item={item} isOpen={expanded.has(item.key)} onToggle={onToggle} actions={actions} />
                ))}
              </tbody>
            </table>
          </div>
        }
        mobile={
          <div className="space-y-2">
            {items.map((item) => (
              <DebtCard key={item.key} item={item} isOpen={expanded.has(item.key)} onToggle={onToggle} actions={actions} />
            ))}
          </div>
        }
      />
    </section>
  );
}
