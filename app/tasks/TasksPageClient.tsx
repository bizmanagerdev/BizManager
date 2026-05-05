"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatShortDate } from "@/lib/date";
import TasksRealtimeBadge from "@/app/tasks/TasksRealtimeBadge";
import {
  TaskUpsertDialog,
  type TaskOption,
  type UserOption,
} from "@/components/tasks/TaskUpsertDialog";
import {
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import { getBusinessDomainLabel, isExpenseBusinessDomain } from "@/lib/expenses";
import { Card, CardContent } from "@/components/ui/card";
import { getTaskPriorityLabel, getTaskStatusLabel } from "@/lib/ui/status-colors";

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

const STATUS_OPTIONS = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function domainLabel(domain: string | null) {
  if (!domain) return "—";
  return isExpenseBusinessDomain(domain) ? getBusinessDomainLabel(domain) : domain;
}

export default function TasksPageClient(props: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [localTasks, setLocalTasks] = useState<TaskListItem[]>(props.tasks);

  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterDomain, setFilterDomain] = useState("");
  const [filterLinkedId, setFilterLinkedId] = useState("");

  useEffect(() => {
    setLocalTasks(props.tasks);
  }, [props.tasks]);

  const linkedFilterTarget = useMemo<"" | "project" | "property">(() => {
    if (filterDomain === "logistics_projects") return "project";
    if (filterDomain === "property_management") return "property";
    return "";
  }, [filterDomain]);

  const linkedFilterOptions = useMemo(() => {
    if (linkedFilterTarget === "project") return props.projects;
    if (linkedFilterTarget === "property") return props.properties;
    return [];
  }, [linkedFilterTarget, props.projects, props.properties]);

  useEffect(() => {
    setFilterLinkedId("");
  }, [linkedFilterTarget]);

  const filteredTasks = useMemo(() => {
    const query = normalize(q);

    return localTasks.filter((task) => {
      if (filterStatus && (task.status ?? "") !== filterStatus) return false;
      if (filterPriority && (task.priority ?? "") !== filterPriority) return false;
      if (filterDomain && (task.business_domain ?? "") !== filterDomain) return false;

      if (filterLinkedId) {
        if (linkedFilterTarget === "project" && task.project_id !== filterLinkedId) return false;
        if (linkedFilterTarget === "property" && task.property_id !== filterLinkedId) return false;
      }

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
  }, [
    filterDomain,
    filterLinkedId,
    filterPriority,
    filterStatus,
    linkedFilterTarget,
    localTasks,
    q,
  ]);

  async function updateTaskStatus(taskId: string, status: string) {
    setUpdatingStatusId(taskId);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: taskId, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה בעדכון סטטוס", { description: json?.error ?? "" });
        return;
      }

      setLocalTasks((prev) =>
        prev.map((task) => (task.id === taskId ? { ...task, status } : task))
      );
      toast.success("הסטטוס עודכן");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      toast.error("שגיאה בעדכון סטטוס", { description: message });
    } finally {
      emitProgressActivityEnd();
      setUpdatingStatusId(null);
    }
  }

  async function deleteTask(taskId: string, subject: string) {
    const ok = window.confirm(`למחוק את המשימה "${subject}"?`);
    if (!ok) return;

    setDeletingId(taskId);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: taskId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקת משימה", { description: json?.error ?? "" });
        return;
      }

      setLocalTasks((prev) => prev.filter((task) => task.id !== taskId));
      toast.success("המשימה נמחקה");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      toast.error("שגיאה במחיקת משימה", { description: message });
    } finally {
      emitProgressActivityEnd();
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">משימות</h1>
        <TasksRealtimeBadge />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild type="button" variant="outline">
          <Link href="/tasks/recurring">משימות קבועות</Link>
        </Button>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          הוספת משימה
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-1">
              <div className="text-[11px] text-muted-foreground">חיפוש</div>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש..." />
            </div>

            <div className="w-[120px] space-y-1">
              <div className="text-[11px] text-muted-foreground">סטטוס</div>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">הכל</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {getTaskStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-[120px] space-y-1">
              <div className="text-[11px] text-muted-foreground">עדיפות</div>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
              >
                <option value="">הכל</option>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {getTaskPriorityLabel(priority)}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-[160px] space-y-1">
              <div className="text-[11px] text-muted-foreground">דומיין</div>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
              >
                <option value="">הכל</option>
                {Array.from(
                  new Set(
                    localTasks
                      .map((task) =>
                        typeof task.business_domain === "string" ? task.business_domain : ""
                      )
                      .filter(Boolean)
                  )
                ).map((domain) => (
                  <option key={domain} value={domain}>
                    {domainLabel(domain)}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-[11px] whitespace-nowrap text-muted-foreground">
              מוצגות {filteredTasks.length} מתוך {props.totalCount}
            </div>
          </div>

          {linkedFilterTarget ? (
            <div className="mt-3 min-w-0 space-y-1 border-t pt-3">
              <div className="text-[11px] text-muted-foreground">
                {linkedFilterTarget === "project" ? "בחירת פרויקט" : "בחירת נכס"}
              </div>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-md"
                value={filterLinkedId}
                onChange={(e) => setFilterLinkedId(e.target.value)}
              >
                <option value="">
                  {linkedFilterTarget === "project" ? "כל הפרויקטים" : "כל הנכסים"}
                </option>
                {linkedFilterOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
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
                      <div className="font-medium">{task.subject || "משימה"}</div>
                      <div className="flex gap-2">
                        <Button asChild type="button" variant="outline" size="sm">
                          <Link href={`/tasks/${encodeURIComponent(task.id)}`}>פרטים</Link>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={deletingId === task.id || updatingStatusId === task.id}
                          onClick={() => {
                            setEditId(task.id);
                            setEditOpen(true);
                          }}
                        >
                          עריכה
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={deletingId === task.id || updatingStatusId === task.id}
                          onClick={() => void deleteTask(task.id, task.subject || "משימה")}
                        >
                          {deletingId === task.id ? "מוחק..." : "מחיקה"}
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {task.priority ? <StatusBadge value={task.priority} type="priority" /> : null}
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value={task.status ?? "todo"}
                        disabled={updatingStatusId === task.id || deletingId === task.id}
                        onChange={(e) => void updateTaskStatus(task.id, e.target.value)}
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {getTaskStatusLabel(status)}
                          </option>
                        ))}
                      </select>
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
                        דומיין: <span className="text-foreground">{domainLabel(task.business_domain)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="min-w-[1100px] w-full text-sm">
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
                        <span className="font-medium">{task.subject || "משימה"}</span>
                      </td>
                      <td className="px-3 py-2">{where}</td>
                      <td className="px-3 py-2">{domainLabel(task.business_domain)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatShortDate(task.due_date)}</td>
                      <td className="px-3 py-2">{task.assigned_user_name ?? "—"}</td>
                      <td className="px-3 py-2">
                        {task.priority ? <StatusBadge value={task.priority} type="priority" /> : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="h-8 min-w-[120px] rounded-md border border-input bg-background px-2 text-xs"
                          value={task.status ?? "todo"}
                          disabled={updatingStatusId === task.id || deletingId === task.id}
                          onChange={(e) => void updateTaskStatus(task.id, e.target.value)}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {getTaskStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex gap-2">
                          <Button asChild type="button" variant="outline" size="sm">
                            <Link href={`/tasks/${encodeURIComponent(task.id)}`}>פרטים</Link>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={deletingId === task.id || updatingStatusId === task.id}
                            onClick={() => {
                              setEditId(task.id);
                              setEditOpen(true);
                            }}
                          >
                            עריכה
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={deletingId === task.id || updatingStatusId === task.id}
                            onClick={() => void deleteTask(task.id, task.subject || "משימה")}
                          >
                            {deletingId === task.id ? "מוחק..." : "מחיקה"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
            <div className="text-muted-foreground">
              עמוד {props.page} • מציגים {filteredTasks.length} מתוך {props.totalCount}
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
