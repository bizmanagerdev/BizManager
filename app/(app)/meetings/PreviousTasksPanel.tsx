"use client";

import Link from "next/link";
import { MetaRow } from "@/components/ui/meta-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { CheckIcon, PendingIcon } from "@/components/ui/icons";
import { isTaskSettled } from "@/lib/meetings/load";
import { cn } from "@/lib/utils";
import type { MeetingTask } from "@/lib/meetings/types";

// Agenda item 0's body: the commitments made at the LAST meeting and what
// actually became of them. Auto-filled — there is nothing here to tick, the
// tasks' own statuses are the answer.

function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", timeZone: "Asia/Jerusalem" });
}

export function PreviousTasksPanel({
  tasks,
  previousMeetingDate,
  openInNewTab,
}: {
  tasks: MeetingTask[];
  previousMeetingDate: string | null;
  /** Same rule as the agenda links — don't take the meeting off the wall screen. */
  openInNewTab: boolean;
}) {
  if (!previousMeetingDate) {
    return (
      <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        זו הישיבה הראשונה שנרשמה במערכת — אין התחייבויות קודמות להציג.
      </p>
    );
  }

  if (tasks.length === 0) {
    return (
      <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        לא נפתחו משימות בישיבה הקודמת.
      </p>
    );
  }

  const open = tasks.filter((t) => !isTaskSettled(t.status));
  const settled = tasks.filter((t) => isTaskSettled(t.status));

  return (
    <div className="space-y-2">
      <MetaRow
        className="text-xs font-medium"
        items={[
          <span key="open" className={cn(open.length > 0 ? "text-destructive" : "text-muted-foreground")}>
            {open.length} לא הושלמו
          </span>,
          <span key="done" className="text-success">
            {settled.length} הושלמו
          </span>,
        ]}
      />
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
        {[...open, ...settled].map((task) => {
          const done = isTaskSettled(task.status);
          const due = formatDue(task.dueDate);
          return (
            <li key={task.taskId}>
              <Link
                href={`/tasks/${task.taskId}`}
                target={openInNewTab ? "_blank" : undefined}
                rel={openInNewTab ? "noopener noreferrer" : undefined}
                className="flex items-start gap-2 bg-card/60 px-3 py-2 transition-colors hover:bg-secondary/5"
              >
                <span className={cn("mt-0.5 shrink-0", done ? "text-success" : "text-warning")}>
                  {done ? <CheckIcon className="h-4 w-4" /> : <PendingIcon className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm font-medium">{task.subject}</span>
                  <MetaRow
                    className="text-[0.6875rem] text-muted-foreground"
                    items={[
                      task.itemTitle ? `מתוך: ${task.itemTitle}` : null,
                      task.assigneeName,
                      due ? `יעד ${due}` : null,
                    ]}
                  />
                </span>
                <StatusBadge value={task.status} type="task" className="shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PreviousTasksPanel;
