"use client";

import { useMemo, useState } from "react";
import ReminderFormDialog from "@/components/reminders/ReminderFormDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredDelete } from "@/lib/undo-engine";
import type { PaymentCalendarItem } from "@/lib/payables";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import { ExpenseDialog } from "./LazyExpenseDialog";
import { SplitPaymentDialog } from "./SplitPaymentDialog";
import MarkPaidDialog from "./MarkPaidDialog";
import MarkCollectedDialog from "./MarkCollectedDialog";
import { PaymentEditDialog } from "@/components/financial/PaymentEditDialog";
import { incomeReminderNoteFor, itemCapabilities, reminderNoteFor, type ItemActions, type MutateFn, type Option } from "./calendar.helpers";

// Delete an expense-origin payment row (e.g. an orphaned recurring bill left
// behind after its template was deleted). Real expenses only. Deferred: the
// row hides immediately (via the "payment-calendar-item" undo scope) and the
// real delete only fires if the toast's "בטל" isn't clicked in time.
function scheduleExpenseItemDelete(item: PaymentCalendarItem, onMutate: () => void) {
  if (!item.expenseId) return;
  scheduleDeferredDelete({
    scope: "payment-calendar-item",
    id: item.id,
    message: "התשלום נמחק",
    onCommit: async () => {
      try {
        const res = await fetch("/api/expenses/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: item.expenseId,
            project_id: item.expenseProjectId,
            order_id: item.expenseOrderId,
            property_id: item.expensePropertyId,
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: toHebrewError(json.error, "מחיקת התשלום נכשלה.") };
        }
        onMutate();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: toHebrewError(err, "מחיקת התשלום נכשלה.") };
      }
    },
  });
}

// ── Per-item actions + their dialogs (shared by every list of payments) ─────────
// Every action that changes data goes through `onMutate`, which resolves only
// once the board has re-rendered with fresh server data — so a dialog stays
// busy until its item has visibly moved (or gone), and the board then selects
// and flashes it wherever it landed.
export default function usePaymentItemActions({
  onMutate,
  templates,
  projects,
  properties,
  orders,
}: {
  onMutate: MutateFn;
  templates: RecurringExpenseTemplateItem[];
  projects: Option[];
  properties: Option[];
  orders: Option[];
}) {
  const [splitItem, setSplitItem] = useState<PaymentCalendarItem | null>(null);
  const [markItem, setMarkItem] = useState<PaymentCalendarItem | null>(null);
  const [collectItem, setCollectItem] = useState<PaymentCalendarItem | null>(null);
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [remindItem, setRemindItem] = useState<PaymentCalendarItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<PaymentCalendarItem | null>(null);
  const [editItem, setEditItem] = useState<PaymentCalendarItem | null>(null);
  const [editTemplate, setEditTemplate] = useState<RecurringExpenseTemplateItem | null>(null);

  // What each row allows is decided once, purely, in calendar.helpers; this
  // only hands those decisions their dialogs.
  const liveTemplateIds = useMemo(() => new Set(templates.map((t) => t.id)), [templates]);

  const actionsFor = (item: PaymentCalendarItem): ItemActions => {
    const can = itemCapabilities(item, liveTemplateIds);
    if (item.direction === "in") {
      return {
        onMarkPaid: () => setCollectItem(item),
        onSplit: () => {},
        onRemind: () => setRemindItem(item),
        // A real payments row edits through the shared editor (the same one the
        // חשבונות page uses — it loads its own context by id).
        ...(can.canEdit ? { onEdit: () => setEditPaymentId(item.paymentId ?? null), editLabel: "עריכה" } : {}),
      };
    }
    const template = can.editsTemplateId ? templates.find((t) => t.id === can.editsTemplateId) ?? null : null;
    return {
      onMarkPaid: () => setMarkItem(item),
      onSplit: () => setSplitItem(item),
      onRemind: () => setRemindItem(item),
      ...(can.canDelete ? { onDelete: () => setDeleteItem(item) } : {}),
      // A real expense row edits in place (the shared dialog, same as the
      // ledger). A forecast has no row yet, so "edit" is the recurring rule it
      // came from. Wages / loans / card charges edit on their own pages (למקור).
      ...(item.expenseId
        ? { onEdit: () => setEditItem(item), editLabel: "עריכה" }
        : template
          ? { onEdit: () => setEditTemplate(template), editLabel: "עריכת ההוצאה הקבועה" }
          : {}),
    };
  };

  const dialogs = (
    <>
      {/* Edit a real expense — the shared dialog, seeded exactly as the ledger
          seeds it. `dueDate` (expense_date), not `date`: a paid row's `date` is
          its paid_date, and saving that back would overwrite the schedule. */}
      <ExpenseDialog
        open={Boolean(editItem)}
        onOpenChange={(o: boolean) => {
          if (!o) setEditItem(null);
        }}
        editingExpense={
          editItem?.expenseId
            ? {
                id: editItem.expenseId,
                amount: editItem.amount,
                category: editItem.category,
                description: editItem.descriptionRaw,
                notes: editItem.notes,
                expense_date: editItem.dueDate,
                business_domain: editItem.businessDomain,
                payment_status: editItem.paymentStatus,
                paid_amount: editItem.paidAmount,
                payment_method: editItem.paymentMethod,
                paid_date: editItem.paidDate,
                account_id: editItem.accountId,
                project_id: editItem.expenseProjectId,
                order_id: editItem.expenseOrderId,
                property_id: editItem.expensePropertyId,
              }
            : null
        }
        editingSourceLabel={editItem?.sourceLabel ?? null}
        lockedProjectId={editItem?.expenseProjectId}
        lockedOrderId={editItem?.expenseOrderId}
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        // The dialog awaits this before closing, so it stays busy until the
        // board shows the row on its (possibly new) day.
        onSaved={(data: { expenseId?: string | null }) => onMutate({ expenseId: data.expenseId || editItem?.expenseId })}
      />

      {/* Edit the recurring rule behind a forecast item */}
      <ExpenseDialog
        open={Boolean(editTemplate)}
        onOpenChange={(o: boolean) => {
          if (!o) setEditTemplate(null);
        }}
        editingRecurringTemplate={editTemplate}
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        onSaved={() => onMutate()}
      />

      <SplitPaymentDialog
        open={Boolean(splitItem)}
        onOpenChange={(o) => {
          if (!o) setSplitItem(null);
        }}
        sourceItem={splitItem}
        onSaved={async () => {
          await onMutate({ id: splitItem?.id });
          setSplitItem(null);
        }}
      />

      <MarkPaidDialog
        item={markItem}
        onClose={() => setMarkItem(null)}
        onSaved={async ({ expenseId }) => {
          await onMutate({ expenseId });
          setMarkItem(null);
        }}
      />

      <MarkCollectedDialog
        item={collectItem}
        onClose={() => setCollectItem(null)}
        onSaved={async ({ id }) => {
          await onMutate({ id });
          setCollectItem(null);
        }}
      />

      {/* Edit an incoming payment row — amount, date, method, account, check
          number. Self-loading by id, so nothing has to be seeded here. */}
      <PaymentEditDialog
        paymentId={editPaymentId}
        onOpenChange={(open) => {
          if (!open) setEditPaymentId(null);
        }}
        onSaved={() => {
          const id = editPaymentId;
          setEditPaymentId(null);
          void onMutate(id ? { id: `payment:${id}` } : undefined);
        }}
      />

      <ReminderFormDialog
        mode="create"
        open={Boolean(remindItem)}
        onOpenChange={(o) => {
          if (!o) setRemindItem(null);
        }}
        category="task"
        links={
          remindItem?.expenseId
            ? { expense_id: remindItem.expenseId }
            : remindItem?.customerId
              ? { customer_id: remindItem.customerId }
              : {}
        }
        defaultNote={
          remindItem
            ? remindItem.direction === "in"
              ? incomeReminderNoteFor(remindItem)
              : reminderNoteFor(remindItem)
            : undefined
        }
        onSaved={() => setRemindItem(null)}
      />

      {/* Delete this expense (e.g. an orphaned recurring bill) — deferred with undo */}
      <ConfirmDialog
        open={Boolean(deleteItem)}
        onOpenChange={(o) => {
          if (!o) setDeleteItem(null);
        }}
        title="מחיקת תשלום"
        description={deleteItem ? `למחוק את "${deleteItem.label}"?` : ""}
        confirmLabel="מחיקה"
        destructive
        onConfirm={() => {
          if (!deleteItem) return;
          const target = deleteItem;
          setDeleteItem(null);
          scheduleExpenseItemDelete(target, () => {
            void onMutate();
          });
        }}
      />
    </>
  );

  return { actionsFor, dialogs };
}
