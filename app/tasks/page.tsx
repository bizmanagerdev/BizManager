import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import TasksRealtimeBadge from "@/app/tasks/TasksRealtimeBadge";
import { formatShortDate } from "@/lib/date";

type Row = Record<string, unknown>;

export const revalidate = 30;
const PAGE_SIZE = 50;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function buildTasksHref(page: number) {
  return page <= 1 ? "/tasks" : `/tasks?page=${page}`;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const page = parsePage(params.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = page * PAGE_SIZE - 1;

  const { profile, supabase } = await requireProfile();

  const { data, error, count } = await supabase
    .from("task_overview_view")
    .select(
      "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at,is_overdue",
      { count: "estimated" }
    )
    .order("due_date", { ascending: true })
    .range(from, to);

  const tasks = (data ?? []) as Row[];
  const totalCount = typeof count === "number" ? count : tasks.length;
  const hasPreviousPage = page > 1;
  const hasNextPage = typeof count === "number" ? to + 1 < count : tasks.length === PAGE_SIZE;

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
          <>
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
                          {formatShortDate(dueDate)}
                        </td>
                        <td className="px-3 py-2">{assignee}</td>
                        <td className="px-3 py-2">
                          {priority ? <StatusBadge value={priority} type="priority" /> : "-"}
                        </td>
                        <td className="px-3 py-2">
                          {status ? <StatusBadge value={status} type="task" /> : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {page} • מוצגים {tasks.length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildTasksHref(page - 1)}>הקודם</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildTasksHref(page + 1)}>הבא</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הבא
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
