"use client";

import { useEffect, useMemo, useState } from "react";
import { clearDraft, loadDraft, offlineFetch, saveDraft } from "@/lib/offline-queue";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  isExpenseBusinessDomain,
  mapProjectTypeToExpenseDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { getTaskPriorityLabel, getTaskStatusLabel } from "@/lib/ui/status-colors";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskTargetType = "project" | "property";

export type TaskOption = { id: string; label: string };
export type UserOption = { id: string; label: string };

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mode: Mode;
  taskId?: string | null;
  users: UserOption[];
  projects?: TaskOption[];
  properties?: TaskOption[];
  fixedTarget?: { type: TaskTargetType; id: string } | null;
  defaultProjectType?: string | null;
  onSaved?: () => void;
};

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Unknown error";
}

const STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];
const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];

function targetTypeForDomain(domain: ExpenseBusinessDomain): TaskTargetType | null {
  if (domain === "logistics_projects") return "project";
  if (domain === "property_management") return "property";
  return null;
}

function allowedDomainsForFixedTarget(
  fixedTarget: Props["fixedTarget"] | undefined,
  defaultDomain: ExpenseBusinessDomain
) {
  if (!fixedTarget) return [...EXPENSE_BUSINESS_DOMAINS];
  if (fixedTarget.type === "property") return ["property_management"] as ExpenseBusinessDomain[];
  if (fixedTarget.type === "project") return ["logistics_projects"] as ExpenseBusinessDomain[];
  return [defaultDomain];
}

export function TaskUpsertDialog(props: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const defaultDomain = useMemo<ExpenseBusinessDomain>(() => {
    if (props.defaultProjectType) return mapProjectTypeToExpenseDomain(props.defaultProjectType);
    return "general_business";
  }, [props.defaultProjectType]);

  const [projectId, setProjectId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  // Start blank when truly creating from scratch (no context); otherwise use defaultDomain.
  const initialDomain: ExpenseBusinessDomain | "" =
    props.mode === "create" && !props.fixedTarget && !props.defaultProjectType
      ? ""
      : defaultDomain;
  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain | "">(initialDomain);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("todo");

  const projects = props.projects ?? [];
  const properties = props.properties ?? [];

  const effectiveTarget = props.fixedTarget ?? null;
  const allowedDomains = useMemo(
    () => allowedDomainsForFixedTarget(props.fixedTarget, defaultDomain),
    [defaultDomain, props.fixedTarget]
  );
  const effectiveDomain: ExpenseBusinessDomain | "" =
    businessDomain === ""
      ? ""
      : allowedDomains.includes(businessDomain)
        ? businessDomain
        : allowedDomains[0] ?? defaultDomain;
  const derivedTargetType = effectiveDomain ? targetTypeForDomain(effectiveDomain) : null;
  const showTargetPicker = !effectiveTarget;

  const targetOk = effectiveTarget
    ? Boolean(effectiveTarget.id)
    : derivedTargetType === "project"
      ? Boolean(projectId)
      : derivedTargetType === "property"
        ? Boolean(propertyId)
        : true;

  const canSubmit =
    Boolean(subject.trim()) &&
    Boolean(dueDate) &&
    Boolean(assignedUserId) &&
    Boolean(businessDomain) &&
    Boolean(priority) &&
    Boolean(status) &&
    targetOk;

  async function loadTask(taskId: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks/get", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: taskId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to load task");
      const task = (json?.task ?? null) as Record<string, unknown> | null;
      if (!task) throw new Error("Task not found");

      const domainRaw = typeof task.business_domain === "string" ? task.business_domain : null;
      const nextDomain = isExpenseBusinessDomain(domainRaw) ? domainRaw : defaultDomain;
      setBusinessDomain(
        allowedDomains.includes(nextDomain) ? nextDomain : (allowedDomains[0] ?? defaultDomain)
      );

      const nextProjectId = typeof task.project_id === "string" ? task.project_id : "";
      const nextPropertyId = typeof task.property_id === "string" ? task.property_id : "";
      if (nextProjectId) {
        setProjectId(nextProjectId);
        setPropertyId("");
      } else if (nextPropertyId) {
        setPropertyId(nextPropertyId);
        setProjectId("");
      } else {
        setProjectId("");
        setPropertyId("");
      }

      setSubject(typeof task.subject === "string" ? task.subject : "");
      setDescription(typeof task.description === "string" ? task.description : "");
      setDueDate(typeof task.due_date === "string" ? task.due_date : "");
      setAssignedUserId(typeof task.assigned_user_id === "string" ? task.assigned_user_id : "");

      const priorityRaw = typeof task.priority === "string" ? task.priority : null;
      setPriority((PRIORITY_OPTIONS.includes(priorityRaw as TaskPriority) ? priorityRaw : "medium") as TaskPriority);

      const statusRaw = typeof task.status === "string" ? task.status : null;
      setStatus((STATUS_OPTIONS.includes(statusRaw as TaskStatus) ? statusRaw : "todo") as TaskStatus);
    } finally {
      setLoading(false);
    }
  }

  function resetForCreate() {
    const draft = loadDraft<{
      projectId: string; propertyId: string; businessDomain: ExpenseBusinessDomain;
      subject: string; description: string; dueDate: string;
      assignedUserId: string; priority: TaskPriority; status: TaskStatus;
    }>("task-create");

    setProjectId(draft?.projectId ?? (effectiveTarget?.type === "project" ? effectiveTarget.id : ""));
    setPropertyId(draft?.propertyId ?? (effectiveTarget?.type === "property" ? effectiveTarget.id : ""));
    const nextDomain = draft?.businessDomain ?? (
      effectiveTarget?.type === "property"
        ? "property_management"
        : allowedDomains.includes(defaultDomain)
          ? defaultDomain
          : (allowedDomains[0] ?? defaultDomain)
    );
    setBusinessDomain(allowedDomains.includes(nextDomain) ? nextDomain : (allowedDomains[0] ?? defaultDomain));
    setSubject(draft?.subject ?? "");
    setDescription(draft?.description ?? "");
    setDueDate(draft?.dueDate ?? "");
    setAssignedUserId(draft?.assignedUserId ?? "");
    setPriority(draft?.priority ?? "medium");
    setStatus(draft?.status ?? "todo");
  }

  useEffect(() => {
    if (!props.open) return;
    if (props.mode === "edit" && props.taskId) {
      void loadTask(props.taskId);
      return;
    }
    if (props.mode === "create") {
      resetForCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.mode, props.taskId]);

  useEffect(() => {
    if (businessDomain === "") return;
    if (!allowedDomains.includes(businessDomain)) {
      setBusinessDomain(allowedDomains[0] ?? defaultDomain);
    }
  }, [allowedDomains, businessDomain, defaultDomain]);

  // Auto-save draft while dialog is open in create mode
  useEffect(() => {
    if (!props.open || props.mode !== "create") return;
    saveDraft("task-create", { projectId, propertyId, businessDomain, subject, description, dueDate, assignedUserId, priority, status });
  }, [props.open, props.mode, projectId, propertyId, businessDomain, subject, description, dueDate, assignedUserId, priority, status]);

  function handleBusinessDomainChange(nextDomain: ExpenseBusinessDomain | "") {
    setBusinessDomain(nextDomain);
    if (effectiveTarget) return;
    if (!nextDomain) {
      setProjectId("");
      setPropertyId("");
      return;
    }

    const nextTargetType = targetTypeForDomain(nextDomain);
    if (nextTargetType === "property") {
      setProjectId("");
    } else if (nextTargetType === "project") {
      setPropertyId("");
    } else {
      setProjectId("");
      setPropertyId("");
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    emitProgressActivityStart();
    try {
      if (props.mode === "create") {
        const result = await offlineFetch("/api/tasks/create", {
          business_domain: effectiveDomain,
          project_id:
            (effectiveTarget?.type ?? derivedTargetType) === "project"
              ? effectiveTarget?.id ?? projectId
              : null,
          property_id:
            (effectiveTarget?.type ?? derivedTargetType) === "property"
              ? effectiveTarget?.id ?? propertyId
              : null,
          subject: subject.trim(),
          description: description.trim() ? description.trim() : null,
          due_date: dueDate,
          assigned_user_id: assignedUserId,
          priority,
          status,
        }, "משימה חדשה", { idempotent: true });

        if (result.queued) {
          clearDraft("task-create");
          props.onSaved?.();
          props.onOpenChange(false);
          return;
        }
        if (!result.ok) {
          toast.error("שגיאה ביצירת משימה", { description: result.error });
          return;
        }
        clearDraft("task-create");
        toast.success("המשימה נוצרה");
      } else {
        const result = await offlineFetch("/api/tasks/update", {
          id: props.taskId,
          business_domain: effectiveDomain,
          project_id:
            (effectiveTarget?.type ?? derivedTargetType) === "project"
              ? effectiveTarget?.id ?? projectId
              : null,
          property_id:
            (effectiveTarget?.type ?? derivedTargetType) === "property"
              ? effectiveTarget?.id ?? propertyId
              : null,
          subject: subject.trim(),
          description: description.trim() ? description.trim() : null,
          due_date: dueDate,
          assigned_user_id: assignedUserId,
          priority,
          status,
        }, "עדכון משימה");
        if (!result.queued && !result.ok) {
          toast.error("שגיאה בעדכון משימה", { description: result.error || "" });
          return;
        }
        if (!result.queued) toast.success("המשימה עודכנה");
      }

      props.onSaved?.();
      props.onOpenChange(false);
      router.refresh();
    } catch (error: unknown) {
      toast.error(props.mode === "create" ? "שגיאה ביצירת משימה" : "שגיאה בעדכון משימה", {
        description: getErrorMessage(error),
      });
    } finally {
      emitProgressActivityEnd();
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next && (saving || loading)) return;
        if (!next && props.mode === "create") clearDraft("task-create");
        props.onOpenChange(next);
      }}
    >
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>{props.mode === "create" ? "הוספת משימה" : "עריכת משימה"}</DialogTitle>
          <DialogDescription>
            {props.mode === "create"
              ? "יצירת משימה חדשה."
              : loading
                ? "טוען נתוני משימה..."
                : "עדכון פרטי משימה."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1">
            <div className="text-sm font-medium">תחום עסקי *</div>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={effectiveDomain}
              onChange={(e) => handleBusinessDomainChange(e.target.value as ExpenseBusinessDomain | "")}
            >
              {allowedDomains.length > 1 ? <option value="">בחרו תחום</option> : null}
              {allowedDomains.map((domain) => (
                <option key={domain} value={domain}>
                  {getBusinessDomainLabel(domain)}
                </option>
              ))}
            </select>
          </div>

          {showTargetPicker && derivedTargetType === "project" ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">פרויקט *</div>
              <ProjectPicker
                projects={projects}
                value={projectId}
                onChange={setProjectId}
                emptyLabel="בחר פרויקט..."
                allowClear={false}
              />
            </div>
          ) : null}

          {showTargetPicker && derivedTargetType === "property" ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">נכס *</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
              >
                <option value="">בחר נכס...</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {effectiveDomain ? (
            <>
          <div className="space-y-1">
            <div className="text-sm font-medium">כותרת *</div>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">תיאור (אופציונלי)</div>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך יעד *</div>
              <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">שיוך למשתמש *</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
              >
                <option value="">בחר משתמש...</option>
                {props.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.label}
                  </option>
                ))}
              </select>
            </div>
          </AdaptiveGrid>

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">עדיפות *</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {getTaskPriorityLabel(option)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">סטטוס *</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {getTaskStatusLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          </AdaptiveGrid>
            </>
          ) : null}

          <DialogFooter className="mt-6">
            <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)}>
              ביטול
            </Button>
            <Button type="submit" disabled={!canSubmit || saving || loading}>
              {saving ? "שומר..." : props.mode === "create" ? "יצירה" : "שמירה"}
            </Button>
          </DialogFooter>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}
