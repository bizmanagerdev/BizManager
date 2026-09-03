"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/form-dialog";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { registerReversibleCreate } from "@/lib/undo-engine";

// Create a follow-up reminder attached to an order. Writes to the shared
// `reminders` table (order_id set, category "order") via /api/reminders/create,
// so it surfaces in the dashboard reminders panel and fires a push at remind_at —
// exactly like task/collection reminders.
export default function OrderReminderDialog({
  orderId,
  customerId,
  orderLabel,
  open,
  onOpenChange,
  onSaved,
}: {
  orderId: string;
  customerId?: string | null;
  orderLabel?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { currentUserId } = useAssignableUsers();
  const [remindAt, setRemindAt] = useState("");
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRemindAt("");
    setNote("");
    setAssignee(currentUserId ?? "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default the assignee to the current user once the list resolves.
  useEffect(() => {
    if (open && currentUserId) setAssignee((prev) => prev || currentUserId);
  }, [open, currentUserId]);

  async function submit() {
    if (submitting) return;
    setError(null);
    if (!remindAt) {
      setError("יש לבחור תאריך ושעה לתזכורת.");
      return;
    }
    setSubmitting(true);
    try {
      const remindIso = new Date(remindAt).toISOString();
      const result = await offlineFetch(
        "/api/reminders/create",
        {
          order_id: orderId,
          customer_id: customerId || undefined,
          remind_at: remindIso,
          content: note.trim() || undefined,
          action_type: "other",
          category: "order",
          assigned_to: assignee || undefined,
        },
        "תזכורת להזמנה",
        { idempotent: true }
      );
      if (result.queued) {
        onSaved?.();
        onOpenChange(false);
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "שמירה נכשלה."));
        return;
      }
      onSaved?.();
      onOpenChange(false);
      const newId = (result.data as { id?: string | null } | null)?.id;
      if (!newId) {
        toast.success("התזכורת נוספה.");
      } else {
        registerReversibleCreate({
          scope: "reminder",
          id: newId,
          message: "התזכורת נוספה.",
          onUndo: async () => {
            const res = await fetch("/api/reminders/update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: newId, status: "cancelled" }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "ביטול נכשל.") };
            return { ok: true };
          },
        });
      }
    } catch (err: unknown) {
      setError(toHebrewError(err, "שמירה נכשלה."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="תזכורת להזמנה"
      description={orderLabel ? `הזמנה: ${orderLabel}` : "קביעת תזכורת מעקב להזמנה זו."}
      size="formMd"
      onSubmit={() => void submit()}
      submitLabel="הוספת תזכורת"
      busyLabel="שומר..."
      busy={submitting}
      error={error || undefined}
    >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">מתי להזכיר? *</label>
            <Input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">על מה להזכיר?</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="אופציונלי"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">אחראי</label>
            <AssigneeSelect value={assignee} onChange={setAssignee} includeMeDefault />
          </div>
        </div>
    </FormDialog>
  );
}
