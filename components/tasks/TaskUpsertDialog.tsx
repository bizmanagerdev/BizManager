"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearDraft, loadDraft, offlineFetch, saveDraft } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  AlignLeft,
  Bell,
  Briefcase,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  Tag,
  Users,
  X,
} from "lucide-react";
import {
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { formatShortDateTime } from "@/lib/date";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  isExpenseBusinessDomain,
  mapProjectTypeToExpenseDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { getTaskPriorityLabel, getTaskStatusLabel } from "@/lib/ui/status-colors";
import { CITY_OPTIONS } from "@/lib/ui/cities";

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
  // Pre-fill status / title for board quick-add and the create stepper.
  defaultStatus?: TaskStatus;
  defaultSubject?: string;
  // The signed-in user — enables the optional "add me as a member" toggle.
  currentUserId?: string;
  // Guided step-by-step creation (Next → Next → Save). Defaults to false.
  wizard?: boolean;
  onSaved?: () => void;
};

// Step order for the guided create flow — must match the action-chip order below
// (תיאור · תחום · תאריך · אחראי וחברים · עדיפות וסטטוס · מיקום).
const WIZARD_STEPS = ["description", "domain", "dates", "people", "labels", "location"] as const;
function nextWizardStep(current: string | null): string | null {
  const list = WIZARD_STEPS as readonly string[];
  const i = current ? list.indexOf(current) : -1;
  if (i === -1) return list[0];
  return i < list.length - 1 ? list[i + 1] : null;
}

type CommentItem = {
  id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
};

type ReminderItem = {
  id: string;
  remind_at: string;
  content: string | null;
  status: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
};

function getErrorMessage(err: unknown) {
  return toHebrewError(err, "Unknown error");
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

// Trello-style "add detail" button that toggles an editor section.
function ActionChip({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Bell;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
        active ? "border-primary/40 bg-primary/10 text-primary" : "bg-background hover:bg-muted"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export function TaskUpsertDialog(props: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Only one section open at a time (accordion). Description is the default-open one.
  const wizard = props.wizard ?? false;
  const [openSection, setOpenSection] = useState<string | null>("description");
  const isOpen = (key: string) => openSection === key;
  function toggleSection(key: string) {
    setOpenSection((prev) => (prev === key ? null : key));
  }

  const defaultDomain = useMemo<ExpenseBusinessDomain>(() => {
    if (props.defaultProjectType) return mapProjectTypeToExpenseDomain(props.defaultProjectType);
    return "general_business";
  }, [props.defaultProjectType]);

  const [projectId, setProjectId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const initialDomain: ExpenseBusinessDomain | "" =
    props.mode === "create" && !props.fixedTarget && !props.defaultProjectType
      ? ""
      : defaultDomain;
  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain | "">(initialDomain);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [city, setCity] = useState("");
  const [cityOther, setCityOther] = useState(false); // free-text city ("אחר")
  const [address, setAddress] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>(props.defaultStatus ?? "todo");

  // The card extras (comments / reminders) need a saved task. activeTaskId is the
  // edit target, or the id of a just-created task when keepOpenAfterCreate is set.
  const [activeTaskId, setActiveTaskId] = useState<string | null>(props.taskId ?? null);
  const isEditing = props.mode === "edit" || activeTaskId !== null;

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);

  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [reminderAt, setReminderAt] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [addingReminder, setAddingReminder] = useState(false);

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

  // Only the task name is required. Everything else is optional and can be added
  // later by reopening the card. (targetOk still applies: once a domain that needs
  // a project/property is chosen, that link must be filled in.)
  const canSubmit = Boolean(subject.trim()) && targetOk;

  const memberOptions = useMemo(
    () => props.users.filter((u) => u.id !== assignedUserId),
    [props.users, assignedUserId]
  );
  const selectedMembers = useMemo(
    () => memberIds.map((id) => props.users.find((u) => u.id === id)).filter((u): u is UserOption => Boolean(u)),
    [memberIds, props.users]
  );
  // The creator is never auto-added. They can opt in unless they're the assignee.
  const meId = props.currentUserId ?? "";
  const canAddSelf = Boolean(meId) && meId !== assignedUserId;

  const loadCard = useCallback(
    async (taskId: string) => {
      setLoading(true);
      try {
        const res = await fetch("/api/tasks/get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: taskId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(toHebrewError(json?.error, "טעינת המשימה נכשלה."));
        const task = (json?.task ?? null) as Record<string, unknown> | null;
        if (!task) throw new Error("המשימה לא נמצאה.");

        const domainRaw = typeof task.business_domain === "string" ? task.business_domain : null;
        const nextDomain = isExpenseBusinessDomain(domainRaw) ? domainRaw : defaultDomain;
        setBusinessDomain(
          allowedDomains.includes(nextDomain) ? nextDomain : (allowedDomains[0] ?? defaultDomain)
        );

        const nextProjectId = typeof task.project_id === "string" ? task.project_id : "";
        const nextPropertyId = typeof task.property_id === "string" ? task.property_id : "";
        setProjectId(nextProjectId);
        setPropertyId(nextProjectId ? "" : nextPropertyId);

        setSubject(typeof task.subject === "string" ? task.subject : "");
        setDescription(typeof task.description === "string" ? task.description : "");
        // due_date may come back as a full timestamp — keep only the date part.
        setDueDate(typeof task.due_date === "string" ? task.due_date.slice(0, 10) : "");
        setDueTime(typeof task.due_time === "string" ? task.due_time : "");
        const taskCity = typeof task.city === "string" ? task.city : "";
        setCity(taskCity);
        setCityOther(Boolean(taskCity) && !(CITY_OPTIONS as readonly string[]).includes(taskCity));
        setAddress(typeof task.address === "string" ? task.address : "");
        setAssignedUserId(typeof task.assigned_user_id === "string" ? task.assigned_user_id : "");

        const priorityRaw = typeof task.priority === "string" ? task.priority : null;
        setPriority((PRIORITY_OPTIONS.includes(priorityRaw as TaskPriority) ? priorityRaw : "medium") as TaskPriority);
        const statusRaw = typeof task.status === "string" ? task.status : null;
        setStatus((STATUS_OPTIONS.includes(statusRaw as TaskStatus) ? statusRaw : "todo") as TaskStatus);

        const membersRaw = Array.isArray(json?.members) ? (json.members as Array<{ id?: unknown }>) : [];
        setMemberIds(membersRaw.map((m) => (typeof m.id === "string" ? m.id : "")).filter(Boolean));
        setComments(Array.isArray(json?.comments) ? (json.comments as CommentItem[]) : []);
        setReminders(Array.isArray(json?.reminders) ? (json.reminders as ReminderItem[]) : []);

        // Open on the description by default; the user opens one section at a time.
        setOpenSection("description");
      } catch (error: unknown) {
        toast.error(toHebrewError(error, "טעינת המשימה נכשלה."));
        props.onOpenChange(false);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allowedDomains, defaultDomain]
  );

  function resetForCreate() {
    const draft = loadDraft<{
      projectId: string; propertyId: string; businessDomain: ExpenseBusinessDomain;
      subject: string; description: string; dueDate: string; dueTime: string;
      city: string; address: string; assignedUserId: string; memberIds: string[];
      priority: TaskPriority; status: TaskStatus;
    }>("task-create");

    setActiveTaskId(null);
    setComments([]);
    setReminders([]);
    setNewComment("");
    setReminderAt("");
    setReminderNote("");

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
    setSubject(props.defaultSubject?.trim() ? props.defaultSubject : draft?.subject ?? "");
    setDescription(draft?.description ?? "");
    setDueDate(draft?.dueDate ?? "");
    setDueTime(draft?.dueTime ?? "");
    const draftCity = draft?.city ?? "";
    setCity(draftCity);
    setCityOther(Boolean(draftCity) && !(CITY_OPTIONS as readonly string[]).includes(draftCity));
    setAddress(draft?.address ?? "");
    setAssignedUserId(draft?.assignedUserId ?? "");
    setMemberIds(Array.isArray(draft?.memberIds) ? draft.memberIds : []);
    setPriority(draft?.priority ?? "medium");
    setStatus(props.defaultStatus ?? draft?.status ?? "todo");

    setOpenSection("description");
  }

  useEffect(() => {
    if (!props.open) return;
    if (props.mode === "edit" && props.taskId) {
      setActiveTaskId(props.taskId);
      void loadCard(props.taskId);
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

  // Auto-save draft while creating (only before the first save).
  useEffect(() => {
    if (!props.open || props.mode !== "create" || activeTaskId) return;
    saveDraft("task-create", {
      projectId, propertyId, businessDomain, subject, description, dueDate, dueTime,
      city, address, assignedUserId, memberIds, priority, status,
    });
  }, [props.open, props.mode, activeTaskId, projectId, propertyId, businessDomain, subject, description, dueDate, dueTime, city, address, assignedUserId, memberIds, priority, status]);

  function handleBusinessDomainChange(nextDomain: ExpenseBusinessDomain | "") {
    setBusinessDomain(nextDomain);
    if (effectiveTarget) return;
    const nextTargetType = nextDomain ? targetTypeForDomain(nextDomain) : null;
    if (nextTargetType === "property") setProjectId("");
    else if (nextTargetType === "project") setPropertyId("");
    else {
      setProjectId("");
      setPropertyId("");
    }
  }

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  function buildPayload() {
    const linkType = effectiveTarget?.type ?? derivedTargetType;
    return {
      // No domain chosen → default to general business (no project/property link).
      business_domain: effectiveDomain || "general_business",
      project_id: linkType === "project" ? effectiveTarget?.id ?? projectId : null,
      property_id: linkType === "property" ? effectiveTarget?.id ?? propertyId : null,
      subject: subject.trim(),
      description: description.trim() ? description.trim() : null,
      due_date: dueDate || null,
      due_time: dueTime || null,
      city: city.trim() ? city.trim() : null,
      address: address.trim() ? address.trim() : null,
      assigned_user_id: assignedUserId || null,
      member_ids: memberIds,
      priority,
      status,
    };
  }

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    emitProgressActivityStart();
    try {
      if (!isEditing) {
        const result = await offlineFetch("/api/tasks/create", buildPayload(), "משימה חדשה", { idempotent: true });
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
        props.onSaved?.();
        // Close so the new task shows in the list (no lingering edit dialog).
        props.onOpenChange(false);
        router.refresh();
        return;
      }

      const targetId = activeTaskId ?? props.taskId;
      const result = await offlineFetch(
        "/api/tasks/update",
        { id: targetId, ...buildPayload() },
        "עדכון משימה"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה בעדכון משימה", { description: toHebrewError(result.error, "") });
        return;
      }
      if (!result.queued) toast.success("המשימה עודכנה");
      props.onSaved?.();
      props.onOpenChange(false);
      router.refresh();
    } catch (error: unknown) {
      toast.error(isEditing ? "שגיאה בעדכון משימה" : "שגיאה ביצירת משימה", {
        description: getErrorMessage(error),
      });
    } finally {
      emitProgressActivityEnd();
      setSaving(false);
    }
  }

  async function addComment() {
    const targetId = activeTaskId ?? props.taskId;
    if (!targetId || !newComment.trim()) return;
    setAddingComment(true);
    emitProgressActivityStart();
    try {
      const result = await offlineFetch(
        "/api/tasks/add-comment",
        { task_id: targetId, message: newComment.trim() },
        "תגובה למשימה",
        { idempotent: true }
      );
      if (result.queued) {
        setNewComment("");
        return;
      }
      if (!result.ok) {
        toast.error("שגיאה בהוספת תגובה", { description: toHebrewError(result.error, "") });
        return;
      }
      const comment =
        result.data && typeof result.data === "object" && "comment" in result.data
          ? ((result.data as { comment?: CommentItem | null }).comment ?? null)
          : null;
      if (comment) setComments((prev) => [...prev, comment]);
      setNewComment("");
    } catch (error: unknown) {
      toast.error("שגיאה בהוספת תגובה", { description: getErrorMessage(error) });
    } finally {
      emitProgressActivityEnd();
      setAddingComment(false);
    }
  }

  async function addReminder() {
    const targetId = activeTaskId ?? props.taskId;
    if (!targetId || !reminderAt) return;
    setAddingReminder(true);
    emitProgressActivityStart();
    try {
      const remindIso = new Date(reminderAt).toISOString();
      const result = await offlineFetch(
        "/api/tasks/reminders/create",
        { task_id: targetId, remind_at: remindIso, content: reminderNote.trim() || null },
        "תזכורת למשימה",
        { idempotent: true }
      );
      if (result.queued) {
        setReminderAt("");
        setReminderNote("");
        return;
      }
      if (!result.ok) {
        toast.error("שגיאה בהוספת תזכורת", { description: toHebrewError(result.error, "") });
        return;
      }
      const reminder =
        result.data && typeof result.data === "object" && "reminder" in result.data
          ? ((result.data as { reminder?: Partial<ReminderItem> | null }).reminder ?? null)
          : null;
      setReminders((prev) => [
        ...prev,
        {
          id: reminder?.id ?? crypto.randomUUID(),
          remind_at: reminder?.remind_at ?? remindIso,
          content: reminder?.content ?? (reminderNote.trim() || null),
          status: "pending",
          assigned_to: reminder?.assigned_to ?? assignedUserId,
          assigned_to_name: null,
        },
      ]);
      setReminderAt("");
      setReminderNote("");
      toast.success("התזכורת נוספה");
    } catch (error: unknown) {
      toast.error("שגיאה בהוספת תזכורת", { description: getErrorMessage(error) });
    } finally {
      emitProgressActivityEnd();
      setAddingReminder(false);
    }
  }

  async function setReminderStatus(id: string, nextStatus: "done" | "cancelled") {
    setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
    try {
      const result = await offlineFetch(
        "/api/tasks/reminders/update",
        { id, status: nextStatus },
        nextStatus === "done" ? "סימון תזכורת כבוצעה" : "ביטול תזכורת"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה בעדכון תזכורת", { description: toHebrewError(result.error, "") });
      }
    } catch (error: unknown) {
      toast.error("שגיאה בעדכון תזכורת", { description: getErrorMessage(error) });
    }
  }

  const dialogTitle = isEditing ? "כרטיס משימה" : "משימה חדשה";
  const targetTaskId = activeTaskId ?? props.taskId ?? null;

  // Track unsaved edits so (in edit mode) Save only appears once something changed.
  const formSnapshot = JSON.stringify({
    businessDomain: effectiveDomain,
    projectId,
    propertyId,
    subject: subject.trim(),
    description: description.trim(),
    dueDate,
    dueTime,
    city: city.trim(),
    address: address.trim(),
    assignedUserId,
    memberIds: [...memberIds].sort(),
    priority,
    status,
  });
  const baselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!props.open) {
      baselineRef.current = null;
      return;
    }
    if (loading) return;
    if (baselineRef.current === null) baselineRef.current = formSnapshot;
  }, [props.open, loading, formSnapshot]);
  const dirty = baselineRef.current !== null && formSnapshot !== baselineRef.current;

  // Guard: don't lose an unsaved new task without confirming.
  function attemptClose() {
    if (saving || loading) return;
    const unsavedCreate = props.mode === "create" && !activeTaskId;
    if (unsavedCreate && (subject.trim() || description.trim())) {
      if (!window.confirm("המשימה עדיין לא נשמרה. לצאת בלי לשמור?")) return;
    }
    if (props.mode === "create" && !activeTaskId) clearDraft("task-create");
    props.onOpenChange(false);
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (next) {
          props.onOpenChange(true);
          return;
        }
        attemptClose();
      }}
    >
      <AdaptiveDialog size={isEditing && targetTaskId ? "details4xl" : "form2xl"}>
        <DialogHeader>
          <DialogTitle className="sr-only">{subject.trim() ? subject : dialogTitle}</DialogTitle>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <button
                type="button"
                aria-label={status === "done" ? "החזרה ללביצוע" : "סימון כבוצע"}
                title={status === "done" ? "החזרה ל'לביצוע'" : "סימון כבוצע"}
                disabled={loading}
                onClick={() => setStatus(status === "done" ? "todo" : "done")}
                className="shrink-0 text-muted-foreground transition-colors hover:text-success disabled:opacity-40"
              >
                {status === "done" ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <Circle className="h-5 w-5" />
                )}
              </button>
            ) : null}
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="שם המשימה"
              disabled={loading}
              className="border-transparent bg-transparent px-1 text-lg font-semibold shadow-none focus-visible:border-input"
            />
            {targetTaskId ? (
              <Button asChild type="button" variant="secondary" size="sm" className="shrink-0">
                <Link href={`/tasks/${encodeURIComponent(targetTaskId)}`}>
                  <ExternalLink className="ms-1 h-3.5 w-3.5" />
                  עמוד מלא
                </Link>
              </Button>
            ) : null}
          </div>
          <DialogDescription className="sr-only">פרטי המשימה</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            טוען נתוני משימה...
          </div>
        ) : (
        <div className={isEditing && targetTaskId ? "mt-4 grid gap-5 lg:grid-cols-[1.5fr_1fr]" : "mt-4"}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/* Action buttons — toggle each detail editor (one open at a time). */}
          <div className="flex flex-wrap gap-1.5">
            <ActionChip icon={AlignLeft} label="תיאור" active={isOpen("description")} onClick={() => toggleSection("description")} />
            <ActionChip icon={Briefcase} label="תחום" active={isOpen("domain")} onClick={() => toggleSection("domain")} />
            <ActionChip icon={Clock} label="תאריך" active={isOpen("dates")} onClick={() => toggleSection("dates")} />
            <ActionChip icon={Users} label="אחראי וחברים" active={isOpen("people")} onClick={() => toggleSection("people")} />
            <ActionChip icon={Tag} label="עדיפות וסטטוס" active={isOpen("labels")} onClick={() => toggleSection("labels")} />
            <ActionChip icon={MapPin} label="מיקום" active={isOpen("location")} onClick={() => toggleSection("location")} />
          </div>

          {isOpen("description") ? (
            <div className="space-y-1 rounded-md border bg-muted/20 p-3">
              <div className="text-sm font-medium">תיאור</div>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          ) : null}

          {isOpen("domain") ? (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">תחום עסקי</div>
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
            </div>
          ) : null}

              {isOpen("dates") ? (
              <div className="rounded-md border bg-muted/20 p-3">
              <AdaptiveGrid variant="formTwo">
                <div className="space-y-1">
                  <div className="text-sm font-medium">תאריך יעד</div>
                  <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    שעה
                  </div>
                  <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} dir="ltr" />
                </div>
              </AdaptiveGrid>
              </div>
              ) : null}

              {isOpen("people") ? (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">אחראי</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={assignedUserId}
                  onChange={(e) => {
                    setAssignedUserId(e.target.value);
                    setMemberIds((prev) => prev.filter((id) => id !== e.target.value));
                  }}
                >
                  <option value="">בחר משתמש...</option>
                  {props.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.label}
                    </option>
                  ))}
                </select>
              </div>

              {canAddSelf ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={memberIds.includes(meId)}
                    onChange={() => toggleMember(meId)}
                  />
                  הוסף גם אותי כחבר במשימה
                </label>
              ) : null}

              <div className="space-y-1">
                <div className="text-sm font-medium">חברים נוספים</div>
                {selectedMembers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedMembers.map((member) => (
                      <span
                        key={member.id}
                        className="inline-flex items-center gap-1 rounded-full border bg-secondary/40 py-0.5 ps-1 pe-2 text-xs"
                      >
                        <InitialsAvatar name={member.label} size="sm" />
                        {member.label}
                        <button
                          type="button"
                          onClick={() => toggleMember(member.id)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`הסר ${member.label}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <details className="rounded-md border bg-background">
                  <summary className="cursor-pointer list-none px-3 py-2 text-sm text-muted-foreground">
                    <Plus className="ms-0 me-1 inline h-3.5 w-3.5" />
                    הוספת חברים
                  </summary>
                  <div className="max-h-40 overflow-auto border-t p-1">
                    {memberOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">אין משתמשים זמינים.</div>
                    ) : (
                      memberOptions.map((user) => {
                        const checked = memberIds.includes(user.id);
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => toggleMember(user.id)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted/40"
                          >
                            <span
                              className={`flex h-4 w-4 items-center justify-center rounded border ${
                                checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                              }`}
                            >
                              {checked ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <InitialsAvatar name={user.label} size="sm" />
                            {user.label}
                          </button>
                        );
                      })
                    )}
                  </div>
                </details>
              </div>
              </div>
              ) : null}

              {isOpen("location") ? (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <AdaptiveGrid variant="formTwo">
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    עיר
                  </div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={cityOther ? "אחר" : city}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "אחר") {
                        setCityOther(true);
                        setCity("");
                      } else {
                        setCityOther(false);
                        setCity(value);
                      }
                    }}
                  >
                    <option value="">בחר עיר...</option>
                    {CITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">כתובת</div>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              </AdaptiveGrid>

              {cityOther ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium">עיר (הקלדה חופשית)</div>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
              ) : null}
              </div>
              ) : null}

              {isOpen("labels") ? (
              <div className="rounded-md border bg-muted/20 p-3">
              <AdaptiveGrid variant="formTwo">
                <div className="space-y-1">
                  <div className="text-sm font-medium">עדיפות</div>
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
                  <div className="text-sm font-medium">סטטוס</div>
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
              </div>
              ) : null}

          {wizard && nextWizardStep(openSection) ? (
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={() => setOpenSection(nextWizardStep(openSection))}>
                הבא ›
              </Button>
            </div>
          ) : null}

          <DialogFooter className="mt-4">
            <Button type="button" variant="secondary" onClick={attemptClose}>
              {isEditing ? "סגירה" : "ביטול"}
            </Button>
            {!isEditing || dirty ? (
              <Button type="submit" disabled={!canSubmit || saving || loading}>
                {saving ? "שומר..." : isEditing ? "שמירת שינויים" : "יצירה"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>

        {/* Card extras — left column beside the form (stacks on mobile). */}
        {isEditing && targetTaskId ? (
          <div className="space-y-4 rounded-lg bg-muted/40 p-4 lg:p-5">
            {/* Reminders */}
            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Bell className="h-4 w-4 text-muted-foreground" />
                תזכורות
              </div>
              {reminders.filter((r) => r.status === "pending").length === 0 ? (
                <div className="text-xs text-muted-foreground">אין תזכורות פעילות.</div>
              ) : (
                <div className="space-y-1.5">
                  {reminders
                    .filter((r) => r.status === "pending")
                    .map((reminder) => (
                      <div
                        key={reminder.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{formatShortDateTime(reminder.remind_at)}</div>
                          {reminder.content ? (
                            <div className="truncate text-xs text-muted-foreground">{reminder.content}</div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button type="button" size="sm" variant="secondary" onClick={() => void setReminderStatus(reminder.id, "done")}>
                            בוצע
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => void setReminderStatus(reminder.id, "cancelled")}>
                            ביטול
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
              <AdaptiveGrid variant="formTwo">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">מועד התזכורת</div>
                  <DateTimeInput value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">הערה (אופציונלי)</div>
                  <Input value={reminderNote} onChange={(e) => setReminderNote(e.target.value)} />
                </div>
              </AdaptiveGrid>
              <div className="flex justify-end">
                <Button type="button" size="sm" disabled={!reminderAt || addingReminder} onClick={() => void addReminder()}>
                  {addingReminder ? "מוסיף..." : "הוספת תזכורת"}
                </Button>
              </div>
            </section>

            {/* Comments */}
            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                תגובות
              </div>
              {comments.length === 0 ? (
                <div className="text-xs text-muted-foreground">אין תגובות עדיין.</div>
              ) : (
                <div className="space-y-2">
                  {comments.map((comment) => (
                    <div key={comment.id} className="flex gap-2">
                      <InitialsAvatar name={comment.author_name} size="sm" />
                      <div className="min-w-0 flex-1 rounded-md border bg-muted/20 px-3 py-2">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-medium">{comment.author_name ?? "משתמש"}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatShortDateTime(comment.created_at)}
                          </span>
                        </div>
                        <div className="mt-0.5 whitespace-pre-wrap text-sm">{comment.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="כתבו תגובה..."
                className="min-h-16"
              />
              <div className="flex justify-end">
                <Button type="button" size="sm" disabled={addingComment || !newComment.trim()} onClick={() => void addComment()}>
                  {addingComment ? "שומר..." : "הוספת תגובה"}
                </Button>
              </div>
            </section>
          </div>
        ) : null}
        </div>
        )}
      </AdaptiveDialog>
    </Dialog>
  );
}
