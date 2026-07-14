"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ListTodo, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatShortDate } from "@/lib/date";
import { TaskUpsertDialog, type UserOption } from "@/components/tasks/TaskUpsertDialog";

export type CustomerTaskItem = {
  id: string;
  subject: string;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_user_name: string | null;
  has_open_reminder: boolean;
  is_private: boolean;
};

const SOFT_ADD_BUTTON_CLASSES =
  "border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15";

/**
 * The customer's tasks, on the customer page: a compact list plus a "+ משימה"
 * button that opens the task dialog pre-linked to this customer (so a follow-up
 * can be logged even when there's no order/project yet). Clicking a row edits it.
 */
export default function CustomerTasksSection({
  customerId,
  customerName,
  customerPhone,
  tasks,
  users,
  currentUserId,
}: {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  tasks: CustomerTaskItem[];
  users: UserOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  // A single-option list so the dialog's customer picker shows this customer.
  const customerOptions = [
    { id: customerId, label: customerPhone ? `${customerName} · ${customerPhone}` : customerName },
  ];

  const addButton = (
    <Button
      size="sm"
      variant="secondary"
      className={SOFT_ADD_BUTTON_CLASSES}
      onClick={() => setCreateOpen(true)}
    >
      <Plus className="h-3.5 w-3.5" /> משימה
    </Button>
  );

  const dialogs = (
    <>
      <TaskUpsertDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        users={users}
        customers={customerOptions}
        presetCustomerId={customerId}
        currentUserId={currentUserId}
        wizard
        onSaved={() => router.refresh()}
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
        onSaved={() => router.refresh()}
      />
    </>
  );

  // Empty → a slim one-line row, matching the orders/projects empty rows so the
  // section doesn't take a full card's footprint when there's nothing yet.
  if (tasks.length === 0) {
    return (
      <>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/50 px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold">משימות</span>
            <span className="text-xs text-muted-foreground">אין משימות ללקוח זה עדיין</span>
          </div>
          <div className="shrink-0">{addButton}</div>
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <section className="space-y-3 rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListTodo className="h-4 w-4 text-primary" />
          משימות
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        {addButton}
      </div>

      <div className="divide-y divide-border/60">
        {tasks.map((task) => {
            const overdue =
              task.due_date !== null &&
              task.status !== "done" &&
              task.due_date.slice(0, 10) < today;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => setEditId(task.id)}
                className="-mx-2 flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-start text-sm hover:bg-muted/20"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{task.subject}</span>
                    {task.is_private ? <Lock className="h-3 w-3 text-muted-foreground" /> : null}
                    {task.has_open_reminder ? <Bell className="h-3 w-3 text-warning-strong" /> : null}
                    {task.status ? <StatusBadge value={task.status} type="task" /> : null}
                  </div>
                  {task.assigned_user_name ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      אחראי: {task.assigned_user_name}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-left">
                  {task.priority ? <StatusBadge value={task.priority} type="priority" /> : null}
                  {task.due_date ? (
                    <div className={`mt-1 text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                      {overdue ? "באיחור · " : ""}
                      {formatShortDate(task.due_date)}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
      </div>

      {dialogs}
    </section>
  );
}
