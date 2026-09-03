"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/form-dialog";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import type { Reminder } from "@/lib/communications";
import { offlineFetch } from "@/lib/offline-queue";
import { scheduleDeferredEdit } from "@/lib/undo-engine";

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
// Only mounted (by the caller) while there's a reminder to edit, so local
// state initializes fresh from `reminder` on every open — no prop-change reset effect.
export default function EditReminderDialog({
  reminder,
  onClose,
  onSaved,
}: {
  reminder: Reminder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [remindAt, setRemindAt] = useState(reminder.remind_at ? toLocalInput(reminder.remind_at) : "");
  const [content, setContent] = useState(reminder.content ?? "");
  const [assignee, setAssignee] = useState(reminder.assigned_to ?? "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!remindAt) {
      setError("יש לבחור תאריך ושעה.");
      return;
    }
    setError(null);
    const id = reminder.id;
    const remindIso = new Date(remindAt).toISOString();
    const snapshotContent = content.trim() || null;
    const snapshotAssignee = assignee || null;
    onClose();
    scheduleDeferredEdit({
      scope: "reminder",
      id,
      message: "התזכורת עודכנה.",
      patch: { remind_at: remindIso, content: snapshotContent, assigned_to: snapshotAssignee },
      onCommit: async () => {
        const result = await offlineFetch(
          "/api/reminders/update",
          { id, remind_at: remindIso, content: snapshotContent, assigned_to: snapshotAssignee },
          "עדכון תזכורת"
        );
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, "עדכון התזכורת נכשל.") };
        }
        onSaved();
        return { ok: true };
      },
    });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="עריכת תזכורת"
      description="עדכון תאריך, תוכן ואחראי לתזכורת."
      size="formMd"
      onSubmit={save}
      submitLabel="שמירה"
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
              currentLabel={reminder.assigned_to_name ?? undefined}
            />
          </div>
        </div>
    </FormDialog>
  );
}
