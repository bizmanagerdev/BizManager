"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearDraft, loadDraft, offlineFetch, saveDraft } from "@/lib/offline-queue";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  AlignLeft,
  Bell,
  Briefcase,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Lock,
  MapPin,
  Paperclip,
  Tag,
  Trash2,
  Unlock,
  Users,
} from "lucide-react";
import {
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedLines, parseTaskLines } from "@/components/tasks/taskLines.helpers";
import { TaskVoiceFillButton, type ParsedTaskFields } from "@/components/tasks/TaskVoiceFillButton";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { buildColorIndexMap } from "@/components/dashboard/InitialsAvatar";
import { fetchExistingTagIds } from "@/components/tags/TagPicker";
import {
  isExpenseBusinessDomain,
  mapProjectTypeToExpenseDomain,
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { CITY_OPTIONS } from "@/lib/ui/cities";
import {
  nextWizardStep,
  parseLegacyNotes,
  targetTypeForDomain,
  allowedDomainsForFixedTarget,
  resolveEffectiveDomain,
  computeTargetOk,
  canSubmitTask,
  normalizeTaskStatus,
  normalizeTaskPriority,
  buildTaskPayload,
  buildTaskFormSnapshot,
  type LegacyNote,
  type TaskStatus,
  type TaskPriority,
  type TaskTargetType,
} from "@/components/tasks/TaskUpsertDialog.helpers";
import {
  ActionChip,
  TaskAttachmentsSection,
  TaskCardSidebar,
  TaskDatesSection,
  TaskDescriptionSection,
  TaskDomainSection,
  TaskLabelsSection,
  TaskLocationSection,
  TaskPeopleSection,
  TaskPendingFilesSection,
  TaskRemindersStagingSection,
  type AttachmentItem,
  type CommentItem,
  type ReminderItem,
  type TaskOption,
  type UserOption,
} from "@/components/tasks/TaskUpsertDialog.ui";

// Re-exported for back-compat: several files import these types from this module.
export type { TaskStatus, TaskPriority, TaskTargetType };
export type { TaskOption, UserOption };

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mode: Mode;
  taskId?: string | null;
  users: UserOption[];
  projects?: TaskOption[];
  properties?: TaskOption[];
  customers?: TaskOption[];
  fixedTarget?: { type: TaskTargetType; id: string } | null;
  defaultProjectType?: string | null;
  // Pre-fill status / title for board quick-add and the create stepper.
  defaultStatus?: TaskStatus;
  defaultSubject?: string;
  // The signed-in user — enables the optional "add me as a member" toggle.
  currentUserId?: string;
  // Guided step-by-step creation (Next → Next → Save). Defaults to false.
  wizard?: boolean;
  // Pre-select tags (e.g. a vehicle) for a NEW task.
  presetTagIds?: string[];
  // Pre-link a customer for a NEW task (e.g. creating from a customer page).
  presetCustomerId?: string;
  onSaved?: () => void;
};

function getErrorMessage(err: unknown) {
  return toHebrewError(err, "Unknown error");
}

/** The id of the task /api/tasks/create just returned ({ task: { id } }), or "". */
function newTaskIdFrom(data: unknown): string {
  if (!data || typeof data !== "object" || !("task" in data)) return "";
  const task = (data as { task?: unknown }).task;
  if (!task || typeof task !== "object" || !("id" in task)) return "";
  const id = (task as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
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
  const [customerId, setCustomerId] = useState("");
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
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>(props.defaultStatus ?? "todo");
  // Private = visible only to the owner (the user who turns it on). Hidden from
  // everyone else, including office/admin. Only the task's creator may toggle it
  // (the server reports whether the current viewer created the task).
  const [isPrivate, setIsPrivate] = useState(false);
  const [viewerIsCreator, setViewerIsCreator] = useState(true);

  // The card extras (comments / reminders) need a saved task. activeTaskId is the
  // edit target, or the id of a just-created task when keepOpenAfterCreate is set.
  const [activeTaskId, setActiveTaskId] = useState<string | null>(props.taskId ?? null);
  const isEditing = props.mode === "edit" || activeTaskId !== null;

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [legacyNotes, setLegacyNotes] = useState<LegacyNote[]>([]);
  const [newComment, setNewComment] = useState("");
  const [addingComment, setAddingComment] = useState(false);

  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  // When set, the reminder add-form acts as an EDIT form for this reminder id.
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [reminderAt, setReminderAt] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [addingReminder, setAddingReminder] = useState(false);
  // Reminders staged before the task exists (create mode). They ride along on the
  // create payload and are inserted server-side once the task id is known —
  // mirrors how member_ids / tag_ids are threaded through creation.
  const [pendingReminders, setPendingReminders] = useState<{ remind_at: string; content: string }[]>([]);

  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  // Files picked before the task exists — uploaded once it has an id (see
  // uploadPendingFiles). Mirrors how pendingReminders ride along on create.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState<{ id: string; name: string | null } | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);

  const projects = props.projects ?? [];
  const properties = props.properties ?? [];
  const customers = props.customers ?? [];

  const effectiveTarget = props.fixedTarget ?? null;
  const allowedDomains = useMemo(
    () => allowedDomainsForFixedTarget(props.fixedTarget, defaultDomain),
    [defaultDomain, props.fixedTarget]
  );
  const effectiveDomain = resolveEffectiveDomain(businessDomain, allowedDomains, defaultDomain);
  const derivedTargetType = effectiveDomain ? targetTypeForDomain(effectiveDomain) : null;
  const showTargetPicker = !effectiveTarget;

  const targetOk = computeTargetOk({ effectiveTarget, derivedTargetType, projectId, propertyId });

  // Only the task name is required. Everything else is optional and can be added
  // later by reopening the card. (targetOk still applies: once a domain that needs
  // a project/property is chosen, that link must be filled in.)
  const canSubmit = canSubmitTask(subject, targetOk);
  // The name field doubles as a list: each real line is one task.
  const subjectLines = useMemo(() => parseTaskLines(subject), [subject]);
  const [splitAsk, setSplitAsk] = useState(false);

  // Same color map as the board (built from the same user list) so a person's
  // bold color matches between the card, the picker and their comments.
  const colorIndexById = useMemo(() => buildColorIndexMap(props.users.map((u) => u.id)), [props.users]);
  // The user's own chosen color (when set) overrides the auto color.
  const chosenColorById = useMemo(
    () => new Map(props.users.filter((u) => u.color).map((u) => [u.id, u.color as string])),
    [props.users]
  );
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

  const fetchAttachments = useCallback(async (taskId: string) => {
    try {
      const res = await fetch("/api/tasks/attachments/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: taskId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setAttachments(Array.isArray(json?.attachments) ? (json.attachments as AttachmentItem[]) : []);
    } catch {
      // Non-fatal — the rest of the card still works without the file list.
    }
  }, []);

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
        setCustomerId(typeof task.customer_id === "string" ? task.customer_id : "");

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

        setPriority(normalizeTaskPriority(typeof task.priority === "string" ? task.priority : null));
        setStatus(normalizeTaskStatus(typeof task.status === "string" ? task.status : null));
        setIsPrivate(task.is_private === true);
        setViewerIsCreator(json?.viewer_is_creator === true);

        const membersRaw = Array.isArray(json?.members) ? (json.members as Array<{ id?: unknown }>) : [];
        setMemberIds(membersRaw.map((m) => (typeof m.id === "string" ? m.id : "")).filter(Boolean));
        setTagIds([]);
        void fetchExistingTagIds("task", taskId).then(setTagIds);
        setComments(Array.isArray(json?.comments) ? (json.comments as CommentItem[]) : []);
        setLegacyNotes(parseLegacyNotes(typeof task.notes === "string" ? task.notes : null));
        setReminders(Array.isArray(json?.reminders) ? (json.reminders as ReminderItem[]) : []);
        void fetchAttachments(taskId);

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
      projectId: string; propertyId: string; customerId: string; businessDomain: ExpenseBusinessDomain;
      subject: string; description: string; dueDate: string; dueTime: string;
      city: string; address: string; assignedUserId: string; memberIds: string[];
      priority: TaskPriority; status: TaskStatus; isPrivate: boolean;
    }>("task-create");

    setActiveTaskId(null);
    setComments([]);
    setLegacyNotes([]);
    setReminders([]);
    setPendingReminders([]);
    setAttachments([]);
    // Or files staged for a task you abandoned would ride along to the next one.
    setPendingFiles([]);
    setNewComment("");
    setReminderAt("");
    setReminderNote("");

    setProjectId(draft?.projectId ?? (effectiveTarget?.type === "project" ? effectiveTarget.id : ""));
    setPropertyId(draft?.propertyId ?? (effectiveTarget?.type === "property" ? effectiveTarget.id : ""));
    // A preset customer (creating from a customer page) wins over any saved draft.
    setCustomerId(props.presetCustomerId ?? draft?.customerId ?? "");
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
    // Default the owner to the creator so a new task is never ownerless; a saved
    // draft assignee still wins, and the user can reassign before saving.
    setAssignedUserId(draft?.assignedUserId ?? props.currentUserId ?? "");
    setMemberIds(Array.isArray(draft?.memberIds) ? draft.memberIds : []);
    setTagIds(props.presetTagIds ?? []);
    setPriority(draft?.priority ?? "medium");
    setStatus(props.defaultStatus ?? draft?.status ?? "todo");
    setIsPrivate(draft?.isPrivate ?? false);
    // Creating → the current user is the creator, so the privacy toggle is theirs.
    setViewerIsCreator(true);

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
      projectId, propertyId, customerId, businessDomain, subject, description, dueDate, dueTime,
      city, address, assignedUserId, memberIds, priority, status, isPrivate,
    });
  }, [props.open, props.mode, activeTaskId, projectId, propertyId, customerId, businessDomain, subject, description, dueDate, dueTime, city, address, assignedUserId, memberIds, priority, status, isPrivate]);

  function handleBusinessDomainChange(nextDomain: ExpenseBusinessDomain | "") {
    setBusinessDomain(nextDomain);
    if (nextDomain !== "general_business") setTagIds([]);
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

  // Domain options offered to the voice parser (codes + Hebrew labels).
  const domainOptions = useMemo(
    () => allowedDomains.map((code) => ({ code, label: getBusinessDomainLabel(code) })),
    [allowedDomains]
  );

  // Apply fields extracted by the voice parser. Only set values it actually
  // returned, so we never wipe something the user already typed.
  function applyParsed(f: ParsedTaskFields) {
    if (f.subject) setSubject(f.subject);
    if (f.description) setDescription(f.description);
    if (f.due_date) setDueDate(f.due_date);
    if (f.due_time) setDueTime(f.due_time);
    if (f.priority) setPriority(f.priority as TaskPriority);
    if (f.assigned_user_id) setAssignedUserId(f.assigned_user_id);
    if (f.business_domain) handleBusinessDomainChange(f.business_domain as ExpenseBusinessDomain);
    if (f.city) {
      setCity(f.city);
      setCityOther(!(CITY_OPTIONS as readonly string[]).includes(f.city));
    }
    setOpenSection("description");
  }

  // Privacy is a one-click action, not a staged field: persist it immediately when
  // editing an existing task so it sticks even if the dialog is closed without
  // pressing Save. In create mode there's no task yet, so it rides along on submit.
  async function togglePrivate() {
    const next = !isPrivate;
    setIsPrivate(next);
    if (!isEditing) return;
    const targetId = activeTaskId ?? props.taskId;
    if (!targetId) return;
    emitProgressActivityStart();
    try {
      const result = await offlineFetch(
        "/api/tasks/update",
        { id: targetId, is_private: next },
        "עדכון פרטיות"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה בעדכון פרטיות", { description: toHebrewError(result.error, "") });
        setIsPrivate(!next);
        return;
      }
      if (!result.queued) toast.success(next ? "המשימה הפכה לפרטית" : "המשימה אינה פרטית יותר");
      props.onSaved?.();
    } catch (error: unknown) {
      toast.error("שגיאה בעדכון פרטיות", { description: getErrorMessage(error) });
      setIsPrivate(!next);
    } finally {
      emitProgressActivityEnd();
    }
  }

  function buildPayload() {
    return buildTaskPayload({
      effectiveTarget,
      derivedTargetType,
      effectiveDomain,
      projectId,
      propertyId,
      customerId,
      subject,
      description,
      dueDate,
      dueTime,
      city,
      address,
      assignedUserId,
      memberIds,
      tagIds,
      pendingReminders,
      priority,
      status,
      isPrivate,
    });
  }

  // A multi-line name on CREATE is ambiguous — it's either one task with a long
  // name, or a list. Ask instead of guessing. (On edit it's just a name.)
  async function submit() {
    if (!canSubmit) return;
    if (!isEditing && subjectLines.length > 1) {
      setSplitAsk(true);
      return;
    }
    await reallySubmit();
  }

  /** Create one task per line, sharing everything else in the dialog. */
  async function submitAsSeparateTasks() {
    setSplitAsk(false);
    setSaving(true);
    emitProgressActivityStart();
    try {
      const base = buildPayload();
      let created = 0;
      const failed: string[] = [];
      for (const line of subjectLines) {
        try {
          const result = await offlineFetch(
            "/api/tasks/create",
            { ...base, subject: line },
            "משימה חדשה",
            { idempotent: true }
          );
          if (result.queued || result.ok) created += 1;
          else failed.push(line);
        } catch {
          failed.push(line);
        }
      }
      // Partial failure is real across N writes: keep what failed on screen to
      // retry rather than silently dropping it.
      if (created > 0) toast.success(`נוצרו ${created} משימות`);
      if (failed.length > 0) {
        setSubject(failed.join("\n"));
        toast.error(`${failed.length} משימות לא נוצרו — נסה שוב`);
        return;
      }
      // Which of the N tasks would the files belong to? Nobody can answer that,
      // so don't guess — the tasks are created, say the files weren't attached.
      if (pendingFiles.length > 0) {
        toast.warning("הקבצים לא צורפו — אפשר לצרף אותם לכרטיס המתאים");
        setPendingFiles([]);
      }
      clearDraft("task-create");
      props.onSaved?.();
      props.onOpenChange(false);
      router.refresh();
    } finally {
      emitProgressActivityEnd();
      setSaving(false);
    }
  }

  // `override` exists because setSubject() hasn't landed yet when the split
  // prompt collapses a list into one name — buildPayload() would read the stale
  // multi-line value.
  async function reallySubmit(override?: { subject?: string }) {
    setSaving(true);
    emitProgressActivityStart();
    try {
      if (!isEditing) {
        const payload = { ...buildPayload(), ...(override?.subject ? { subject: override.subject } : {}) };
        const result = await offlineFetch("/api/tasks/create", payload, "משימה חדשה", { idempotent: true });
        if (result.queued) {
          // Queued offline → no task id yet, so staged files can't be attached.
          // Say so rather than dropping them silently.
          if (pendingFiles.length > 0) toast.warning("הקבצים לא צורפו — המשימה תיווצר כשהחיבור יחזור");
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
        await uploadPendingFiles(newTaskIdFrom(result.data));
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

  // Load an existing reminder into the add-form so it can be edited (reschedule /
  // change note). The footer button flips to "עדכון" while editingReminderId is set.
  function beginEditReminder(reminder: ReminderItem) {
    setEditingReminderId(reminder.id);
    const d = new Date(reminder.remind_at);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      setReminderAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    setReminderNote(reminder.content ?? "");
  }

  function cancelEditReminder() {
    setEditingReminderId(null);
    setReminderAt("");
    setReminderNote("");
  }

  async function saveReminderEdit() {
    const id = editingReminderId;
    if (!id || !reminderAt) return;
    setAddingReminder(true);
    emitProgressActivityStart();
    try {
      const remindIso = new Date(reminderAt).toISOString();
      const content = reminderNote.trim() || null;
      // Optimistic — reflect the new time/note immediately.
      setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, remind_at: remindIso, content } : r)));
      const result = await offlineFetch(
        "/api/tasks/reminders/update",
        { id, remind_at: remindIso, content },
        "עדכון תזכורת"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה בעדכון תזכורת", { description: toHebrewError(result.error, "") });
        return;
      }
      setEditingReminderId(null);
      setReminderAt("");
      setReminderNote("");
      if (!result.queued) toast.success("התזכורת עודכנה");
    } catch (error: unknown) {
      toast.error("שגיאה בעדכון תזכורת", { description: getErrorMessage(error) });
    } finally {
      emitProgressActivityEnd();
      setAddingReminder(false);
    }
  }

  // Create mode: just stage the reminder locally (no task id yet). It's sent with
  // the create payload and inserted server-side after the task is created.
  function stageReminder() {
    if (!reminderAt) return;
    setPendingReminders((prev) => [...prev, { remind_at: reminderAt, content: reminderNote.trim() }]);
    setReminderAt("");
    setReminderNote("");
  }

  function removePendingReminder(index: number) {
    setPendingReminders((prev) => prev.filter((_, i) => i !== index));
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

  /** Send the files staged during creation, now that the task has an id. */
  async function uploadPendingFiles(taskId: string) {
    if (pendingFiles.length === 0) return;
    if (!taskId) {
      toast.error("הקבצים לא צורפו — המשימה נוצרה, אפשר לצרף אותם מהכרטיס");
      return;
    }
    let uploaded = 0;
    const failed: string[] = [];
    for (const file of pendingFiles) {
      try {
        const result = await offlineUpload("/api/tasks/attachments/upload", {
          fields: { task_id: taskId },
          file,
          label: file.name,
        });
        if (result.queued || result.ok) uploaded += 1;
        else failed.push(file.name);
      } catch {
        failed.push(file.name);
      }
    }
    if (uploaded > 0) toast.success(uploaded === 1 ? "הקובץ הועלה" : `${uploaded} קבצים הועלו`);
    // The task itself was created — don't fail the whole save over an attachment.
    if (failed.length > 0) toast.error("חלק מהקבצים לא הועלו", { description: failed.join(", ") });
    setPendingFiles([]);
  }

  async function uploadAttachments(files: File[]) {
    const targetId = activeTaskId ?? props.taskId;
    if (!targetId || files.length === 0) return;
    setUploadingFiles(true);
    emitProgressActivityStart();
    try {
      // uploaded = genuinely sent now; a queued upload was saved on the device
      // and replays on reconnect (ConnectionToasts announces it).
      let uploaded = 0;
      for (const file of files) {
        const result = await offlineUpload("/api/tasks/attachments/upload", {
          fields: { task_id: targetId },
          file,
          label: file.name,
        });
        if (result.queued) continue;
        if (!result.ok) {
          toast.error("שגיאה בהעלאת קובץ", { description: result.error });
          return;
        }
        uploaded += 1;
      }
      if (uploaded > 0) toast.success(uploaded === 1 ? "הקובץ הועלה" : "הקבצים הועלו");
      await fetchAttachments(targetId);
    } catch (error: unknown) {
      toast.error("שגיאה בהעלאת קובץ", { description: getErrorMessage(error) });
    } finally {
      emitProgressActivityEnd();
      setUploadingFiles(false);
    }
  }

  async function performDeleteAttachment() {
    const target = attachmentToDelete;
    const targetId = activeTaskId ?? props.taskId;
    if (!target || !targetId) return;
    setDeletingAttachment(true);
    setAttachments((prev) => prev.filter((a) => a.id !== target.id));
    emitProgressActivityStart();
    try {
      const result = await offlineFetch("/api/documents/delete", { document_id: target.id }, "מחיקת קובץ");
      if (!result.queued && !result.ok) {
        toast.error("שגיאה במחיקת קובץ", { description: toHebrewError(result.error, "") });
        await fetchAttachments(targetId);
        return;
      }
      if (!result.queued) toast.success("הקובץ נמחק");
      setAttachmentToDelete(null);
    } catch (error: unknown) {
      toast.error("שגיאה במחיקת קובץ", { description: getErrorMessage(error) });
      await fetchAttachments(targetId);
    } finally {
      emitProgressActivityEnd();
      setDeletingAttachment(false);
    }
  }

  async function deleteTask() {
    const targetId = activeTaskId ?? props.taskId;
    if (!targetId) return;
    setSaving(true);
    emitProgressActivityStart();
    try {
      const result = await offlineFetch("/api/tasks/delete", { id: targetId }, "מחיקת משימה");
      if (!result.queued && !result.ok) {
        toast.error("שגיאה במחיקת משימה", { description: toHebrewError(result.error, "") });
        return;
      }
      if (!result.queued) toast.success("המשימה נמחקה");
      props.onSaved?.();
      props.onOpenChange(false);
      router.refresh();
    } catch (error: unknown) {
      toast.error("שגיאה במחיקת משימה", { description: getErrorMessage(error) });
    } finally {
      emitProgressActivityEnd();
      setSaving(false);
    }
  }

  const dialogTitle = isEditing ? "כרטיס משימה" : "משימה חדשה";
  const targetTaskId = activeTaskId ?? props.taskId ?? null;

  // Track unsaved edits so (in edit mode) Save only appears once something changed.
  const formSnapshot = buildTaskFormSnapshot({
    effectiveDomain,
    projectId,
    propertyId,
    customerId,
    subject,
    description,
    dueDate,
    dueTime,
    city,
    address,
    assignedUserId,
    memberIds,
    priority,
    status,
    isPrivate,
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

  function doClose() {
    if (props.mode === "create" && !activeTaskId) clearDraft("task-create");
    props.onOpenChange(false);
  }

  // Guard: don't lose an unsaved new task without confirming (styled dialog).
  function attemptClose() {
    if (saving || loading) return;
    const unsavedCreate = props.mode === "create" && !activeTaskId;
    if (unsavedCreate && (subject.trim() || description.trim())) {
      setConfirmDiscardOpen(true);
      return;
    }
    doClose();
  }

  return (
    <>
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
          {/* pe-8 keeps the end button clear of the dialog's close X (top-left in RTL). */}
          {/* items-start, not items-center: the name grows downward when it's a list. */}
          <div className="flex items-start gap-2 pe-8">
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
            {/* A textarea, not an input: <input> silently strips newlines, so
                pasting or dictating a list would collapse into one long name and
                we'd never know it was a list.
                flex-1 + min-w-0 or it collapses to its intrinsic width in this
                flex row; min-h-0 to shed the component's 110px minimum, which is
                meant for a description box, not a title. */}
            <Textarea
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => {
                // Enter still submits a normal one-line name; Shift+Enter (and
                // paste, and dictation) start a new line.
                if (e.key === "Enter" && !e.shiftKey && !subject.includes("\n")) {
                  e.preventDefault();
                  if (canSubmit && !saving && !loading) void submit();
                }
              }}
              placeholder="שם המשימה"
              disabled={loading}
              rows={Math.min(Math.max(subjectLines.length, 1), 8)}
              className="min-h-0 flex-1 resize-none border-transparent bg-transparent px-1 py-1 text-lg font-semibold leading-snug shadow-none focus-visible:border-input"
            />
            <DictateButton
              onTranscript={(text) =>
                // One recording, several tasks: speech comes back as
                // "לבדוק את הדירה, לדבר עם הקבלן ולתקן..." — split it into lines
                // so you can say the whole list in one go instead of
                // record-stop-record per row.
                setSubject((prev) => appendDictatedLines(prev, text))
              }
              disabled={loading}
              title="הכתבת שם המשימה — אפשר להקריא כמה משימות ברצף"
              className="shrink-0"
            />
            {viewerIsCreator ? (
              <Button
                type="button"
                variant={isPrivate ? "default" : "secondary"}
                size="sm"
                disabled={loading}
                onClick={() => void togglePrivate()}
                title={
                  isPrivate
                    ? "משימה פרטית — רק את/ה רואה אותה. לחצו כדי לבטל"
                    : "הפיכה לפרטית — רק את/ה תראו את המשימה"
                }
                className="shrink-0"
              >
                {isPrivate ? <Lock className="ms-1 h-3.5 w-3.5" /> : <Unlock className="ms-1 h-3.5 w-3.5" />}
                {isPrivate ? "פרטי" : "הפוך לפרטי"}
              </Button>
            ) : isPrivate ? (
              // Non-creator viewing a private task they own: show a static marker.
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-sm text-primary"
                title="משימה פרטית"
              >
                <Lock className="h-3.5 w-3.5" />
                פרטי
              </span>
            ) : null}
            {isEditing && targetTaskId ? (
              <button
                type="button"
                aria-label="מחיקת המשימה"
                title="מחיקת המשימה"
                disabled={saving || loading}
                onClick={() => setConfirmDeleteOpen(true)}
                className="shrink-0 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-5 w-5" />
              </button>
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
          {/* Voice fill — speak the whole task, let AI fill the fields (create only). */}
          {!isEditing ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed bg-muted/20 p-2">
              <span className="text-xs text-muted-foreground">
                דברו את כל פרטי המשימה והכרטיס יתמלא אוטומטית
              </span>
              <TaskVoiceFillButton
                users={props.users.map((u) => ({ id: u.id, label: u.label }))}
                domains={domainOptions}
                onParsed={applyParsed}
                disabled={loading}
              />
            </div>
          ) : null}

          {/* Action buttons — toggle each detail editor (one open at a time). */}
          <div className="flex flex-wrap gap-1.5">
            <ActionChip icon={AlignLeft} label="תיאור" active={isOpen("description")} onClick={() => toggleSection("description")} />
            <ActionChip icon={Briefcase} label="תחום" active={isOpen("domain")} onClick={() => toggleSection("domain")} />
            <ActionChip icon={Clock} label="תאריך" active={isOpen("dates")} onClick={() => toggleSection("dates")} />
            <ActionChip icon={Users} label="אחראי וחברים" active={isOpen("people")} onClick={() => toggleSection("people")} />
            <ActionChip icon={Tag} label="עדיפות וסטטוס" active={isOpen("labels")} onClick={() => toggleSection("labels")} />
            <ActionChip icon={MapPin} label="מיקום" active={isOpen("location")} onClick={() => toggleSection("location")} />
            {/* Reminders during creation — once the task exists they live in the
                right-hand card column with immediate add/done/cancel. */}
            {!isEditing ? (
              <ActionChip icon={Bell} label="תזכורות" active={isOpen("reminders")} onClick={() => toggleSection("reminders")} />
            ) : null}
            {/* Uploading needs a task id, but CHOOSING files doesn't — on a new
                task they're staged and uploaded right after it's created. */}
            <ActionChip icon={Paperclip} label="קבצים ותמונות" active={isOpen("files")} onClick={() => toggleSection("files")} />
          </div>

          {isOpen("description") ? (
            <TaskDescriptionSection description={description} onChange={setDescription} />
          ) : null}

          {isOpen("domain") ? (
            <TaskDomainSection
              allowedDomains={allowedDomains}
              effectiveDomain={effectiveDomain}
              onDomainChange={handleBusinessDomainChange}
              tagIds={tagIds}
              onTagIdsChange={setTagIds}
              showTargetPicker={showTargetPicker}
              derivedTargetType={derivedTargetType}
              projects={projects}
              projectId={projectId}
              onProjectIdChange={setProjectId}
              properties={properties}
              propertyId={propertyId}
              onPropertyIdChange={setPropertyId}
              customers={customers}
              customerId={customerId}
              onCustomerIdChange={setCustomerId}
            />
          ) : null}

              {isOpen("dates") ? (
                <TaskDatesSection
                  dueDate={dueDate}
                  onDueDateChange={setDueDate}
                  dueTime={dueTime}
                  onDueTimeChange={setDueTime}
                />
              ) : null}

              {isOpen("people") ? (
                <TaskPeopleSection
                  users={props.users}
                  assignedUserId={assignedUserId}
                  onAssignedChange={(id) => {
                    setAssignedUserId(id);
                    setMemberIds((prev) => prev.filter((m) => m !== id));
                  }}
                  canAddSelf={canAddSelf}
                  meId={meId}
                  memberIds={memberIds}
                  onToggleMember={toggleMember}
                  selectedMembers={selectedMembers}
                  memberOptions={memberOptions}
                  colorIndexById={colorIndexById}
                />
              ) : null}

              {isOpen("location") ? (
                <TaskLocationSection
                  city={city}
                  setCity={setCity}
                  cityOther={cityOther}
                  setCityOther={setCityOther}
                  address={address}
                  onAddressChange={setAddress}
                />
              ) : null}

              {isOpen("files") ? (
                targetTaskId ? (
                  <TaskAttachmentsSection
                    attachments={attachments}
                    uploadingFiles={uploadingFiles}
                    onUpload={(files) => void uploadAttachments(files)}
                    onRequestDelete={setAttachmentToDelete}
                  />
                ) : (
                  <TaskPendingFilesSection
                    files={pendingFiles}
                    onAdd={(picked) => setPendingFiles((prev) => [...prev, ...picked])}
                    onRemove={(index) => setPendingFiles((prev) => prev.filter((_, i) => i !== index))}
                  />
                )
              ) : null}

              {isOpen("labels") ? (
                <TaskLabelsSection
                  priority={priority}
                  onPriorityChange={setPriority}
                  status={status}
                  onStatusChange={setStatus}
                />
              ) : null}

              {isOpen("reminders") && !isEditing ? (
                <TaskRemindersStagingSection
                  pendingReminders={pendingReminders}
                  reminderAt={reminderAt}
                  setReminderAt={setReminderAt}
                  reminderNote={reminderNote}
                  setReminderNote={setReminderNote}
                  onStage={stageReminder}
                  onRemove={removePendingReminder}
                />
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
          <TaskCardSidebar
            reminders={reminders}
            reminderAt={reminderAt}
            setReminderAt={setReminderAt}
            reminderNote={reminderNote}
            setReminderNote={setReminderNote}
            addingReminder={addingReminder}
            editingReminderId={editingReminderId}
            onAddReminder={() => void (editingReminderId ? saveReminderEdit() : addReminder())}
            onEditReminder={beginEditReminder}
            onCancelEditReminder={cancelEditReminder}
            onSetReminderStatus={(id, nextStatus) => void setReminderStatus(id, nextStatus)}
            comments={comments}
            legacyNotes={legacyNotes}
            newComment={newComment}
            setNewComment={setNewComment}
            addingComment={addingComment}
            onAddComment={() => void addComment()}
            colorIndexById={colorIndexById}
            chosenColorById={chosenColorById}
          />
        ) : null}
        </div>
        )}
      </AdaptiveDialog>
    </Dialog>

    {/* The name has several lines — is it a list, or one long name? Only the
        person typing knows, so ask. Three real choices, which is why this isn't
        a ConfirmDialog (its "cancel" would have to lie about what it does). */}
    <Dialog open={splitAsk} onOpenChange={setSplitAsk}>
      <AdaptiveDialog size="formSm" dir="rtl" className="text-right">
        <DialogHeader>
          <DialogTitle>{subjectLines.length} שורות בשם המשימה</DialogTitle>
          <DialogDescription>ליצור משימה נפרדת לכל שורה, או משימה אחת?</DialogDescription>
        </DialogHeader>

        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2 text-sm">
          {subjectLines.map((line, i) => (
            <li key={`${line}-${i}`} className="flex items-start gap-2">
              <span className="text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 flex-1">{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          כל המשימות יקבלו את אותו אחראי, תאריך ושאר הפרטים שמילאת.
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setSplitAsk(false)} disabled={saving}>
            חזרה לעריכה
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              // Collapse to a real one-line name — storing the raw newlines would
              // leave a task whose title renders as a broken block everywhere.
              setSubject(subjectLines.join(" "));
              setSplitAsk(false);
              void reallySubmit({ subject: subjectLines.join(" ") });
            }}
          >
            משימה אחת
          </Button>
          <Button type="button" disabled={saving} onClick={() => void submitAsSeparateTasks()}>
            {saving ? "יוצר…" : `צור ${subjectLines.length} משימות`}
          </Button>
        </DialogFooter>
      </AdaptiveDialog>
    </Dialog>

    <ConfirmDialog
      open={confirmDeleteOpen}
      onOpenChange={setConfirmDeleteOpen}
      title="מחיקת משימה"
      description={
        <>
          למחוק את המשימה{" "}
          <span className="font-medium">&quot;{subject.trim()}&quot;</span>? לא ניתן לשחזר משימה שנמחקה.
        </>
      }
      confirmLabel="מחיקה"
      destructive
      loading={saving}
      onConfirm={() => {
        setConfirmDeleteOpen(false);
        void deleteTask();
      }}
    />

    <ConfirmDialog
      open={attachmentToDelete !== null}
      onOpenChange={(open) => {
        if (!open) setAttachmentToDelete(null);
      }}
      title="מחיקת קובץ"
      description={
        <>
          למחוק את הקובץ{" "}
          <span className="font-medium">&quot;{attachmentToDelete?.name ?? ""}&quot;</span>? הקובץ יוסר לצמיתות.
        </>
      }
      confirmLabel="מחיקה"
      destructive
      loading={deletingAttachment}
      onConfirm={() => void performDeleteAttachment()}
    />

    <ConfirmDialog
      open={confirmDiscardOpen}
      onOpenChange={(open) => {
        if (!open) setConfirmDiscardOpen(false);
      }}
      title="יציאה בלי לשמור"
      description="המשימה עדיין לא נשמרה. לצאת בלי לשמור?"
      confirmLabel="יציאה בלי שמירה"
      cancelLabel="חזרה לעריכה"
      destructive
      onConfirm={() => {
        setConfirmDiscardOpen(false);
        doClose();
      }}
    />
    </>
  );
}
