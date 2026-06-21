"use client";

// Lazy-loaded "tasks" tab, extracted from ProjectTabsClient so its code only
// downloads when the user opens the משימות tab.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  mapProjectTypeToExpenseDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { formatShortDate } from "@/lib/date";
import { getStatusDotClasses } from "@/lib/ui/status-color-classes";
import {
  getTaskPriorityColor,
  getTaskPriorityLabel,
  getTaskStatusColor,
  getTaskStatusLabel,
} from "@/lib/ui/status-colors";
import {
  TaskUpsertDialog,
  type TaskStatus,
  type TaskPriority,
} from "@/components/tasks/TaskUpsertDialog";
import type { AssignableUser } from "./ProjectTabsClient";

// Helpers duplicated from ProjectTabsClient so this module is self-contained.
function getString(row: Record<string, unknown> | null, key: string) {
  if (!row) return null;
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getFirstString(row: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value) return value;
  }
  return null;
}

function getFirstDate(row: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value) return value;
  }
  return null;
}

function formatDate(value: string | null) {
  return formatShortDate(value, "—");
}

function taskStatusLabel(status: TaskStatus | string) {
  return getTaskStatusLabel(status);
}

function taskPriorityLabel(priority: TaskPriority | string) {
  return getTaskPriorityLabel(priority);
}

function getErrorMessage(error: unknown) {
  return toHebrewError(error, "");
}

export function ProjectTasksTab({
  projectId,
  projectType,
  totalTasks,
  completedTasks,
  openTasks,
  tasks,
  error,
  usersById,
  assignableUsers,
  assignableUsersError,
  onChange,
  onTaskUpdated,
}: {
  projectId: string;
  projectType: string | null;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  tasks: Record<string, unknown>[];
  error: string | null;
  usersById: Map<string, AssignableUser>;
  assignableUsers: AssignableUser[];
  assignableUsersError: string | null;
  onChange: () => void;
  onTaskUpdated?: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{
    id: string;
    next: string;
    subject: string;
    current: string;
  } | null>(null);
  const [confirmPriorityOpen, setConfirmPriorityOpen] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [pendingPriority, setPendingPriority] = useState<{
    id: string;
    next: TaskPriority;
    subject: string;
    current: TaskPriority;
  } | null>(null);

  const [localTasks, setLocalTasks] = useState<Record<string, unknown>[]>(tasks);
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const [taskQuery, setTaskQuery] = useState("");
  const [filterTaskStatus, setFilterTaskStatus] = useState<TaskStatus | "">("");
  const [filterTaskPriority, setFilterTaskPriority] = useState<TaskPriority | "">("");
  const [filterAssigneeId, setFilterAssigneeId] = useState<string>("");

  const visibleTasks = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    return localTasks.filter((t) => {
      const taskStatus =
        (getFirstString(t, ["status", "task_status"]) ?? "todo") as TaskStatus;
      const taskPriority =
        (getFirstString(t, ["priority"]) ?? "") as TaskPriority | "";

      const assigneeId = getFirstString(t, ["assigned_user_id"]) ?? "";
      const assigneeName =
        getFirstString(t, [
          "assigned_user_name",
          "assigned_to_name",
          "assignee_name",
          "assigned_to_full_name",
        ]) ??
        (assigneeId ? usersById.get(assigneeId)?.full_name ?? usersById.get(assigneeId)?.email ?? "" : "");

      const title =
        getFirstString(t, ["subject", "title", "name", "task_title", "summary"]) ?? "";

      if (filterTaskStatus && taskStatus !== filterTaskStatus) return false;
      if (filterTaskPriority && taskPriority !== filterTaskPriority) return false;
      if (filterAssigneeId && assigneeId !== filterAssigneeId) return false;
      if (!q) return true;
      const hay = `${title} ${assigneeName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [filterAssigneeId, filterTaskPriority, filterTaskStatus, localTasks, taskQuery, usersById]);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [propertyTargetId, setPropertyTargetId] = useState("");
  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain>(() =>
    mapProjectTypeToExpenseDomain(projectType)
  );

  const statusOptions = useMemo(() => {
    return ["todo", "in_progress", "blocked", "done", "cancelled"] as TaskStatus[];
  }, []);

  const priorityOptions = useMemo(() => {
    return ["low", "medium", "high", "urgent"] as TaskPriority[];
  }, []);

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");

  const effectiveStatus = (status || statusOptions[0] || "todo") as TaskStatus;
  const effectivePriority = (priority || priorityOptions[0] || "") as TaskPriority;
  const projectLinkRequired = businessDomain === "logistics_projects";
  const propertyLinkRequired = businessDomain === "property_management";
  const canSubmit =
    Boolean(subject.trim()) &&
    Boolean(dueDate) &&
    Boolean(assignedUserId) &&
    Boolean(effectivePriority) &&
    Boolean(effectiveStatus) &&
    Boolean(businessDomain) &&
    (!propertyLinkRequired || Boolean(propertyTargetId.trim())) &&
    (!projectLinkRequired || Boolean(projectId));

  const subjectError = !subject.trim();
  const dueDateError = !dueDate;
  const assignedUserError = !assignedUserId;
  const propertyTargetError = propertyLinkRequired && !propertyTargetId.trim();
  const createTaskValidationMessage = (() => {
    if (creating || canSubmit) return "";
    const missing: string[] = [];
    if (subjectError) missing.push("כותרת");
    if (dueDateError) missing.push("תאריך יעד");
    if (assignedUserError) missing.push("שיוך למשתמש");
    if (propertyTargetError) missing.push("מזהה נכס");
    return missing.length > 0 ? `חסרים שדות חובה: ${missing.join(", ")}` : "";
  })();

  async function createTask() {
    if (!canSubmit) return;
    setCreating(true);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: businessDomain,
          project_id: projectLinkRequired ? projectId : null,
          property_id: propertyLinkRequired ? propertyTargetId.trim() : null,
          subject,
          description: description.trim() ? description : undefined,
          due_date: dueDate ? dueDate : null,
          assigned_user_id: assignedUserId ? assignedUserId : null,
          status: effectiveStatus,
          priority: effectivePriority,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה ביצירת משימה", { description: toHebrewError(json?.error, "") });
        return;
      }
      const createdTaskId =
        typeof json?.task?.id === "string"
          ? (json.task.id as string)
          : typeof json?.task?.task_id === "string"
            ? (json.task.task_id as string)
            : null;

      if (createdTaskId && createFiles.length > 0) {
        for (const file of createFiles) {
          const form = new FormData();
          form.set("task_id", createdTaskId);
          form.set("file", file);

          const uploadRes = await fetch("/api/tasks/attachments/upload", {
            method: "POST",
            body: form,
          });
          const uploadJson = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) {
            toast.error("שגיאה בהעלאת קובץ", {
              description: toHebrewError(uploadJson?.error, ""),
            });
            break;
          }
        }
      }

      toast.success("המשימה נוצרה");
      setCreateOpen(false);
      setSubject("");
      setDescription("");
      setDueDate("");
      setAssignedUserId("");
      setPropertyTargetId("");
      setPriority("");
      setStatus("");
      setCreateFiles([]);
      onChange();
    } catch (e: unknown) {
      toast.error("שגיאה ביצירת משימה", { description: getErrorMessage(e) });
    } finally {
      emitProgressActivityEnd();
      setCreating(false);
    }
  }

  async function updateStatus(id: string, status: TaskStatus) {
    setUpdatingId(id);
    emitProgressActivityStart();
    try {
      const result = await offlineFetch(
        "/api/tasks/update-status",
        { id, status },
        "עדכון סטטוס משימה"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה בעדכון סטטוס", { description: toHebrewError(result.error, "") });
        return false;
      }
      if (!result.queued) toast.success("הסטטוס עודכן");
      setLocalTasks((prev) =>
        prev.map((row) => {
          const rowId = getFirstString(row, ["task_id", "id"]);
          if (rowId !== id) return row;
          return { ...row, status };
        })
      );
      onTaskUpdated?.(id, { status });
      onChange();
      return true;
    } catch (e: unknown) {
      toast.error("שגיאה בעדכון סטטוס", { description: getErrorMessage(e) });
      return false;
    } finally {
      emitProgressActivityEnd();
      setUpdatingId(null);
    }
  }

  async function updatePriority(id: string, priority: TaskPriority) {
    setUpdatingId(id);
    emitProgressActivityStart();
    try {
      const result = await offlineFetch(
        "/api/tasks/update-priority",
        { id, priority },
        "עדכון עדיפות משימה"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה בעדכון עדיפות", { description: toHebrewError(result.error, "") });
        return false;
      }
      if (!result.queued) toast.success("העדיפות עודכנה");
      setLocalTasks((prev) =>
        prev.map((row) => {
          const rowId = getFirstString(row, ["task_id", "id"]);
          if (rowId !== id) return row;
          return { ...row, priority };
        })
      );
      onTaskUpdated?.(id, { priority });
      onChange();
      return true;
    } catch (e: unknown) {
      toast.error("שגיאה בעדכון עדיפות", { description: getErrorMessage(e) });
      return false;
    } finally {
      emitProgressActivityEnd();
      setUpdatingId(null);
    }
  }

  function requestStatusChange(args: {
    id: string;
    next: TaskStatus;
    subject: string;
    current: TaskStatus;
  }) {
    setPendingStatus(args);
    setConfirmOpen(true);
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    setSavingStatus(true);
    try {
      const ok = await updateStatus(
        pendingStatus.id,
        pendingStatus.next as TaskStatus
      );
      if (ok) {
        setConfirmOpen(false);
        setPendingStatus(null);
      }
    } finally {
      setSavingStatus(false);
    }
  }

  function requestPriorityChange(args: {
    id: string;
    next: TaskPriority;
    subject: string;
    current: TaskPriority;
  }) {
    setPendingPriority(args);
    setConfirmPriorityOpen(true);
  }

  async function confirmPriorityChange() {
    if (!pendingPriority) return;
    setSavingPriority(true);
    try {
      const ok = await updatePriority(pendingPriority.id, pendingPriority.next);
      if (ok) {
        setConfirmPriorityOpen(false);
        setPendingPriority(null);
      }
    } finally {
      setSavingPriority(false);
    }
  }

  async function deleteTask(id: string, subject: string) {
    const ok = window.confirm(`למחוק את המשימה "${subject}"?`);
    if (!ok) return;

    setDeletingTaskId(id);
    emitProgressActivityStart();
    try {
      const result = await offlineFetch("/api/tasks/delete", { id }, "מחיקת משימה");
      if (!result.queued && !result.ok) {
        toast.error("שגיאה במחיקת משימה", { description: toHebrewError(result.error, "") });
        return;
      }

      if (!result.queued) toast.success("המשימה נמחקה");
      setLocalTasks((prev) =>
        prev.filter((row) => (getFirstString(row, ["task_id", "id"]) ?? "") !== id)
      );
      onChange();
    } catch (e: unknown) {
      toast.error("שגיאה במחיקת משימה", { description: getErrorMessage(e) });
    } finally {
      emitProgressActivityEnd();
      setDeletingTaskId(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">משימות</CardTitle>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            הוספת משימה
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">סה״כ</div>
              <div className="font-medium">{totalTasks}</div>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">פתוחות</div>
              <div className="font-medium">{openTasks}</div>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">הושלמו</div>
              <div className="font-medium">{completedTasks}</div>
            </div>
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1 xl:col-span-2">
              <div className="text-xs text-muted-foreground">חיפוש</div>
              <Input
                value={taskQuery}
                onChange={(e) => setTaskQuery(e.target.value)}
                placeholder="חיפוש משימות..."
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">סטטוס</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterTaskStatus}
                onChange={(e) => setFilterTaskStatus(e.target.value as TaskStatus | "")}
              >
                <option value="">הכל</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {taskStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">עדיפות</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterTaskPriority}
                onChange={(e) => setFilterTaskPriority(e.target.value as TaskPriority | "")}
              >
                <option value="">הכל</option>
                {priorityOptions.map((p) => (
                  <option key={p} value={p}>
                    {taskPriorityLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">משויך</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterAssigneeId}
                onChange={(e) => setFilterAssigneeId(e.target.value)}
              >
                <option value="">הכל</option>
                {assignableUsers
                  .filter((u) => u.active !== false)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name ?? u.email}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {error ? (
            <div className="text-destructive text-sm">
              שגיאה בטעינת משימות: {error}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-muted-foreground">אין משימות להצגה.</div>
          ) : visibleTasks.length === 0 ? (
            <div className="text-muted-foreground">אין משימות לפי הסינון.</div>
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {visibleTasks.map((t) => {
                  const taskId = getFirstString(t, ["task_id", "id"]) ?? "";
                  const title =
                    getFirstString(t, ["subject", "title", "name", "task_title", "summary"]) ??
                    "משימה";
                  const status =
                    (getFirstString(t, ["status", "task_status"]) ?? "todo") as TaskStatus;
                  const due =
                    getFirstDate(t, ["due_date", "deadline", "end_date"]) ?? null;
                  const priority =
                    (getFirstString(t, ["priority"]) ?? "") as TaskPriority | "";
                  const assignee =
                    getFirstString(t, [
                      "assigned_user_name",
                      "assigned_to_name",
                      "assignee_name",
                      "assigned_to_full_name",
                    ]) ??
                    (() => {
                      const id = getFirstString(t, ["assigned_user_id"]);
                      if (!id) return null;
                      const u = usersById.get(id);
                      return u?.full_name ?? u?.email ?? null;
                    })() ??
                    null;

                  return (
                    <Card key={taskId || title}>
                      <CardContent className="space-y-3 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          {taskId ? (
                            <Link
                              href={`/tasks/${taskId}?returnTo=${encodeURIComponent(
                                `/projects/${projectId}?tab=tasks`
                              )}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {title}
                            </Link>
                          ) : (
                            <div className="font-medium">{title}</div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          {priority ? <StatusBadge value={priority} type="priority" /> : null}
                          <StatusBadge value={status} type="task" />
                        </div>
                        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                          <div>
                            יעד:{" "}
                            <span className="text-foreground">
                              {due ? formatDate(due) : "—"}
                            </span>
                          </div>
                          <div>
                            משויך:{" "}
                            <span className="text-foreground">{assignee ?? "—"}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-10"
                            disabled={!taskId || deletingTaskId === taskId}
                            onClick={() => {
                              setEditId(taskId);
                              setEditOpen(true);
                            }}
                          >
                            עריכה
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="h-10"
                            disabled={!taskId || deletingTaskId === taskId}
                            onClick={() => void deleteTask(taskId, title)}
                          >
                            {deletingTaskId === taskId ? "מוחק..." : "מחיקה"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="hidden max-h-[70vh] overflow-auto md:block rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                    <tr>
                      <th className="text-right font-medium px-3 py-2">משימה</th>
                      <th className="text-right font-medium px-3 py-2">תאריך יעד</th>
                      <th className="text-right font-medium px-3 py-2">משויך</th>
                      <th className="text-right font-medium px-3 py-2">עדיפות</th>
                      <th className="text-right font-medium px-3 py-2">סטטוס</th>
                      <th className="text-right font-medium px-3 py-2">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibleTasks.map((t) => {
                      const taskId = getFirstString(t, ["task_id", "id"]) ?? "";
                      const title =
                        getFirstString(t, [
                          "subject",
                          "title",
                          "name",
                          "task_title",
                          "summary",
                        ]) ?? "משימה";
                      const status =
                        (getFirstString(t, ["status", "task_status"]) ?? "todo") as TaskStatus;
                      const due =
                        getFirstDate(t, ["due_date", "deadline", "end_date"]) ?? null;
                      const priority =
                        (getFirstString(t, ["priority"]) ?? "") as TaskPriority | "";
                      const assignee =
                        getFirstString(t, [
                          "assigned_user_name",
                          "assigned_to_name",
                          "assignee_name",
                          "assigned_to_full_name",
                        ]) ??
                        (() => {
                          const id = getFirstString(t, ["assigned_user_id"]);
                          if (!id) return null;
                          const u = usersById.get(id);
                          return u?.full_name ?? u?.email ?? null;
                        })() ??
                        null;

                      const disabled = !taskId || updatingId === taskId || deletingTaskId === taskId;

                      return (
                        <tr key={taskId || title} className="hover:bg-muted/30">
                          <td className="px-3 py-2">
                            {taskId ? (
                              <Link
                                href={`/tasks/${taskId}?returnTo=${encodeURIComponent(
                                  `/projects/${projectId}?tab=tasks`
                                )}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {title}
                              </Link>
                            ) : (
                              <span className="font-medium">{title}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {due ? formatDate(due) : "—"}
                          </td>
                          <td className="px-3 py-2">{assignee ? assignee : "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {priority ? (
                              <PriorityDropdown
                                priority={priority}
                                options={priorityOptions}
                                disabled={disabled}
                                onSelect={(next) => {
                                  if (next === priority) return;
                                  requestPriorityChange({
                                    id: taskId,
                                    next,
                                    subject: title,
                                    current: priority,
                                  });
                                }}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <StatusDropdown
                              status={status}
                              options={statusOptions}
                              disabled={disabled}
                              onSelect={(next) => {
                                if (next === status) return;
                                requestStatusChange({
                                  id: taskId,
                                  next,
                                  subject: title,
                                  current: status,
                                });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!taskId || deletingTaskId === taskId}
                                onClick={() => {
                                  setEditId(taskId);
                                  setEditOpen(true);
                                }}
                              >
                                עריכה
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={!taskId || deletingTaskId === taskId}
                                onClick={() => void deleteTask(taskId, title)}
                              >
                                {deletingTaskId === taskId ? "מוחק..." : "מחיקה"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>אישור שינוי סטטוס</DialogTitle>
            <DialogDescription>
              {pendingStatus
                ? `לשנות את הסטטוס של “${pendingStatus.subject}” מ־${taskStatusLabel(
                    pendingStatus.current
                  )} ל־${taskStatusLabel(pendingStatus.next)}?`
                : " "}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={savingStatus}
              onClick={() => {
                setConfirmOpen(false);
                setPendingStatus(null);
              }}
            >
              ביטול
            </Button>
            <Button
              type="button"
              disabled={savingStatus}
              onClick={() => void confirmStatusChange()}
            >
              {savingStatus ? "מעדכן..." : "אישור"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={confirmPriorityOpen}
        onOpenChange={setConfirmPriorityOpen}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>אישור שינוי עדיפות</DialogTitle>
            <DialogDescription>
              {pendingPriority
                ? `לשנות את העדיפות של “${pendingPriority.subject}” מ־${taskPriorityLabel(
                    pendingPriority.current
                  )} ל־${taskPriorityLabel(pendingPriority.next)}?`
                : " "}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={savingPriority}
              onClick={() => {
                setConfirmPriorityOpen(false);
                setPendingPriority(null);
              }}
            >
              ביטול
            </Button>
            <Button
              type="button"
              disabled={savingPriority}
              onClick={() => void confirmPriorityChange()}
            >
              {savingPriority ? "מעדכן..." : "אישור"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateFiles([]);
            setPropertyTargetId("");
          }
        }}
      >
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>הוספת משימה</DialogTitle>
            <DialogDescription>
              {projectLinkRequired
                ? "משימה תתווסף לפרויקט ותופיע ברשימה."
                : propertyLinkRequired
                  ? "הזינו את מזהה הנכס שאליו המשימה קשורה."
                  : "משימה שוטפת ללא קישור ישיר לפרויקט או נכס."}
            </DialogDescription>
          </DialogHeader>

          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createTask();
            }}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium">כותרת *</div>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="לדוגמה: להתקשר לספק"
                aria-invalid={subjectError}
                className={
                  subjectError ? "border-destructive focus-visible:ring-destructive" : ""
                }
              />
              {subjectError ? (
                <div className="text-xs text-destructive">שדה חובה</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תיאור (אופציונלי)</div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="פרטים נוספים..."
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך יעד *</div>
              <DateInput
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-invalid={dueDateError}
                className={
                  dueDateError ? "border-destructive focus-visible:ring-destructive" : ""
                }
              />
              {dueDateError ? (
                <div className="text-xs text-destructive">שדה חובה</div>
              ) : null}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">שיוך למשתמש *</div>
              {assignableUsersError ? (
                <div className="text-xs text-destructive">
                  שגיאה בטעינת משתמשים: {assignableUsersError}
                </div>
              ) : (
                <select
                  className={
                    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm " +
                    (assignedUserError ? "border-destructive" : "")
                  }
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                >
                  <option value="">בחר משתמש…</option>
                  {assignableUsers
                    .filter((u) => u.active !== false)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name ?? u.email}
                      </option>
                    ))}
                </select>
              )}
              {!assignableUsersError && assignedUserError ? (
                <div className="text-xs text-destructive">שדה חובה</div>
              ) : null}
            </div>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">דומיין *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={businessDomain}
                  onChange={(e) => {
                    const nextDomain = e.target.value as ExpenseBusinessDomain;
                    setBusinessDomain(nextDomain);
                    if (nextDomain !== "property_management") {
                      setPropertyTargetId("");
                    }
                  }}
                >
                  {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                    <option key={domain} value={domain}>
                      {getBusinessDomainLabel(domain)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">עדיפות *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={effectivePriority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {priorityOptions.map((p) => (
                    <option key={p} value={p}>
                      {taskPriorityLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">סטטוס *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={effectiveStatus}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {taskStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </AdaptiveGrid>

            {projectLinkRequired ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">מזהה פרויקט</div>
                <Input value={projectId} readOnly disabled />
              </div>
            ) : null}

            {propertyLinkRequired ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">מזהה נכס *</div>
                <Input
                  value={propertyTargetId}
                  onChange={(e) => setPropertyTargetId(e.target.value)}
                  placeholder="הזינו מזהה נכס"
                  aria-invalid={propertyTargetError}
                  className={
                    propertyTargetError
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                />
                {propertyTargetError ? (
                  <div className="text-xs text-destructive">שדה חובה</div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">
                {"\u05E7\u05D1\u05E6\u05D9\u05DD \u05DE\u05E6\u05D5\u05E8\u05E4\u05D9\u05DD (\u05D0\u05D5\u05E4\u05E6\u05D9\u05D5\u05E0\u05DC\u05D9)"}
              </div>
              <div className="flex items-center justify-between gap-2">
                <FileUploadActions
                  files={createFiles}
                  accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
                  multiple
                  onFilesSelected={setCreateFiles}
                  chooseLabel={
                    createFiles.length > 0
                      ? "\u05E9\u05D9\u05E0\u05D5\u05D9 \u05E7\u05D1\u05E6\u05D9\u05DD"
                      : "\u05D1\u05D7\u05D9\u05E8\u05EA \u05E7\u05D1\u05E6\u05D9\u05DD"
                  }
                />
                <div className="text-xs text-muted-foreground">
                  {createFiles.length} {"\u05E7\u05D1\u05E6\u05D9\u05DD"}
                </div>
              </div>
              {createFiles.length > 0 ? (
                <div className="text-xs text-muted-foreground truncate">
                  {createFiles
                    .slice(0, 3)
                    .map((f) => f.name)
                    .join(", ")}
                  {createFiles.length > 3 ? ` +${createFiles.length - 3}` : ""}
                </div>
              ) : null}
            </div>

            <DialogFooter className="mt-6">
              {!canSubmit && !creating ? (
                <div className="me-auto text-xs text-destructive">
                  {createTaskValidationMessage}
                </div>
              ) : (
                <div className="me-auto" />
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreateOpen(false)}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={creating || !canSubmit}>
                {creating ? "יוצר..." : "יצירה"}
              </Button>
            </DialogFooter>
          </form>
        </AdaptiveDialog>
      </Dialog>

      <TaskUpsertDialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditId(null);
        }}
        mode="edit"
        taskId={editId}
        users={assignableUsers
          .filter((u) => u.active !== false)
          .map((u) => ({ id: u.id, label: u.full_name ?? u.email }))}
        fixedTarget={{ type: "project", id: projectId }}
        defaultProjectType={projectType}
        onSaved={onChange}
      />
    </>
  );
}

function StatusDropdown({
  status,
  options,
  disabled,
  onSelect,
}: {
  status: TaskStatus;
  options: TaskStatus[];
  disabled: boolean;
  onSelect: (next: TaskStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled}>
          <StatusBadge value={status} type="task" className="h-9 px-3 text-sm cursor-pointer select-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)}>
            <span className="me-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${getStatusDotClasses(getTaskStatusColor(opt))}`} />
            </span>
            {getTaskStatusLabel(opt)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-xs text-muted-foreground">
          שינוי סטטוס יעדכן את המשימה
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityDropdown({
  priority,
  options,
  disabled,
  onSelect,
}: {
  priority: TaskPriority;
  options: TaskPriority[];
  disabled: boolean;
  onSelect: (next: TaskPriority) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled}>
          <StatusBadge
            value={priority}
            type="priority"
            className="h-9 px-3 text-sm cursor-pointer select-none"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)}>
            <span className="me-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${getStatusDotClasses(getTaskPriorityColor(opt))}`} />
            </span>
            {getTaskPriorityLabel(opt)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-xs text-muted-foreground">
          שינוי עדיפות יעדכן את המשימה
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function projectTypeLabel(value: string) {
  switch (value) {
    case "logistics":
      return "\u05dc\u05d5\u05d2\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4";
    case "construction":
      return "\u05e9\u05d9\u05e4\u05d5\u05e6\u05d9\u05dd";
    case "moving":
      return "\u05d4\u05d5\u05d1\u05dc\u05d4";
    default:
      return value;
  }
}

