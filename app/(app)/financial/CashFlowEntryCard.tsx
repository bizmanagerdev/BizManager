"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { SuccessIcon } from "@/components/ui/icons";
import { DeleteButton, EditButton, IconButton } from "@/components/ui/icon-button";
import { formatEnteredLabel, formatRelativeDateLabel, formatShortDate, formatShortDateTime } from "@/lib/date";
import type { FinancialEntry } from "@/lib/financial";
import { formatCurrencyAmount, formatShekelNote } from "@/lib/money";
import { isCancelledRecurringMonth } from "@/lib/recurring/cancelMonth";
import { cn } from "@/lib/utils";
import { stageLabel, stageVariant, typeAmountClass, typeLabel, typeVariant } from "./FinancialPage.ui";

export type EditableExpenseEntry = FinancialEntry & {
  origin: "expense";
  expenseId: string;
  expenseCategory: string | null;
  expenseDescriptionRaw?: string | null;
  expenseNotes: string | null;
  expenseProjectId: string | null;
  expenseOrderId: string | null;
  expensePropertyId: string | null;
};

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

/** Under a row's US$ or C$: its shekels, which every total here counts. */
export function ShekelNote({ shekels, paint }: { shekels: number; paint: (text: string) => ReactNode }) {
  return <span className="block text-[11px] font-normal text-muted-foreground">{paint(formatShekelNote(shekels))}</span>;
}

export function isEditableExpenseEntry(entry: FinancialEntry): entry is EditableExpenseEntry {
  return entry.origin === "expense" && typeof entry.expenseId === "string" && entry.expenseId.length > 0;
}

// The status chip on an expense row; a cancelled month reads בוטל, not ₪0 שולם.
export function expenseStatusChip(entry: FinancialEntry): { label: string; tone: string } {
  const status = entry.paymentStatus ?? "not_paid";
  if (isCancelledRecurringMonth({ recurringTemplateId: entry.expenseRecurringTemplateId, paymentStatus: status, amount: entry.amount })) {
    return { label: "בוטל", tone: "border-border bg-muted text-muted-foreground" };
  }
  if (status === "paid") return { label: "שולם", tone: "border-success/40 bg-success/10 text-success" };
  if (status === "partial") return { label: "חלקית", tone: "border-warning/40 bg-warning/15 text-warning-strong" };
  return { label: "לא שולם", tone: "border-destructive/40 bg-destructive/10 text-destructive" };
}

// Who put this row in: a person, or the recurring rule that generated it (a
// generated bill carries no recordedByName — see buildExpenseEntries) — and
// when, from the row's created_at (owner, 2026-10-15: "see exactly when things
// happen"). The row's own date stays the day the money moved.
export function recordedByLabel(entry: FinancialEntry): string | null {
  if (!entry.recordedByName && entry.expenseRecurringTemplateId) {
    const when = formatShortDateTime(entry.createdAt, "");
    return when ? `נוצר אוטומטית · ${when}` : "נוצר אוטומטית";
  }
  return formatEnteredLabel(entry.recordedByName, entry.createdAt);
}

function paidDetails(entry: FinancialEntry): string | null {
  const status = entry.paymentStatus ?? "not_paid";
  if (status !== "paid" && status !== "partial") return null;
  const methodLabel = entry.expensePaymentMethod === "bank_transfer" ? "העברה בנקאית"
    : entry.expensePaymentMethod === "cash" ? "מזומן"
    : entry.expensePaymentMethod === "check" ? "צ'ק"
    : entry.expensePaymentMethod === "credit_card" ? "כרטיס אשראי"
    : entry.expensePaymentMethod === "other" ? "אחר" : null;
  const parts: string[] = [];
  if (status === "partial" && entry.expensePaidAmount != null && entry.expensePaidAmount > 0) parts.push(`שולם ${formatCurrency(entry.expensePaidAmount)}`);
  if (methodLabel) parts.push(methodLabel);
  return parts.length ? parts.join(" • ") : null;
}

/**
 * One row of the יומן מלא or the תזרים עתידי as a card: the phone's list, and
 * wherever the table doesn't fit (CASH_FLOW_LISTS). What the table's row says —
 * and its actions on an expense, marking it paid too: the table had the ✓ and
 * the cards didn't, so a bill couldn't be marked paid from a phone.
 */
export function CashFlowEntryCard({
  entry,
  todayIso,
  paint,
  reasons,
  showDueDate = false,
  canManage,
  onOpen,
  onMarkPaid,
  onEdit,
  onDelete,
}: {
  entry: FinancialEntry;
  todayIso: string;
  /** Marks the search's words in a text. */
  paint: (text: string | null | undefined) => ReactNode;
  /** Where the search matched, for what the card doesn't show. */
  reasons?: ReactNode;
  /** The upcoming list: the due date, when it isn't the row's own. */
  showDueDate?: boolean;
  canManage: boolean;
  onOpen: () => void;
  onMarkPaid: (entry: EditableExpenseEntry) => void;
  onEdit: (entry: EditableExpenseEntry) => void;
  onDelete: (entry: EditableExpenseEntry) => void;
}) {
  const editable = canManage && isEditableExpenseEntry(entry) ? entry : null;
  const dueDate = showDueDate && entry.dueDate && entry.dueDate !== entry.flowDate ? entry.dueDate : null;
  const paid = paidDetails(entry);
  return (
    <article
      data-focus-id={entry.id}
      className={cn("rounded-2xl border p-4 text-right", entry.sourceHref ? "cursor-pointer transition-colors hover:bg-muted/30" : "")}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3 sm:flex-row-reverse">
        <div className="space-y-1">
          <div dir="ltr" className="text-sm font-medium tabular-nums">{paint(formatShortDate(entry.flowDate))}</div>
          <div className="text-xs text-muted-foreground">{formatRelativeDateLabel(entry.flowDate, "-", todayIso)}</div>
          {dueDate ? (
            <div className="text-xs text-muted-foreground">
              פירעון <span dir="ltr" className="tabular-nums">{formatShortDate(dueDate)}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={typeVariant(entry.type)}>{typeLabel(entry.type)}</Badge>
          <Badge variant={stageVariant(entry.stage)}>{stageLabel(entry.stage)}</Badge>
        </div>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        <div className="font-medium">{paint(entry.description)}</div>
        {reasons}
        <div className="text-muted-foreground">{paint(entry.domainName)}</div>
        <div className="text-muted-foreground">
          {entry.sourceHref ? (
            <Link
              href={entry.sourceHref}
              className="transition-colors hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                emitNavigationStart();
              }}
            >
              <span dir="auto">{paint(entry.sourceLabel)}</span>
            </Link>
          ) : (
            <span dir="auto">{paint(entry.sourceLabel)}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {entry.paymentMethodLabel ? <span>{paint(entry.paymentMethodLabel)}</span> : null}
          {entry.reference ? <span>{paint(entry.reference)}</span> : null}
          {recordedByLabel(entry) ? <span>{paint(recordedByLabel(entry))}</span> : null}
          {entry.origin === "expense" ? (
            <>
              <span className={cn("rounded-full border px-2 py-0.5 font-medium", expenseStatusChip(entry).tone)}>
                {expenseStatusChip(entry).label}
              </span>
              {paid ? <span>{paid}</span> : null}
            </>
          ) : null}
        </div>
        <div dir="ltr" className={cn("font-semibold tabular-nums", typeAmountClass(entry.type))}>
          {entry.type === "inflow" ? "+" : "-"}
          {paint(entry.foreign ? formatCurrencyAmount(entry.foreign.amount, entry.foreign.currency) : formatCurrency(entry.amount))}
          {entry.foreign ? <ShekelNote shekels={entry.amount} paint={paint} /> : null}
        </div>
        {editable ? (
          <div className="flex justify-end gap-2 pt-1">
            {(editable.paymentStatus ?? "not_paid") !== "paid" ? (
              // Outlined like edit and delete beside it, in the ✓'s green.
              <IconButton
                icon={SuccessIcon}
                label="סמן כשולם"
                variant="ghost"
                className="border-success bg-transparent text-success shadow-none hover:bg-success/10 hover:text-success"
                onClick={(event) => {
                  event.stopPropagation();
                  onMarkPaid(editable);
                }}
              />
            ) : null}
            <EditButton
              onClick={(event) => {
                event.stopPropagation();
                onEdit(editable);
              }}
              label="עריכה"
            />
            <DeleteButton
              onClick={(event) => {
                event.stopPropagation();
                onDelete(editable);
              }}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
