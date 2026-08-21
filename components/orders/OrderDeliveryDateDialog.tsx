"use client";

// The calendar's "משלוחים" quick-create — unlike every other quick-create
// dialog, this one doesn't CREATE a record: it picks an ALREADY-EXISTING order
// and sets (or changes) the date the customer wants it delivered, and who
// besides the creator/office/admin should see it on their own calendar.
// Deliberately not the order wizard and not the update_sales_order RPC — both
// would touch far more than the one date this needs.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { getTodayDate } from "@/app/(app)/dashboard/DashboardActions.helpers";
import type { EntityOption, UserOption } from "@/app/(app)/dashboard/quick-actions-types";

// A delivery date on one of these is moot — the order is already done or dead.
// Same list projectSchedule.ts filters the calendar's delivery feed by.
const CLOSED_ORDER_STATUSES = new Set([
  "delivered",
  "completed",
  "closed",
  "cancelled",
  "סופקה",
  "הושלמה",
  "סגורה",
  "בוטלה",
]);

export function OrderDeliveryDateDialog({
  open,
  onOpenChange,
  onSaved,
  orders,
  users,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** The recent-orders list already fetched for the + menu (quick-actions-data.ts). */
  orders: EntityOption[];
  /** Everyone selectable as a recipient — already fetched for the + menu. */
  users: UserOption[];
  /** The day the user clicked "הוספה ליום זה" on, if any — YYYY-MM-DD. */
  defaultDate?: string;
}) {
  const [orderId, setOrderId] = useState("");
  const [date, setDate] = useState(defaultDate || getTodayDate());
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync every time the dialog opens — a different day's "add" click sends a
  // different defaultDate, and the previous order/recipients shouldn't linger.
  useEffect(() => {
    if (!open) return;
    setOrderId("");
    setDate(defaultDate || getTodayDate());
    setRecipientIds([]);
    setError(null);
  }, [open, defaultDate]);

  const orderOptions = orders
    .filter((order) => !CLOSED_ORDER_STATUSES.has((order.subtitle ?? "").split(" · ")[0]))
    .map((order) => ({ value: order.id, label: order.name, hint: order.subtitle }));

  // worker_no_access can't load any page (requireProfile.ts) — offering them
  // as a recipient would be a dead option, they'd never see it either way.
  const recipientOptions = users.filter((user) => user.role !== "worker_no_access");

  function toggleRecipient(id: string) {
    setRecipientIds((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));
  }

  async function save() {
    setError(null);
    if (!orderId) {
      setError("יש לבחור הזמנה.");
      return;
    }
    if (!date) {
      setError("יש לבחור תאריך.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/orders/requested-delivery-date",
        { order_id: orderId, requested_delivery_date: date, recipient_user_ids: recipientIds },
        "תאריך משלוח",
        { idempotent: true }
      );
      if (result.queued) {
        onOpenChange(false);
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "עדכון תאריך המשלוח נכשל."));
        return;
      }
      onOpenChange(false);
      onSaved?.();
      toast.success("תאריך המשלוח נשמר.");
    } catch (err: unknown) {
      setError(toHebrewError(err, "עדכון תאריך המשלוח נכשל."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="תאריך משלוח"
      description="בחרו הזמנה קיימת וקבעו לה תאריך אספקה מבוקש — התאריך יופיע ביומן."
      onSubmit={() => void save()}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={submitting}
      submitDisabled={!orderId || !date}
      error={error || undefined}
    >
      <div className="space-y-4">
        <div className="space-y-2 text-right text-sm">
          <span className="font-medium">הזמנה *</span>
          {orderOptions.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 p-3 text-muted-foreground">
              אין כרגע הזמנות פתוחות לבחירה.
            </div>
          ) : (
            <SearchableSelect
              ariaLabel="בחירת הזמנה"
              placeholder="בחרו הזמנה"
              searchPlaceholder="חיפוש לפי שם לקוח..."
              options={orderOptions}
              value={orderId}
              onChange={setOrderId}
            />
          )}
        </div>

        <label className="space-y-2 text-right text-sm">
          <span className="font-medium">תאריך אספקה *</span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {recipientOptions.length > 0 ? (
          <div className="space-y-2 text-right text-sm">
            <span className="font-medium">מי צריך לראות את זה ביומן שלו? (אופציונלי)</span>
            <p className="text-xs text-muted-foreground">
              בברירת מחדל זה מופיע רק אצלכם ואצל המשרד. אפשר גם להציג את זה אצל אנשים ספציפיים.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {recipientOptions.map((user) => {
                const selected = recipientIds.includes(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => toggleRecipient(user.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      selected
                        ? "border-secondary bg-secondary/10 text-secondary"
                        : "border-border bg-background text-muted-foreground hover:bg-secondary/5"
                    }`}
                  >
                    {user.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </FormDialog>
  );
}

export default OrderDeliveryDateDialog;
