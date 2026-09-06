"use client";

import { useEffect, useState } from "react";
import { NotificationIcon } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/form-dialog";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { registerReversibleCreate } from "@/lib/undo-engine";

// The entities a reminder can attach to. Each maps to its FK column + a category
// so a reminder set anywhere surfaces in the worklist / bell / push exactly like
// an order or task reminder does.
export type ReminderEntityType = "customer" | "order" | "project" | "property" | "payment" | "task" | "vehicle" | "invoice" | "expense";

const ENTITY_CONFIG: Record<ReminderEntityType, { fk: string; category: string; noun: string }> = {
  customer: { fk: "customer_id", category: "collection", noun: "לקוח" },
  order: { fk: "order_id", category: "order", noun: "הזמנה" },
  project: { fk: "project_id", category: "collection", noun: "פרויקט" },
  property: { fk: "property_id", category: "collection", noun: "נכס" },
  payment: { fk: "payment_id", category: "collection", noun: "תשלום" },
  task: { fk: "task_id", category: "task", noun: "משימה" },
  vehicle: { fk: "vehicle_id", category: "vehicle", noun: "רכב" },
  invoice: { fk: "invoice_id", category: "collection", noun: "חשבונית" },
  expense: { fk: "expense_id", category: "expense", noun: "הוצאה" },
};

/**
 * Universal "➕ תזכורת" button — drop it on any entity page (project, car,
 * invoice, order…) and it writes a reminder linked to that entity. Pass the
 * customer id too when known, so the reminder shows the customer in the worklist.
 */
export default function AddReminderButton({
  entityType,
  entityId,
  customerId,
  label,
  className,
  iconOnly = false,
  onSaved,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  entityType: ReminderEntityType;
  entityId: string;
  customerId?: string | null;
  label?: string | null;
  className?: string;
  iconOnly?: boolean;
  onSaved?: () => void;
  /** Render only the dialog — caller drives it via `open`/`onOpenChange` (e.g. from a "⋮" menu item). */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const cfg = ENTITY_CONFIG[entityType];
  const { currentUserId } = useAssignableUsers();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
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
      const payload: Record<string, unknown> = {
        [cfg.fk]: entityId,
        remind_at: new Date(remindAt).toISOString(),
        content: note.trim() || undefined,
        action_type: "other",
        category: cfg.category,
        assigned_to: assignee || undefined,
      };
      if (customerId && cfg.fk !== "customer_id") payload.customer_id = customerId;

      const result = await offlineFetch("/api/reminders/create", payload, `תזכורת ל${cfg.noun}`, { idempotent: true });
      if (result.queued) {
        onSaved?.();
        setOpen(false);
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "שמירה נכשלה."));
        return;
      }
      onSaved?.();
      setOpen(false);
      router.refresh();
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
            router.refresh();
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
    <>
      {!hideTrigger && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={className ?? (iconOnly ? "h-9 w-9 p-0" : "h-9")}
          title={`תזכורת ל${cfg.noun}`}
          aria-label={`תזכורת ל${cfg.noun}`}
          onClick={() => setOpen(true)}
        >
          <NotificationIcon className="h-4 w-4 text-warning" />
          {iconOnly ? null : <span className="ms-1">תזכורת</span>}
        </Button>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`תזכורת ל${cfg.noun}`}
        description={label ? `${cfg.noun}: ${label}` : `קביעת תזכורת מעקב ל${cfg.noun} זה.`}
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
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="אופציונלי" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">אחראי</label>
              <AssigneeSelect value={assignee} onChange={setAssignee} includeMeDefault />
            </div>
          </div>
      </FormDialog>
    </>
  );
}
