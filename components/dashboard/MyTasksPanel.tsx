"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChecklistIcon, SuccessIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import QuietCard from "@/components/dashboard/QuietCard";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/date";
import { offlineFetch } from "@/lib/offline-queue";
import type { DashboardTask } from "@/lib/dashboard/tasks-overview";

type TabKey = "all" | "today" | "overdue" | "in_progress";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "הכול" },
  { key: "today", label: "להיום" },
  { key: "overdue", label: "באיחור" },
  { key: "in_progress", label: "בתהליך" },
];

// Only the priorities worth a badge — same rule (and the same reason) as the
// tasks board's SHOWN_PRIORITIES: "בינונית" on every row is a chip that says
// nothing, and the badge earns its space only when the task deviates from normal.
const PRIORITY: Record<string, { label: string; variant: "destructive" | "warning" }> = {
  urgent: { label: "דחופה", variant: "destructive" },
  high: { label: "גבוהה", variant: "destructive" },
};

// Likewise for the status a dateless task falls back to: "לביצוע" is what every
// open task is, so only a status that says something more is printed.
const STATUS_LABEL: Record<string, string> = {
  in_progress: "בתהליך",
  blocked: "תקוע",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function MyTasksPanel({ tasks: initialTasks }: { tasks: DashboardTask[] }) {
  const router = useRouter();
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");

  const tasks = useMemo(
    () => initialTasks.filter((t) => !doneIds.has(t.id)),
    [initialTasks, doneIds]
  );

  const today = todayIso();
  const counts = useMemo(
    () => ({
      all: tasks.length,
      today: tasks.filter((t) => t.due_date?.slice(0, 10) === today).length,
      overdue: tasks.filter((t) => t.overdue).length,
      in_progress: tasks.filter((t) => t.status === "in_progress").length,
    }),
    [tasks, today]
  );

  const visible = useMemo(() => {
    switch (tab) {
      case "today":
        return tasks.filter((t) => t.due_date?.slice(0, 10) === today);
      case "overdue":
        return tasks.filter((t) => t.overdue);
      case "in_progress":
        return tasks.filter((t) => t.status === "in_progress");
      default:
        return tasks;
    }
  }, [tab, tasks, today]);

  async function markDone(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const result = await offlineFetch(
        "/api/tasks/update-status",
        { id, status: "done" },
        "סימון משימה כבוצעה"
      );
      if (result.queued) {
        setDoneIds((prev) => new Set(prev).add(id));
        return;
      }
      if (!result.ok) {
        toast.error(toHebrewError(result.error, "הפעולה נכשלה."));
        return;
      }
      setDoneIds((prev) => new Set(prev).add(id));
      toast.success("המשימה סומנה כבוצעה.");
      router.refresh();
    } catch (err: unknown) {
      toast.error(toHebrewError(err, "הפעולה נכשלה."));
    } finally {
      setBusyId(null);
    }
  }

  function dueLabel(task: DashboardTask) {
    if (task.overdue) return `באיחור · ${formatShortDate(task.due_date)}`;
    if (task.due_date?.slice(0, 10) === today) return "להיום";
    if (task.due_date) return formatShortDate(task.due_date);
    return STATUS_LABEL[task.status ?? ""] ?? "";
  }

  // Nothing assigned at all → one quiet line. NOT hidden: a board whose cards
  // come and go with the data is a board you have to re-read every morning.
  if (initialTasks.length === 0) {
    return <QuietCard icon={ChecklistIcon} title="המשימות שלי" note="אין משימות פתוחות" href="/tasks" />;
  }

  return (
    // Card → the board, each row → its task. The card's link is a full-bleed
    // overlay rather than a wrapper: the rows carry their own links and a
    // done-button, and neither is legal inside an <a>. Everything that isn't a
    // control falls through to the overlay.
    <Card className="relative flex h-full flex-col">
      <Link
        href="/tasks"
        aria-label="ללוח המשימות"
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
      <DashboardCardHeader icon={ChecklistIcon} title="המשימות שלי" count={tasks.length} />

      {/* BELOW the header, not inside it. As the header's `action` the strip
          wrapped onto its own line and dragged the header's rule down with it,
          so this was the one card whose title had no line under it.
          Centred, and closed with a rule of its own — which is also the line
          above the first task, so the list starts the way it separates. */}
      <div className="pointer-events-auto flex flex-wrap justify-center gap-1 border-b border-border/50 px-4 py-2">
        {/* All four, always — a filter you can't see is a filter you forget
            exists. Hiding the empty ones (tried 2026-08-18) meant the strip
            reshuffled itself as tasks got done, and a tab you wanted to switch
            to could vanish before you clicked it. */}
        {TABS.map((tab_) => (
          <button
            key={tab_.key}
            type="button"
            onClick={() => setTab(tab_.key)}
            className={cn(
              "whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium transition-colors",
              tab === tab_.key
                ? "bg-secondary/15 text-foreground ring-1 ring-secondary/40"
                : "bg-muted text-muted-foreground hover:bg-secondary/10"
            )}
          >
            {tab_.label} {counts[tab_.key]}
          </button>
        ))}
      </div>

      {/* Built to match "משלוחים קרובים" (user, 2026-08-18: "I love this card, I
          want to make this similar"): a divided list rather than spaced pills,
          one line of name over one line of meta, and the action as a filled
          button at the far end of the row. The name TRUNCATES for the same reason
          it does there — a wrapped title made its row taller than its neighbours,
          and in a height-capped card uneven rows read as broken. */}
      <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
        {visible.length > 0 ? (
          <ul className="board-list divide-y">
            {visible.map((task) => {
              const priority = PRIORITY[task.priority ?? ""] ?? null;
              const busy = busyId === task.id;
              return (
                <li
                  key={task.id}
                  className="relative px-4 py-3 transition-colors hover:bg-secondary/10"
                >
                  {/* Covers the row. The text block below is deliberately NOT
                      positioned, so this link paints over it and takes its clicks;
                      the button is lifted back above it by `relative`. */}
                  <Link
                    href={`/tasks/${task.id}`}
                    aria-label={task.subject}
                    className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />

                  {/* ONE line per row, whatever the task carries. The detail used
                      to sit under the title, so a task with a due date or a
                      priority was a two-line row next to a one-line neighbour and
                      the list came out ragged. It rides beside the title now:
                      the title takes what's left and truncates, the detail keeps
                      its size (shrink-0) because it's the part that's already
                      short. */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate text-sm font-medium" title={task.subject}>
                        {task.subject}
                      </span>
                      {priority ? (
                        <Badge variant={priority.variant} className="shrink-0 text-[10px]">
                          {priority.label}
                        </Badge>
                      ) : null}
                      {dueLabel(task) ? (
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            task.overdue ? "font-medium text-destructive" : "text-muted-foreground"
                          )}
                        >
                          {dueLabel(task)}
                        </span>
                      ) : null}
                      {task.project_name ? (
                        <span className="max-w-[7rem] truncate text-xs text-muted-foreground">
                          · {task.project_name}
                        </span>
                      ) : null}
                    </div>

                    {/* Same corner, same shape and the same past tense as the
                        delivery card's "סופק". `relative` lifts it over the row
                        link so its own click still lands. */}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="relative h-8 shrink-0 self-center px-3 text-sm max-md:min-h-[44px]"
                      onClick={() => void markDone(task.id)}
                      disabled={busy}
                      title="סימון המשימה כבוצעה"
                    >
                      {busy ? <SuccessIcon className="h-4 w-4" /> : null}
                      בוצע
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-3">
            <EmptyState dense>אין משימות בתצוגה זו.</EmptyState>
          </div>
        )}
      </CardContent>
      <DashboardCardFooter href="/tasks" label="כל המשימות" count={tasks.length} />
      </div>
    </Card>
  );
}
