"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { DictateButton } from "@/components/ui/dictate-button";
import { offlineFetch } from "@/lib/offline-queue";
import { parseTaskLines } from "@/components/tasks/QuickAddTasksDialog.helpers";
import type { TaskOption, UserOption } from "@/components/tasks/TaskUpsertDialog";

// Hand someone a day's work in one pass.
//
// The full task dialog is right for ONE task with details, but giving a worker six
// things for Wednesday meant opening it six times and re-picking the same person
// and the same date every time. Here you pick אחראי + תאריך ONCE and type (or
// dictate) one line per task.
//
// Each line becomes a real task — individually completable and chase-able — rather
// than one reminder blob nobody can tick off.

export default function QuickAddTasksDialog({
  open,
  onOpenChange,
  users,
  projects,
  defaultAssigneeId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserOption[];
  projects: TaskOption[];
  /** Who to pre-select (usually the current user). */
  defaultAssigneeId?: string;
  onCreated?: () => void;
}) {
  const [assignee, setAssignee] = useState(defaultAssigneeId ?? "");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAssignee(defaultAssigneeId ?? "");
    setDueDate("");
    setProjectId("");
    setText("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lines = useMemo(() => parseTaskLines(text), [text]);

  async function save() {
    if (saving) return;
    if (lines.length === 0) {
      setError("יש להזין לפחות משימה אחת.");
      return;
    }
    setSaving(true);
    setError("");

    let created = 0;
    const failed: string[] = [];
    for (const subject of lines) {
      try {
        const result = await offlineFetch(
          "/api/tasks/create",
          {
            subject,
            status: "todo",
            priority: "medium",
            business_domain: "general_business",
            assigned_user_id: assignee || undefined,
            due_date: dueDate || undefined,
            project_id: projectId || undefined,
          },
          "משימה חדשה",
          { idempotent: true }
        );
        if (result.queued || result.ok) created += 1;
        else failed.push(subject);
      } catch {
        failed.push(subject);
      }
    }

    setSaving(false);

    // Partial success is real here (one bad line shouldn't discard the rest), so
    // say exactly what happened and keep the failures in the box to retry.
    if (created > 0) toast.success(`נוצרו ${created} משימות`);
    if (failed.length > 0) {
      setText(failed.join("\n"));
      setError(`${failed.length} משימות לא נוצרו — נסה שוב.`);
      onCreated?.();
      return;
    }
    onCreated?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="w-[calc(100vw-1rem)] max-w-lg p-4 text-right sm:p-6">
        <DialogHeader>
          <DialogTitle>הוספה מהירה</DialogTitle>
          <DialogDescription>שורה אחת לכל משימה. בוחרים אחראי ותאריך פעם אחת.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">אחראי</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="">ללא אחראי</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">תאריך יעד</label>
              <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {projects.length > 0 ? (
            <div className="space-y-1">
              <label className="text-sm font-medium">פרויקט (אופציונלי)</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"
              >
                <option value="">ללא</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium">המשימות — שורה לכל אחת</label>
              <DictateButton
                title="הכתבת רשימת משימות"
                onTranscript={(t) => setText((prev) => (prev ? `${prev.replace(/\s*$/, "")}\n${t}` : t))}
              />
            </div>
            <Textarea
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="text-right"
            />
            <div className="text-xs text-muted-foreground">
              {lines.length > 0 ? `${lines.length} משימות ייווצרו` : "כל שורה תיהפך למשימה נפרדת"}
            </div>
          </div>

          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || lines.length === 0}>
            {saving ? "יוצר…" : lines.length > 0 ? `צור ${lines.length} משימות` : "צור"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
