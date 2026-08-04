"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/form-dialog";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import type { Reminder } from "@/lib/communications";
import { offlineFetch } from "@/lib/offline-queue";

// Convert a stored ISO timestamp to the local "YYYY-MM-DDTHH:mm" value that
// DateTimeInput expects, so an existing reminder's date AND hour prefill.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Reusable "edit reminder" — reschedule, edit content, and reassign (אחראי).
// Used wherever reminders are managed (collections list, per-customer panel).
export default function EditReminderDialog({
  reminder,
  open,
  onOpenChange,
  onSaved,
}: {
  reminder: Reminder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [remindAt, setRemindAt] = useState("");
  const [content, setContent] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !reminder) return;
    setRemindAt(reminder.remind_at ? toLocalInput(reminder.remind_at) : "");
    setContent(reminder.content ?? "");
    setAssignee(reminder.assigned_to ?? "");
    setError(null);
  }, [open, reminder]);

  async function save() {
    if (!reminder || submitting) return;
    if (!remindAt) {
      setError("יש לבחור תאריך ושעה.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await offlineFetch(
        "/api/reminders/update",
        {
          id: reminder.id,
          remind_at: new Date(remindAt).toISOString(),
          content: content.trim() || null,
          assigned_to: assignee || null,
        },
        "עדכון תזכורת"
      );
      if (result.queued) {
        onSaved();
        onOpenChange(false);
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "עדכון התזכורת נכשל."));
        return;
      }
      toast.success("התזכורת עודכנה.");
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(toHebrewError(err, "עדכון התזכורת נכשל."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="עריכת תזכורת"
      description="עדכון תאריך, תוכן ואחראי לתזכורת."
      size="formMd"
      onSubmit={() => void save()}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={submitting}
      error={error || undefined}
    >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">תאריך ושעה *</label>
            <DateTimeInput value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">תוכן</label>
            <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="אופציונלי" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">אחראי</label>
            <AssigneeSelect
              value={assignee}
              onChange={setAssignee}
              emptyLabel="ללא אחראי"
              currentLabel={reminder?.assigned_to_name ?? undefined}
            />
          </div>
        </div>
    </FormDialog>
  );
}
