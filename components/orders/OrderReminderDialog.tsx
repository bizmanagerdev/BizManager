"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";

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
      toast.success("התזכורת נוספה.");
      onSaved?.();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(toHebrewError(err, "שמירה נכשלה."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="w-[calc(100vw-1rem)] max-w-md p-4 text-right sm:p-6">
        <DialogHeader>
          <DialogTitle>תזכורת להזמנה</DialogTitle>
          <DialogDescription>
            {orderLabel ? `הזמנה: ${orderLabel}` : "קביעת תזכורת מעקב להזמנה זו."}
          </DialogDescription>
        </DialogHeader>

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
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "שומר..." : "הוספת תזכורת"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
