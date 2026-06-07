"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMoreTasks } from "@/app/tasks/actions";
import type { TasksFilters } from "@/app/tasks/loadTasks";
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
  emitNavigationStart,
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  isExpenseBusinessDomain,
} from "@/lib/expenses";
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
  initialHasMore?: boolean;
  totalCount: number;
  projects: TaskOption[];
  properties: TaskOption[];
  users: UserOption[];
  canSeeAll?: boolean;
  initialFilters?: {
    q: string;
    status: string;
    priority: string;
    domain: string;
    linkedId: string;
    scope: "mine" | "all";
  };
};

const STATUS_OPTIONS = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;

function domainLabel(domain: string | null) {
  if (!domain) return "—";
  return isExpenseBusinessDomain(domain) ? getBusinessDomainLabel(domain) : domain;
}

type TaskUrlFilters = {
  q: string;
  status: string;
  priority: string;
  domain: string;
  linkedId: string;
  scope: "mine" | "all";
};

function buildTasksUrl(filters: TaskUrlFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.linkedId) params.set("linked_id", filters.linkedId);
  if (filters.scope === "all") params.set("scope", "all");
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

function handleNavigationStart() {
  emitNavigationStart();
}

export default function TasksPageClient(props: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlQ = searchParams.get("q") ?? "";
  const urlStatus = searchParams.get("status") ?? "";
  const urlPriority = searchParams.get("priority") ?? "";
  const urlDomain = searchParams.get("domain") ?? "";
  const urlLinkedId = searchParams.get("linked_id") ?? "";
  const canSeeAll = props.canSeeAll ?? false;
  const urlScope: "mine" | "all" = canSeeAll && searchParams.get("scope") === "all" ? "all" : "mine";

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  // Fetch-from-DB-as-you-scroll: accumulate task pages and pull the next one from
  // the server when the bottom comes into view (no "next page" button).
  const fetchFilters = useMemo<TasksFilters>(
    () => ({
      q: props.initialFilters?.q ?? "",
      status: props.initialFilters?.status ?? "",
      priority: props.initialFilters?.priority ?? "",
      domain: props.initialFilters?.domain ?? "",
      linkedId: props.initialFilters?.linkedId ?? "",
      scope: props.initialFilters?.scope ?? "mine",
    }),
    [props.initialFilters]
  );
  const fetchPage = useCallback(
    (page: number) => loadMoreTasks(page, fetchFilters),
    [fetchFilters]
  );
  const getRowId = useCallback((task: TaskListItem) => task.id, []);
  const {
    rows: localTasks,
    setRows: setLocalTasks,
    hasMore,
    loading: loadingMore,
    sentinelRef,
    mobileSentinelRef,
    scrollRef,
  } = useInfiniteScroll<TaskListItem>({
    initialRows: props.tasks,
    initialHasMore: props.initialHasMore ?? false,
    fetchPage,
    getId: getRowId,
  });

  // qInput is local state for immediate feedback while debouncing URL push
  const [qInput, setQInput] = useState(urlQ);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync qInput when URL q changes externally (e.g. browser back/forward)
  useEffect(() => {
    setQInput(urlQ);
  }, [urlQ]);

  const linkedFilterTarget =
    urlDomain === "logistics_projects"
      ? ("project" as const)
      : urlDomain === "property_management"
        ? ("property" as const)
        : ("" as const);

  const linkedFilterOptions =
    linkedFilterTarget === "project"
      ? props.projects
      : linkedFilterTarget === "property"
        ? props.properties
        : [];

  function pushFilters(filters: TaskUrlFilters) {
    emitNavigationStart();
    router.push(buildTasksUrl(filters));
  }

  function handleQChange(value: string) {
    setQInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      pushFilters({
        q: value,
        status: urlStatus,
        priority: urlPriority,
        domain: urlDomain,
        linkedId: urlLinkedId,
        scope: urlScope,
      });
    }, 400);
  }

  function handleStatusChange(value: string) {
    pushFilters({ q: urlQ, status: value, priority: urlPriority, domain: urlDomain, linkedId: urlLinkedId, scope: urlScope });
  }

  function handlePriorityChange(value: string) {
    pushFilters({ q: urlQ, status: urlStatus, priority: value, domain: urlDomain, linkedId: urlLinkedId, scope: urlScope });
  }

  function handleDomainChange(value: string) {
    pushFilters({ q: urlQ, status: urlStatus, priority: urlPriority, domain: value, linkedId: "", scope: urlScope });
  }

  function handleLinkedIdChange(value: string) {
    pushFilters({ q: urlQ, status: urlStatus, priority: urlPriority, domain: urlDomain, linkedId: value, scope: urlScope });
  }

  function handleScopeChange(value: "mine" | "all") {
    if (value === urlScope) return;
    pushFilters({ q: urlQ, status: urlStatus, priority: urlPriority, domain: urlDomain, linkedId: urlLinkedId, scope: value });
  }

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

      setLocalTasks((prev) => {
        // Marking a task done removes it from the open view (default + any
        // non-"done" status filter), so drop it instead of leaving a stale row.
        // When the user is explicitly viewing "done", keep it in place.
        if (status === "done" && urlStatus !== "done") {
          return prev.filter((task) => task.id !== taskId);
        }
        return prev.map((task) => (task.id === taskId ? { ...task, status } : task));
      });
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        {canSeeAll ? (
          <div className="flex rounded-xl border bg-secondary/40 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => handleScopeChange("mine")}
              className={`rounded-lg px-3 py-1 transition-colors ${
                urlScope === "mine"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary/10"
              }`}
            >
              המשימות שלי
            </button>
            <button
              type="button"
              onClick={() => handleScopeChange("all")}
              className={`rounded-lg px-3 py-1 transition-colors ${
                urlScope === "all"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary/10"
              }`}
            >
              כל המשימות
            </button>
          </div>
        ) : (
          <span />
        )}
        <Button type="button" onClick={() => setCreateOpen(true)}>
          הוספת משימה
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-1">
              <div className="text-[11px] text-muted-foreground">חיפוש</div>
              <Input
                value={qInput}
                onChange={(e) => handleQChange(e.target.value)}
                placeholder="חיפוש..."
              />
            </div>

            <div className="w-[120px] space-y-1">
              <div className="text-[11px] text-muted-foreground">סטטוס</div>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={urlStatus}
                onChange={(e) => handleStatusChange(e.target.value)}
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
                value={urlPriority}
                onChange={(e) => handlePriorityChange(e.target.value)}
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
                value={urlDomain}
                onChange={(e) => handleDomainChange(e.target.value)}
              >
                <option value="">הכל</option>
                {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {getBusinessDomainLabel(domain)}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-[11px] whitespace-nowrap text-muted-foreground">
              מוצגות {props.totalCount} משימות
            </div>
          </div>

          {linkedFilterTarget ? (
            <div className="mt-3 min-w-0 space-y-1 border-t pt-3">
              <div className="text-[11px] text-muted-foreground">
                {linkedFilterTarget === "project" ? "בחירת פרויקט" : "בחירת נכס"}
              </div>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:max-w-md"
                value={urlLinkedId}
                onChange={(e) => handleLinkedIdChange(e.target.value)}
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

      {localTasks.length === 0 ? (
        <div className="text-muted-foreground">אין משימות להצגה.</div>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {localTasks.map((task) => {
              const where = task.project_name ?? task.property_name ?? "—";
              return (
                <Card key={task.id} className="overflow-hidden">
                  <CardContent className="space-y-2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{task.subject || "משימה"}</div>
                      <div className="flex gap-2">
                        <Button asChild type="button" variant="outline" size="sm">
                          <Link href={`/tasks/${encodeURIComponent(task.id)}`} onClick={handleNavigationStart}>פרטים</Link>
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
          {hasMore ? <div ref={mobileSentinelRef} className="h-1 md:hidden" /> : null}

          <Card className="hidden overflow-hidden border-border/70 shadow-sm md:block">
            <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="px-4 py-3 text-right font-medium">משימה</th>
                  <th className="px-4 py-3 text-right font-medium">מקושר ל</th>
                  <th className="px-4 py-3 text-right font-medium">דומיין</th>
                  <th className="px-4 py-3 text-right font-medium">תאריך יעד</th>
                  <th className="px-4 py-3 text-right font-medium">משויך</th>
                  <th className="px-4 py-3 text-right font-medium">עדיפות</th>
                  <th className="px-4 py-3 text-right font-medium">סטטוס</th>
                  <th className="px-4 py-3 text-right font-medium">פעולות</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border/70">
                {localTasks.map((task) => {
                  const where = task.project_name ?? task.property_name ?? "—";
                  return (
                    <tr key={task.id} className="align-top hover:bg-muted/20">
                      <td className="px-4 py-4">
                        <span className="font-medium">{task.subject || "משימה"}</span>
                      </td>
                      <td className="px-4 py-4">{where}</td>
                      <td className="px-4 py-4">{domainLabel(task.business_domain)}</td>
                      <td className="px-4 py-4 whitespace-nowrap">{formatShortDate(task.due_date)}</td>
                      <td className="px-4 py-4">{task.assigned_user_name ?? "—"}</td>
                      <td className="px-4 py-4">
                        {task.priority ? <StatusBadge value={task.priority} type="priority" /> : "—"}
                      </td>
                      <td className="px-4 py-4">
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
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
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Button asChild type="button" variant="outline" size="sm">
                            <Link href={`/tasks/${encodeURIComponent(task.id)}`} onClick={handleNavigationStart}>פרטים</Link>
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
            {hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
            </div>
          </Card>

          <div className="border-t pt-4 text-center text-xs text-muted-foreground">
            {loadingMore ? "טוען…" : `מציג ${localTasks.length} מתוך ${props.totalCount} משימות`}
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
