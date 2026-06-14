"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/date";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { offlineFetch } from "@/lib/offline-queue";
import type { DashboardTask } from "@/lib/dashboard/tasks-overview";

type TabKey = "all" | "today" | "overdue" | "in_progress";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "הכול" },
  { key: "today", label: "להיום" },
  { key: "overdue", label: "באיחור" },
  { key: "in_progress", label: "בתהליך" },
];

const PRIORITY: Record<string, { label: string; variant: "destructive" | "warning" | "neutral" }> = {
  high: { label: "גבוהה", variant: "destructive" },
  medium: { label: "בינונית", variant: "warning" },
  low: { label: "נמוכה", variant: "neutral" },
};

const STATUS_LABEL: Record<string, string> = {
  todo: "לביצוע",
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
        toast.error(result.error || "הפעולה נכשלה.");
        return;
      }
      setDoneIds((prev) => new Set(prev).add(id));
      toast.success("המשימה סומנה כבוצעה.");
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "הפעולה נכשלה.");
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

  // No tasks assigned at all → hide the whole panel (don't show an empty shell).
  if (initialTasks.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">המשימות שלי</CardTitle>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  tab === t.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label} {counts[t.key]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.length > 0 ? (
          visible.map((task) => {
            const priority = PRIORITY[task.priority ?? ""] ?? null;
            return (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 p-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void markDone(task.id)}
                    disabled={busyId === task.id}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-success disabled:opacity-50"
                    aria-label="סמן כבוצע"
                  >
                    {busyId === task.id ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : (
                      <Circle className="h-5 w-5" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">
                      {task.subject}
                    </Link>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {priority ? (
                        <Badge variant={priority.variant} className="text-[10px]">
                          {priority.label}
                        </Badge>
                      ) : null}
                      <span className={cn(task.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                        {dueLabel(task)}
                      </span>
                      {task.project_name ? (
                        <span className="text-muted-foreground">· {task.project_name}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <InitialsAvatar name={task.project_name ?? task.subject} />
              </div>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            אין משימות בתצוגה זו.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
