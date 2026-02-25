import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "medium" | "high" | "urgent";

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

  const { data: tasks, error } = await supabase
    .from("task_overview_view")
    .select(
      "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at,is_overdue"
    )
    .order("due_date", { ascending: true })
    .limit(200);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">משימות</h1>

        {error ? (
          <div className="text-destructive text-sm">שגיאה: {error.message}</div>
        ) : !tasks || tasks.length === 0 ? (
          <div className="text-muted-foreground">אין משימות להצגה.</div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-right font-medium px-3 py-2">משימה</th>
                  <th className="text-right font-medium px-3 py-2">פרויקט</th>
                  <th className="text-right font-medium px-3 py-2">תאריך יעד</th>
                  <th className="text-right font-medium px-3 py-2">משויך</th>
                  <th className="text-right font-medium px-3 py-2">עדיפות</th>
                  <th className="text-right font-medium px-3 py-2">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tasks.map((t: any) => (
                  <tr key={t.task_id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link
                        href={`/tasks/${t.task_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {t.subject ?? "משימה"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{t.project_name ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {t.due_date
                        ? new Intl.DateTimeFormat("he-IL").format(
                            new Date(t.due_date)
                          )
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{t.assigned_user_name ?? "—"}</td>
                    <td className="px-3 py-2">
                      {t.priority ? (
                        <Badge variant={priorityVariant(t.priority)}>
                          {taskPriorityLabel(t.priority)}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {t.status ? (
                        <Badge variant={statusVariant(t.status)}>
                          {taskStatusLabel(t.status)}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
