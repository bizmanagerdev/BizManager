"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatShortDate } from "@/lib/date";
import TasksRealtimeBadge from "@/app/tasks/TasksRealtimeBadge";
import { TaskUpsertDialog, type TaskOption, type UserOption } from "@/components/tasks/TaskUpsertDialog";
import { getBusinessDomainLabel, isExpenseBusinessDomain } from "@/lib/expenses";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export type TaskListItem = {
  id: string;
  subject: string;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  project_name: string | null;
  property_name: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  is_overdue?: boolean | null;
};

type Props = {
  tasks: TaskListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  prevHref: string | null;
  nextHref: string | null;
  projects: TaskOption[];
  properties: TaskOption[];
  users: UserOption[];
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export default function TasksPageClient(props: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterDomain, setFilterDomain] = useState("");
  const [filterTarget, setFilterTarget] = useState<"" | "project" | "property">("");

  const filteredTasks = useMemo(() => {
    const query = normalize(q);
    return props.tasks.filter((task) => {
      if (filterTarget === "project" && !task.project_id) return false;
      if (filterTarget === "property" && !task.property_id) return false;
      if (filterStatus && (task.status ?? "") !== filterStatus) return false;
      if (filterPriority && (task.priority ?? "") !== filterPriority) return false;
      if (filterDomain && (task.business_domain ?? "") !== filterDomain) return false;
      if (!query) return true;

      const haystack = [
        task.subject,
        task.project_name ?? "",
        task.property_name ?? "",
        task.assigned_user_name ?? "",
        task.status ?? "",
        task.priority ?? "",
        task.business_domain ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [props.tasks, q, filterStatus, filterPriority, filterDomain, filterTarget]);

  const statusOptions = useMemo(() => ["todo", "in_progress", "blocked", "done", "cancelled"], []);
  const priorityOptions = useMemo(() => ["low", "medium", "high", "urgent"], []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">משימות</h1>
        <TasksRealtimeBadge />
      </div>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <div />
          <Button type="button" onClick={() => setCreateOpen(true)}>
            הוספת משימה
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-end">
            <Button asChild type="button" variant="outline">
              <Link href="/tasks/recurring">משימות קבועות</Link>
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1 lg:col-span-2">
              <div className="text-xs text-muted-foreground">חיפוש</div>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש..." />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">סטטוס</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">הכל</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">עדיפות</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
              >
                <option value="">הכל</option>
                {priorityOptions.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">דומיין</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
              >
                <option value="">הכל</option>
                {Array.from(
                  new Set(
                    props.tasks
                      .map((task) => (typeof task.business_domain === "string" ? task.business_domain : ""))
                      .filter(Boolean)
                  )
                ).map((domain) => (
                  <option key={domain} value={domain}>
                    {isExpenseBusinessDomain(domain) ? getBusinessDomainLabel(domain) : domain}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">סוג</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterTarget}
                onChange={(e) => setFilterTarget(e.target.value as "" | "project" | "property")}
              >
                <option value="">הכל</option>
                <option value="project">פרויקטים</option>
                <option value="property">נכסים</option>
              </select>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            מוצגות {filteredTasks.length} מתוך {props.totalCount} (עמוד {props.page})
          </div>
        </CardContent>
      </Card>

      {filteredTasks.length === 0 ? (
        <div className="text-muted-foreground">אין משימות להצגה.</div>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {filteredTasks.map((task) => {
              const where = task.project_name ?? task.property_name ?? "—";
              return (
                <Card key={task.id} className="overflow-hidden">
                  <CardContent className="space-y-2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/tasks/${encodeURIComponent(task.id)}`} className="font-medium text-primary hover:underline">
                        {task.subject || "משימה"}
                      </Link>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditId(task.id);
                          setEditOpen(true);
                        }}
                      >
                        עריכה
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {task.priority ? <StatusBadge value={task.priority} type="priority" /> : null}
                      {task.status ? <StatusBadge value={task.status} type="task" /> : null}
                    </div>
                    <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                      <div>
                        יעד: <span className="text-foreground">{formatShortDate(task.due_date)}</span>
                      </div>
                      <div>
                        מקושר ל: <span className="text-foreground">{where}</span>
                      </div>
                      <div>
                        משויך: <span className="text-foreground">{task.assigned_user_name ?? "—"}</span>
                      </div>
                      <div>
                        דומיין:{" "}
                        <span className="text-foreground">
                          {task.business_domain
                            ? isExpenseBusinessDomain(task.business_domain)
                              ? getBusinessDomainLabel(task.business_domain)
                              : task.business_domain
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">משימה</th>
                  <th className="px-3 py-2 text-right font-medium">מקושר ל</th>
                  <th className="px-3 py-2 text-right font-medium">דומיין</th>
                  <th className="px-3 py-2 text-right font-medium">תאריך יעד</th>
                  <th className="px-3 py-2 text-right font-medium">משויך</th>
                  <th className="px-3 py-2 text-right font-medium">עדיפות</th>
                  <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                  <th className="px-3 py-2 text-right font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredTasks.map((task) => {
                  const where = task.project_name ?? task.property_name ?? "—";
                  return (
                    <tr key={task.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Link
                          href={`/tasks/${encodeURIComponent(task.id)}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {task.subject || "משימה"}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{where}</td>
                      <td className="px-3 py-2">
                        {task.business_domain
                          ? isExpenseBusinessDomain(task.business_domain)
                            ? getBusinessDomainLabel(task.business_domain)
                            : task.business_domain
                          : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatShortDate(task.due_date)}</td>
                      <td className="px-3 py-2">{task.assigned_user_name ?? "—"}</td>
                      <td className="px-3 py-2">
                        {task.priority ? <StatusBadge value={task.priority} type="priority" /> : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {task.status ? <StatusBadge value={task.status} type="task" /> : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditId(task.id);
                            setEditOpen(true);
                          }}
                        >
                          עריכה
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
            <div className="text-muted-foreground">
              עמוד {props.page} • מציגים {props.tasks.length} מתוך {props.totalCount}
            </div>
            <div className="flex gap-2">
              {props.hasPreviousPage && props.prevHref ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={props.prevHref}>הקודם</Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  הקודם
                </Button>
              )}
              {props.hasNextPage && props.nextHref ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={props.nextHref}>הבא</Link>
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

      <TaskUpsertDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        users={props.users}
        projects={props.projects}
        properties={props.properties}
      />

      <TaskUpsertDialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditId(null);
        }}
        mode="edit"
        taskId={editId}
        users={props.users}
        projects={props.projects}
        properties={props.properties}
      />
    </div>
  );
}
