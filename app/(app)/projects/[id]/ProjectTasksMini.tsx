"use client";

// The project's tasks, small enough to live in the page's side column: how many
// are done, a filter, one line per task, and a way to add another. The full
// board lives on /tasks — this is the "what's left on this project" view.

import { saveTaskStatus } from "@/lib/tasks/device-task-saves";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AddIcon, CheckboxCheckedIcon, CheckboxUncheckedIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toHebrewError } from "@/lib/error-messages";
import { formatShortDate } from "@/lib/date";
import { getTaskPriorityColor, getTaskPriorityLabel } from "@/lib/ui/status-colors";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { cn } from "@/lib/utils";
import type { AssignableUser } from "@/app/(app)/projects/[id]/ProjectTabsClient";

const TaskUpsertDialog = dynamic(
  () => import("@/components/tasks/TaskUpsertDialog").then((mod) => mod.TaskUpsertDialog),
  { loading: () => null }
);

type Row = Record<string, unknown>;

function str(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// A task's priority looks and reads the same here as on the tasks board
// (owner, 2026-10-11: "the same everywhere"): the shared colour — urgent red,
// high orange, medium blue, low grey — and the shared words, "דחופה / גבוהה /
// בינונית / נמוכה". This list had its own: urgent AND high red, medium orange,
// and the words in the masculine.
function priorityPillClass(priority: string) {
  return getStatusColorClasses(getTaskPriorityColor(priority));
}

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
      // On the device copy when there is one (lib/tasks/device-task-saves.ts) —
      // this page then refreshes once it has reached the server.
      const result = await saveTaskStatus(id, next ? "done" : "todo", "עדכון סטטוס משימה");
      if (!result.queued && !result.ok) {
        setLocalDone((prev) => ({ ...prev, [id]: !next }));
        toast.error("שגיאה בעדכון סטטוס", { description: toHebrewError(result.error, "") });
        return;
      }
      if (!result.onDevice) onChange();
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
          // The app's one toggle look (owner, 2026-10-11: "all the toggles
          // should be blue"): ON is the shared blue fill, OFF quiet — at this list's
          // small size.
          <button
            key={chip.key}
            type="button"
            aria-pressed={filter === chip.key}
            onClick={() => setFilter(chip.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              filter === chip.key ? `border-secondary ${TOGGLE_ON}` : `border-border/70 bg-background ${TOGGLE_OFF}`
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        // The app's one empty box (owner, 2026-10-11: "empty lists: one look").
        <EmptyState dense>אין משימות להצגה.</EmptyState>
      ) : (
        <ul className="divide-y">
          {visible.map((row) => (
            <li key={row.id} className="flex items-start gap-2 py-2">
              {/* The square tick the dashboard and the board use (owner,
                  2026-10-11: one look for "done") — it was the browser's own
                  checkbox here. */}
              <button
                type="button"
                role="checkbox"
                aria-checked={row.done}
                disabled={busyId === row.id}
                onClick={() => void toggle(row.id, !row.done)}
                aria-label={row.done ? "סימון כלא הושלמה" : "סימון כהושלמה"}
                title={row.done ? "סימון כלא הושלמה" : "סימון כהושלמה"}
                className="relative mt-0.5 shrink-0 text-muted-foreground transition before:absolute before:-inset-2 before:content-[''] hover:text-success disabled:opacity-60"
              >
                {row.done ? (
                  <CheckboxCheckedIcon className="h-4 w-4 text-success" />
                ) : (
                  <CheckboxUncheckedIcon className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setEditId(row.id)}
                className="min-w-0 flex-1 text-start"
              >
                <span
                  className={
                    "block text-sm font-medium " +
                    (row.done ? "text-muted-foreground line-through" : "")
                  }
                >
                  {row.subject}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {row.priority ? (
                    <span className={cn("rounded-full px-1.5 py-0", priorityPillClass(row.priority))}>
                      {getTaskPriorityLabel(row.priority)}
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
        variant="soft"
        size="sm"
        className="w-full"
        onClick={() => setCreateOpen(true)}
      >
        <AddIcon className="h-4 w-4" />
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
