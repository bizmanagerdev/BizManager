"use client";

// The project's tasks, small enough to live in the page's side column: how many
// are done, a filter, one line per task, and a way to add another. The full
// board lives on /tasks — this is the "what's left on this project" view.

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { formatShortDate } from "@/lib/date";
import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";
import type { AssignableUser } from "@/app/(app)/projects/[id]/ProjectTabsClient";

type Row = Record<string, unknown>;

function str(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

const PRIORITY_LABEL: Record<string, string> = {
  urgent: "דחוף",
  high: "גבוה",
  medium: "בינוני",
  low: "נמוך",
};

const PRIORITY_CLASS: Record<string, string> = {
  urgent: "border-destructive/40 bg-destructive-soft text-destructive",
  high: "border-destructive/40 bg-destructive-soft text-destructive",
  medium: "border-warning/40 bg-warning-soft text-warning-soft-foreground",
  low: "border-border/70 bg-muted text-muted-foreground",
};

export default function ProjectTasksMini({
  projectId,
  projectType,
  tasks,
  users,
  onChange,
}: {
  projectId: string;
  projectType: string;
  tasks: Row[];
  users: AssignableUser[];
  onChange: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localDone, setLocalDone] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      tasks.map((task) => {
        const id = str(task, ["task_id", "id"]) ?? "";
        const status = str(task, ["status"]) ?? "todo";
        const done = localDone[id] ?? (status === "done");
        return {
          id,
          subject: str(task, ["subject", "title"]) ?? "משימה",
          done,
          cancelled: status === "cancelled",
          priority: str(task, ["priority"]),
          dueDate: str(task, ["due_date"]),
          assignee: str(task, ["assigned_user_name"]),
        };
      }),
    [tasks, localDone]
  );

  const total = rows.length;
  const doneCount = rows.filter((row) => row.done).length;
  const openCount = total - doneCount;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const visible = rows.filter((row) =>
    filter === "all" ? true : filter === "done" ? row.done : !row.done
  );

  async function toggle(id: string, next: boolean) {
    if (!id || busyId) return;
    setBusyId(id);
    // Optimistic: the checkbox is the whole point of the panel, so it shouldn't
    // wait on a round trip.
    setLocalDone((prev) => ({ ...prev, [id]: next }));
    try {
      const result = await offlineFetch(
        "/api/tasks/update-status",
        { id, status: next ? "done" : "todo" },
        "עדכון סטטוס משימה"
      );
      if (!result.queued && !result.ok) {
        setLocalDone((prev) => ({ ...prev, [id]: !next }));
        toast.error("שגיאה בעדכון סטטוס", { description: toHebrewError(result.error, "") });
        return;
      }
      onChange();
    } catch (error: unknown) {
      setLocalDone((prev) => ({ ...prev, [id]: !next }));
      toast.error("שגיאה בעדכון סטטוס", { description: toHebrewError(error, "") });
    } finally {
      setBusyId(null);
    }
  }

  const userOptions = users
    .filter((user) => user.active !== false && user.role !== "worker_no_access")
    .map((user) => ({ id: user.id, label: user.full_name ?? user.email }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {doneCount}/{total} · {percent}%
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { key: "all", label: `הכל ${total}` },
            { key: "open", label: `פתוחות ${openCount}` },
            { key: "done", label: `הושלמו ${doneCount}` },
          ] as const
        ).map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={
              "rounded-full border px-2.5 py-1 text-xs " +
              (filter === chip.key
                ? "border-transparent bg-sidebar text-white"
                : "border-border/70 bg-background text-muted-foreground hover:bg-accent")
            }
          >
            {chip.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין משימות להצגה.</p>
      ) : (
        <ul className="divide-y">
          {visible.map((row) => (
            <li key={row.id} className="flex items-start gap-2 py-2">
              <input
                type="checkbox"
                checked={row.done}
                disabled={busyId === row.id}
                onChange={(event) => void toggle(row.id, event.target.checked)}
                aria-label={row.done ? "סימון כלא הושלמה" : "סימון כהושלמה"}
                className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--green-4))]"
              />
              <button
                type="button"
                onClick={() => setEditId(row.id)}
                className="min-w-0 flex-1 text-start"
              >
                <span
                  className={
                    "block break-words text-sm font-medium " +
                    (row.done ? "text-muted-foreground line-through" : "")
                  }
                >
                  {row.subject}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                  {row.priority ? (
                    <span
                      className={
                        "rounded-full border px-1.5 py-0 " +
                        (PRIORITY_CLASS[row.priority] ?? PRIORITY_CLASS.low)
                      }
                    >
                      {PRIORITY_LABEL[row.priority] ?? row.priority}
                    </span>
                  ) : null}
                  {row.assignee ? <span>{row.assignee}</span> : null}
                  {row.dueDate ? <span dir="ltr">{formatShortDate(row.dueDate, "—")}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full border-dashed"
        onClick={() => setCreateOpen(true)}
      >
        <Plus className="h-4 w-4" />
        משימה חדשה
      </Button>

      <TaskUpsertDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        users={userOptions}
        fixedTarget={{ type: "project", id: projectId }}
        defaultProjectType={projectType}
        onSaved={onChange}
      />
      <TaskUpsertDialog
        open={editId !== null}
        onOpenChange={(open) => {
          if (!open) setEditId(null);
        }}
        mode="edit"
        taskId={editId}
        users={userOptions}
        fixedTarget={{ type: "project", id: projectId }}
        defaultProjectType={projectType}
        onSaved={onChange}
      />
    </div>
  );
}
