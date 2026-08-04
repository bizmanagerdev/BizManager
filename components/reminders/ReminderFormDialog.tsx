"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { DateTimeInput } from "@/components/ui/date-input";
import { FormDialog } from "@/components/ui/form-dialog";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { toHebrewError } from "@/lib/error-messages";

// One dialog for BOTH creating and editing a reminder — reused across the order
// panel, the worklist, and anywhere else. Create posts to /api/reminders/create
// with the entity links; edit posts to /api/reminders/update by id.
export type ReminderFormValue = {
  id: string;
  remindAt: string | null;
  content: string | null;
  assignedTo: string | null;
};

// ISO → value for <input type="datetime-local"> in the viewer's local time.
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ReminderFormDialog({
  mode,
  open,
  onOpenChange,
  onSaved,
  value,
  links,
  category = "order",
  defaultNote,
  defaultRemindAt,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** The reminder being edited (edit mode). */
  value?: ReminderFormValue;
  /** Entity links to attach on create, e.g. { order_id, customer_id }. */
  links?: Record<string, string | null | undefined>;
  category?: string;
  /** Pre-fill the note on create (e.g. the payment description). */
  defaultNote?: string;
  /** Pre-fill the remind date/time on create (e.g. a calendar day). */
  defaultRemindAt?: string;
}) {
  const { currentUserId } = useAssignableUsers();
  const [remindAt, setRemindAt] = useState("");
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  // When the date is already chosen (opened from the calendar), land on the note
  // field so the user just types what to be reminded about.
  useEffect(() => {
    if (open && mode === "create" && defaultRemindAt) {
      const t = setTimeout(() => noteRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, mode, defaultRemindAt]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && value) {
      setRemindAt(isoToLocalInput(value.remindAt));
      setNote(value.content ?? "");
      setAssignee(value.assignedTo ?? "");
    } else {
      setRemindAt(defaultRemindAt ? isoToLocalInput(defaultRemindAt) : "");
      setNote(defaultNote ?? "");
      setAssignee(currentUserId ?? "");
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default the assignee to me once the user list resolves (create mode only).
  useEffect(() => {
    if (open && mode === "create" && currentUserId) setAssignee((prev) => prev || currentUserId);
  }, [open, mode, currentUserId]);

  async function submit() {
    if (submitting) return;
    setError(null);
    if (!remindAt) {
      setError("יש לבחור תאריך ושעה לתזכורת.");
      return;
    }
    if (!note.trim()) {
      setError("יש להזין פרטים לתזכורת.");
      return;
    }
    setSubmitting(true);
    try {
      const remindIso = new Date(remindAt).toISOString();
      const url = mode === "edit" ? "/api/reminders/update" : "/api/reminders/create";
      const payload =
        mode === "edit"
          ? { id: value?.id, remind_at: remindIso, content: note.trim(), assigned_to: assignee || null }
          : {
              ...links,
              remind_at: remindIso,
              content: note.trim() || undefined,
              assigned_to: assignee || undefined,
              action_type: "other",
              category,
            };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast.success(mode === "edit" ? "התזכורת עודכנה." : "התזכורת נוספה.");
      onSaved?.();
      onOpenChange(false);
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
      title={mode === "edit" ? "עריכת תזכורת" : "תזכורת חדשה"}
      description={mode === "edit" ? "עדכון מועד, פרטים או אחראי." : undefined}
      size="formMd"
      onSubmit={() => void submit()}
      submitLabel={mode === "edit" ? "שמירה" : "הוספת תזכורת"}
      busyLabel="שומר..."
      busy={submitting}
      error={error || undefined}
    >

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">מתי להזכיר? *</label>
            <DateTimeInput value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">על מה להזכיר? *</label>
            <Input ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">אחראי</label>
            <AssigneeSelect value={assignee} onChange={setAssignee} includeMeDefault />
          </div>
        </div>
    </FormDialog>
  );
}
