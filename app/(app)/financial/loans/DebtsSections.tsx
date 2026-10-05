"use client";

import { useCallback, useMemo, useState } from "react";
import MarkPaidDialog, { type MarkPaidTarget } from "@/app/(app)/financial/payments-calendar/MarkPaidDialog";
import { ExpenseDialog } from "@/app/(app)/financial/payments-calendar/LazyExpenseDialog";
import { useRefreshAndWait } from "@/app/(app)/financial/payments-calendar/useRefreshAndWait";
import { installmentLabel, type DebtItem, type ExpenseDebtLine } from "@/lib/debts";
import { groupByKind } from "./debts.helpers";
import { KindSection, type ExpenseLineActions } from "./DebtsList.ui";

// A list of debts grouped by kind (unpaid expenses, wages, loans), each one
// opening to its details, with the expense actions working in place: סמן כשולם,
// or edit the expense to record a partial payment. Wages and loans are paid on
// their own pages, where the payment is allocated properly. Used by the חובות
// tab, and by the דוח tab under the summary card that was tapped.
export default function DebtsSections({ items, emptyMessage }: { items: DebtItem[]; emptyMessage: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [markTarget, setMarkTarget] = useState<MarkPaidTarget | null>(null);
  const [editing, setEditing] = useState<{ item: DebtItem; line: ExpenseDebtLine } | null>(null);
  // Dialogs stay busy until the list already shows the change (house rule for
  // payment dialogs) — then close.
  const { refreshAndWait } = useRefreshAndWait();

  const groups = useMemo(() => groupByKind(items), [items]);

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

  const editLine = editing?.line ?? null;

  return (
    <>
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
          {emptyMessage}
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
    </>
  );
}
