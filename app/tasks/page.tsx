import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import TasksRealtimeBadge from "@/app/tasks/TasksRealtimeBadge";

type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "medium" | "high" | "urgent";
type Row = Record<string, unknown>;

export const revalidate = 30;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function taskStatusLabel(status: TaskStatus | string) {
  switch (status) {
    case "todo":
      return "לביצוע";
    case "in_progress":
      return "בתהליך";
    case "blocked":
      return "חסום";
    case "done":
      return "בוצע";
    case "cancelled":
      return "בוטל";
    default:
      return status;
  }
}

function taskPriorityLabel(priority: TaskPriority | string) {
  switch (priority) {
    case "low":
      return "נמוכה";
    case "medium":
      return "בינונית";
    case "high":
      return "גבוהה";
    case "urgent":
      return "דחופה";
    default:
      return priority;
  }
}

function priorityVariant(priority: TaskPriority | string) {
  switch (priority) {
    case "low":
      return "secondary" as const;
    case "medium":
      return "warning" as const;
    case "high":
      return "destructive" as const;
    case "urgent":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function statusVariant(status: TaskStatus | string) {
  switch (status) {
    case "done":
      return "success" as const;
    case "in_progress":
      return "warning" as const;
    case "blocked":
      return "destructive" as const;
    case "todo":
      return "secondary" as const;
    case "cancelled":
      return "outline" as const;
    default:
      return "outline" as const;
  }
}

export default async function TasksPage() {
  const { profile, supabase } = await requireProfile();

  const { data, error } = await supabase
    .from("task_overview_view")
    .select(
      "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at,is_overdue"
    )
    .order("due_date", { ascending: true })
    .limit(200);

  const tasks = (data ?? []) as Row[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">משימות</h1>
          <TasksRealtimeBadge />
        </div>

        {error ? (
          <div className="text-destructive text-sm">שגיאה: {error.message}</div>
        ) : tasks.length === 0 ? (
          <div className="text-muted-foreground">אין משימות להצגה.</div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">משימה</th>
                  <th className="px-3 py-2 text-right font-medium">פרויקט</th>
                  <th className="px-3 py-2 text-right font-medium">תאריך יעד</th>
                  <th className="px-3 py-2 text-right font-medium">משויך</th>
                  <th className="px-3 py-2 text-right font-medium">עדיפות</th>
                  <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tasks.map((task, index) => {
                  const taskId = getString(task, "task_id") ?? "";
                  const dueDate = getString(task, "due_date");
                  const subject = getString(task, "subject") ?? "משימה";
                  const projectName = getString(task, "project_name") ?? "-";
                  const assignee = getString(task, "assigned_user_name") ?? "-";
                  const priority = getString(task, "priority");
                  const status = getString(task, "status");

                  return (
                    <tr key={taskId || `task-${index}`} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Link
                          href={`/tasks/${taskId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {subject}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{projectName}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {dueDate
                          ? new Intl.DateTimeFormat("he-IL").format(new Date(dueDate))
                          : "-"}
                      </td>
                      <td className="px-3 py-2">{assignee}</td>
                      <td className="px-3 py-2">
                        {priority ? (
                          <Badge variant={priorityVariant(priority)}>
                            {taskPriorityLabel(priority)}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {status ? (
                          <Badge variant={statusVariant(status)}>{taskStatusLabel(status)}</Badge>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
