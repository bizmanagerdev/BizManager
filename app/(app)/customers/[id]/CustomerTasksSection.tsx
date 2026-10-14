"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { LockIcon, NotificationIcon, TaskIcon } from "@/components/ui/icons";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { EmptyState } from "@/components/ui/empty-state";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatShortDate } from "@/lib/date";
import { israelDateKey } from "@/lib/timezone";
import type { UserOption } from "@/components/tasks/TaskUpsertDialog";
import { AddActionButton, SECTION_IDS, openSection } from "@/app/(app)/customers/[id]/customerSectionUi";
import type { CustomerTaskItem } from "@/app/(app)/customers/[id]/customerPageModel";

export type { CustomerTaskItem };

const TaskUpsertDialog = dynamic(
  () => import("@/components/tasks/TaskUpsertDialog").then((mod) => mod.TaskUpsertDialog),
  { loading: () => null }
);

// The date only matters at the first paint and after it; nothing to listen to.
const noSubscription = () => () => {};

function str(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * The customer's tasks, on the customer page: a compact list plus a "+ משימה"
 * that opens the task dialog pre-linked to this customer (so a follow-up can be
 * logged even when there's no order/project yet). Clicking a row edits it.
 *
 * A new task shows at once from what the dialog hands back — saved on the
 * device's copy too, before it reaches the server — rather than after the page
 * is read again. "Overdue" is judged against the server's today on the first
 * paint and the device's after it, so the two renders agree.
 */
export default function CustomerTasksSection({
  customerId,
  customerName,
  customerPhone,
  tasks,
  users,
  currentUserId,
  today: serverToday,
  createOpen,
  onCreateOpenChange,
}: {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  tasks: CustomerTaskItem[];
  users: UserOption[];
  currentUserId: string;
  /** Israel's today on the server that drew the page. */
  today: string;
  /** The create dialog — the page's ⋮ opens it too. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editId, setEditId] = useState<string | null>(null);
  const [created, setCreated] = useState<CustomerTaskItem[]>([]);
  // The server's today while the page hydrates (so both renders say the same
  // "באיחור"), the device's from then on.
  const today = useSyncExternalStore(noSubscription, israelDateKey, () => serverToday);

  const shown = useMemo(() => {
    const ids = new Set(tasks.map((task) => task.id));
    return [...created.filter((task) => !ids.has(task.id)), ...tasks];
  }, [created, tasks]);
  const openCount = shown.filter((task) => task.status !== "done").length;

  // A single-option list so the dialog's customer picker shows this customer.
  const customerOptions = [
    { id: customerId, label: customerPhone ? `${customerName} · ${customerPhone}` : customerName },
  ];
  const userNameById = new Map(users.map((user) => [user.id, user.label]));

  function addCreated(row: Record<string, unknown> | null | undefined) {
    const id = row ? str(row, "id") : null;
    if (!row || !id) {
      // Saved, but with nothing handed back (it waits for the connection): the
      // server's list has it once the page is read again.
      startTransition(() => router.refresh());
      return;
    }
    const assignee = str(row, "assigned_user_id");
    setCreated((prev) => [
      {
        id,
        subject: str(row, "subject") ?? "משימה",
        status: str(row, "status"),
        priority: str(row, "priority"),
        due_date: str(row, "due_date"),
        assigned_user_name: assignee ? userNameById.get(assignee) ?? null : null,
        has_open_reminder: false,
        is_private: row.is_private === true,
      },
      ...prev.filter((task) => task.id !== id),
    ]);
    openSection(SECTION_IDS.tasks);
  }

  return (
    <CollapsibleSection
      id={SECTION_IDS.tasks}
      title="משימות"
      // The app's task glyph, grey like every section icon.
      icon={<TaskIcon className={SECTION_ICON_CLASS} />}
      summary={<SectionCount count={shown.length} />}
      defaultOpen={openCount > 0}
      action={<AddActionButton label="משימה" ariaLabel="משימה חדשה ללקוח" onClick={() => onCreateOpenChange(true)} />}
    >
      {shown.length === 0 ? (
        <EmptyState dense>אין משימות ללקוח זה.</EmptyState>
      ) : (
        <div className="divide-y divide-border/60">
          {shown.map((task) => {
            const overdue = task.due_date !== null && task.status !== "done" && task.due_date.slice(0, 10) < today;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => setEditId(task.id)}
                className="-mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-start text-sm hover:bg-muted/20"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-medium">{task.subject}</span>
                    {task.is_private ? <LockIcon className="h-3 w-3 text-muted-foreground" aria-label="פרטית" /> : null}
                    {task.has_open_reminder ? (
                      <NotificationIcon className="h-3 w-3 text-warning-strong" aria-label="יש תזכורת פתוחה" />
                    ) : null}
                    {task.status ? <StatusBadge value={task.status} type="task" /> : null}
                  </div>
                  {task.assigned_user_name ? (
                    <div className="mt-0.5 text-xs text-muted-foreground">אחראי: {task.assigned_user_name}</div>
                  ) : null}
                </div>
                <div className="shrink-0 text-end">
                  {task.priority ? <StatusBadge value={task.priority} type="priority" /> : null}
                  {task.due_date ? (
                    <div className={`mt-1 text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                      {overdue ? "באיחור · " : ""}
                      {formatShortDate(task.due_date, "—")}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <TaskUpsertDialog
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        mode="create"
        users={users}
        customers={customerOptions}
        presetCustomerId={customerId}
        currentUserId={currentUserId}
        wizard
        onSaved={(row) => addCreated(row)}
      />
      <TaskUpsertDialog
        open={editId !== null}
        onOpenChange={(open) => {
          if (!open) setEditId(null);
        }}
        mode="edit"
        taskId={editId}
        users={users}
        customers={customerOptions}
        currentUserId={currentUserId}
        // An edit can change anything about the task (and a device-copy save
        // hands nothing back): the page reads its tasks again.
        onSaved={() => startTransition(() => router.refresh())}
      />
    </CollapsibleSection>
  );
}
