"use client";
import { saveTaskSnooze, saveTaskStatus } from "@/lib/tasks/device-task-saves";
import { TaskSnoozeButton } from "@/components/tasks/TaskSnoozeButton";
import { tasksDict } from "@/lib/i18n/dictionaries/tasks";
import { OPENS_HERE_ATTRIBUTE, openTaskOnClick } from "@/lib/tasks/open-task-here";
import { toHebrewError } from "@/lib/error-messages";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckboxUncheckedIcon, TaskIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import QuietCard from "@/components/dashboard/QuietCard";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { CountBadge } from "@/components/ui/count-badge";
import { TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { cn } from "@/lib/utils";
import { formatDateWithTime, formatShortDate } from "@/lib/date";
import { scheduleDeferredAction } from "@/lib/undo-engine";
import type { DashboardTask } from "@/lib/dashboard/tasks-overview";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";
import { israelDateKey } from "@/lib/timezone";
import { readBoardColumnOrder, sortLikeBoard } from "@/lib/tasks/board-order";
import { useLocalViewer } from "@/lib/powersync/store";

// This device's board list order for the person — read after hydration (the
// server can't know it), as a string so the snapshot is stable.
const noSubscribe = () => () => {};
const DEFAULT_ORDER = JSON.stringify(readBoardColumnOrder(null));

type TabKey = "all" | "today" | "overdue" | "in_progress";

function tabs(locale: Locale): { key: TabKey; label: string }[] {
  return [
    { key: "all", label: t(dashboardDict, locale, "tabAll") },
    { key: "today", label: t(dashboardDict, locale, "tabToday") },
    { key: "overdue", label: t(dashboardDict, locale, "lateLabel") },
    { key: "in_progress", label: t(dashboardDict, locale, "tabInProgress") },
  ];
}

// Only the priorities worth a badge — same rule (and the same reason) as the
// tasks board's SHOWN_PRIORITIES: "בינונית" on every row is a chip that says
// nothing, and the badge earns its space only when the task deviates from normal.
// Its colour and word are the board's own (StatusBadge → getTaskPriorityColor):
// "גבוהה" is orange and only "דחופה" red (owner, 2026-10-11: priority colours
// the same everywhere). This card used to paint "גבוהה" red too.
const SHOWN_PRIORITIES = new Set(["high", "urgent"]);

// Likewise for the status a dateless task falls back to: "לביצוע" is what every
// open task is, so only a status that says something more is printed.
function statusLabel(locale: Locale): Record<string, string> {
  return {
    in_progress: t(dashboardDict, locale, "tabInProgress"),
    blocked: t(dashboardDict, locale, "statusBlocked"),
  };
}

// Bidirectional: subject_he is only ever set when the AUTHOR's own locale was
// 'ar' (see app/api/tasks/create) — so its presence means the original is
// already Arabic. subject_ar is the reverse: a Hebrew-authored task's title,
// lazily translated + cached for an Arabic viewer (see getMyTasks).
function displaySubject(task: DashboardTask, locale: Locale) {
  if (locale === "he") return task.subject_he || task.subject;
  if (task.subject_he) return task.subject;
  return task.subject_ar || task.subject;
}

export default function MyTasksPanel({ tasks: initialTasks, locale }: { tasks: DashboardTask[]; locale: Locale }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  // Put away with the clock ("לטיפול בהמשך") — off the list at once.
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(() => new Set());
  const [tab, setTab] = useState<TabKey>("all");
  const TABS = tabs(locale);
  const STATUS_LABEL = statusLabel(locale);

  // In the board's order: its lists as arranged there, each top to bottom
  // (owner, 2026-10-09: "the same order as there").
  const viewerId = useLocalViewer()?.id ?? null;
  const columnOrder = useSyncExternalStore(
    noSubscribe,
    () => JSON.stringify(readBoardColumnOrder(viewerId)),
    () => DEFAULT_ORDER
  );
  const tasks = useMemo(
    () =>
      sortLikeBoard(
        initialTasks.filter((task) => !doneIds.has(task.id) && !snoozedIds.has(task.id)),
        JSON.parse(columnOrder) as string[]
      ),
    [initialTasks, doneIds, snoozedIds, columnOrder]
  );

  const today = israelDateKey();
  const counts = useMemo(
    () => ({
      all: tasks.length,
      today: tasks.filter((task) => task.due_date?.slice(0, 10) === today).length,
      overdue: tasks.filter((task) => task.overdue).length,
      in_progress: tasks.filter((task) => task.status === "in_progress").length,
    }),
    [tasks, today]
  );

  const visible = useMemo(() => {
    switch (tab) {
      case "today":
        return tasks.filter((task) => task.due_date?.slice(0, 10) === today);
      case "overdue":
        return tasks.filter((task) => task.overdue);
      case "in_progress":
        return tasks.filter((task) => task.status === "in_progress");
      default:
        return tasks;
    }
  }, [tab, tasks, today]);

  function markDone(id: string) {
    scheduleDeferredAction({
      key: `dashboard-task:done:${id}`,
      message: t(dashboardDict, locale, "taskMarkedDone"),
      onApplyOptimistic: () => setDoneIds((prev) => new Set(prev).add(id)),
      onRevert: () =>
        setDoneIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      onCommit: async () => {
        // On the device copy when there is one (lib/tasks/device-task-saves.ts).
        const result = await saveTaskStatus(id, "done", t(dashboardDict, locale, "markTaskDoneQueued"));
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, t(dashboardDict, locale, "actionFailed")) };
        }
        if (!result.onDevice) startTransition(() => { router.refresh(); });
        return { ok: true };
      },
    });
  }

  function snooze(id: string, until: string | null) {
    if (!until) return; // a task on this list isn't snoozed
    const forget = () =>
      setSnoozedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    scheduleDeferredAction({
      key: `dashboard-task:snooze:${id}`,
      message: `${t(tasksDict, locale, "snoozedToastPrefix")}${formatShortDate(until)}`,
      onApplyOptimistic: () => setSnoozedIds((prev) => new Set(prev).add(id)),
      onRevert: forget,
      onCommit: async () => {
        // On the device copy when there is one (lib/tasks/device-task-saves.ts).
        const result = await saveTaskSnooze(id, until, t(tasksDict, locale, "snoozeOfflineLabel"));
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, t(tasksDict, locale, "toastErrorSnooze")) };
        }
        if (!result.onDevice) startTransition(() => { router.refresh(); });
        return { ok: true };
      },
    });
  }

  // The due day with its hour when one was chosen ("היום 15:00", "14/10/26 09:30")
  // — owner, 2026-10-15: "see exactly when".
  function dueLabel(task: DashboardTask) {
    if (task.overdue) {
      return `${t(dashboardDict, locale, "lateLabel")} · ${formatDateWithTime(task.due_date, task.due_time)}`;
    }
    if (task.due_date?.slice(0, 10) === today) {
      const hour = /^(\d{1,2}):(\d{2})/.exec(task.due_time ?? "");
      const label = t(dashboardDict, locale, "tabToday");
      return hour ? `${label} ${hour[1].padStart(2, "0")}:${hour[2]}` : label;
    }
    if (task.due_date) return formatDateWithTime(task.due_date, task.due_time);
    return STATUS_LABEL[task.status ?? ""] ?? "";
  }

  // Nothing assigned at all → one quiet line. NOT hidden: a board whose cards
  // come and go with the data is a board you have to re-read every morning.
  if (initialTasks.length === 0) {
    return (
      <QuietCard
        icon={TaskIcon}
        title={t(dashboardDict, locale, "myTasksCardTitle")}
        note={t(dashboardDict, locale, "myTasksEmptyNote")}
        href="/tasks"
      />
    );
  }

  return (
    // Card → the board, each row → its task. The card's link is a full-bleed
    // overlay rather than a wrapper: the rows carry their own links and a
    // done-button, and neither is legal inside an <a>. Everything that isn't a
    // control falls through to the overlay.
    <Card className="relative flex h-full flex-col">
      <Link
        href="/tasks"
        aria-label={t(dashboardDict, locale, "toTasksBoardAria")}
        className="absolute inset-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
      <DashboardCardHeader icon={TaskIcon} title={t(dashboardDict, locale, "myTasksCardTitle")} count={tasks.length} />

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
            aria-pressed={tab === tab_.key}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium transition-colors",
              // The app's one toggle look: blue when on, quiet when off (owner,
              // 2026-10-11: "all the toggles should be blue") — it was a sky tint + ring.
              tab === tab_.key ? `${TOGGLE_ON} hover:bg-secondary/90` : TOGGLE_OFF
            )}
          >
            {tab_.label}
            {/* The count's own "active" pill turns white on the pressed
                (blue) chip. */}
            <CountBadge
              count={counts[tab_.key]}
              active={tab === tab_.key}
              className={tab === tab_.key ? "bg-secondary-foreground text-secondary" : undefined}
            />
          </button>
        ))}
      </div>

      {/* Built to match "משלוחים קרובים" (user, 2026-08-18: "I love this card, I
          want to make this similar"): a divided list rather than spaced pills,
          the name over one line of meta. The name is never cut — it wraps (see
          the row below). */}
      <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
        {visible.length > 0 ? (
          <ul className="board-list divide-y">
            {visible.map((task) => {
              const priority = task.priority && SHOWN_PRIORITIES.has(task.priority) ? task.priority : null;
              const subject = displaySubject(task, locale);
              return (
                <li
                  key={task.id}
                  className="relative px-4 py-3 transition-colors hover:bg-secondary/10"
                >
                  {/* Covers the row. The text block below is deliberately NOT
                      positioned, so this link paints over it and takes its clicks;
                      the button is lifted back above it by `relative`. */}
                  {/* Opens the task right here, over the board (lib/tasks/
                      open-task-here.ts); a new-tab click still goes to it. */}
                  <Link
                    href={`/tasks/${task.id}`}
                    onClick={openTaskOnClick(task.id)}
                    {...{ [OPENS_HERE_ATTRIBUTE]: "" }}
                    aria-label={subject}
                    className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />

                  {/* The name always shows IN FULL (user, 2026-10-04): it used to
                      share one line with the priority and date and truncate, so
                      on a phone the row showed "דחופה · 01/06" and an ellipsis
                      where the task's name should be. The name wraps on its own
                      line now, and the detail sits under it. */}
                  <div className="flex items-start gap-2">
                    {/* The same tick as the "היום" card's rows. `relative` lifts
                        it over the row link so its own click still lands. */}
                    <button
                      type="button"
                      onClick={() => markDone(task.id)}
                      title={t(dashboardDict, locale, "markTaskDoneTitle")}
                      aria-label={t(dashboardDict, locale, "markTaskDoneTitle")}
                      className="relative mt-0.5 shrink-0 text-muted-foreground transition hover:text-success"
                    >
                      <CheckboxUncheckedIcon className="h-4 w-4" />
                    </button>
                    {/* "לטיפול בהמשך" beside it, as on the board (owner, 2026-10-09). */}
                    <TaskSnoozeButton
                      snoozedUntil={null}
                      onSnooze={(until) => snooze(task.id, until)}
                      locale={locale}
                      className="relative mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-snug">{subject}</div>
                      {priority || dueLabel(task) || task.project_name ? (
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          {priority ? (
                            <StatusBadge value={priority} type="priority" locale={locale} className="shrink-0 text-[0.647rem]" />
                          ) : null}
                          {dueLabel(task) ? (
                            <span
                              className={cn(
                                "text-xs",
                                task.overdue ? "font-medium text-destructive" : "text-muted-foreground"
                              )}
                            >
                              {dueLabel(task)}
                            </span>
                          ) : null}
                          {task.project_name ? (
                            <span className="text-xs text-muted-foreground">· {task.project_name}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-3">
            <EmptyState dense>{t(dashboardDict, locale, "noTasksInView")}</EmptyState>
          </div>
        )}
      </CardContent>
      <DashboardCardFooter href="/tasks" label={t(dashboardDict, locale, "allTasksFooterLabel")} count={tasks.length} />
      </div>
    </Card>
  );
}
