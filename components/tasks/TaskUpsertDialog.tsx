"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { clearDraft, loadDraft, offlineFetch, saveDraft } from "@/lib/offline-queue";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AttachIcon, BusinessIcon, ClockIcon, CommentIcon, LocationIcon, LockIcon, NotificationIcon, SpinnerIcon, SuccessIcon, TagIcon, TextIcon, UncheckedIcon, UnlockIcon, UsersIcon } from "@/components/ui/icons";
import { DeleteButton } from "@/components/ui/icon-button";
import {
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ViewDialog } from "@/components/ui/view-dialog";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedLines, parseTaskLines } from "@/components/tasks/taskLines.helpers";
import { TaskVoiceFillButton, type ParsedTaskFields } from "@/components/tasks/TaskVoiceFillButton";
import type { Locale } from "@/lib/i18n/types";
import { t } from "@/lib/i18n/t";
import { tasksDict } from "@/lib/i18n/dictionaries/tasks";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import {
  Dialog,
  DialogDescription,
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
  TaskAttachmentsSection,
  TaskCommentsPanel,
  TaskRemindersPanel,
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

// Bidirectional: subject_he/description_he are only ever set when the
// AUTHOR's own locale was 'ar' (see app/api/tasks/create), so their presence
// means `original` is already Arabic. translatedAr is the reverse: a
// Hebrew-authored task's text, lazily translated + cached for an Arabic
// viewer (see app/api/tasks/get).
function preferHe(
  original: string,
  translatedHe: string | null | undefined,
  locale: Locale,
  translatedAr?: string | null
) {
  if (locale === "he") return translatedHe || original;
  if (translatedHe) return original;
  return translatedAr || original;
}

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mode: Mode;
  taskId?: string | null;
  // Optional: call sites outside the worker-facing /tasks board (office/admin
  // pages editing tasks from a customer/project/vehicle context) don't thread
  // a locale yet — those viewers are always "he" anyway, so default to it.
  locale?: Locale;
  users: UserOption[];
  projects?: TaskOption[];
  properties?: TaskOption[];
  customers?: TaskOption[];
  fixedTarget?: { type: TaskTargetType; id: string } | null;
  defaultProjectType?: string | null;
  // Pre-fill status / title for board quick-add and the create stepper.
  defaultStatus?: TaskStatus;
  defaultSubject?: string;
  // Pre-fill the due date for a NEW task (e.g. "add to this day" on the calendar).
  defaultDueDate?: string;
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

export function TaskUpsertDialog(rawProps: Props) {
  // Normalized once so every other reference in this file can assume a
  // resolved locale (see the Props comment on why the raw prop is optional).
  const props = { ...rawProps, locale: rawProps.locale ?? "he" };
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Only one section open at a time (accordion). Description is the default-open one.
  const wizard = props.wizard ?? false;
  const [openSection, setOpenSection] = useState<string | null>("description");

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
        if (!res.ok) throw new Error(toHebrewError(json?.error, t(tasksDict, props.locale, "loadTaskErrorFallback")));
        const task = (json?.task ?? null) as Record<string, unknown> | null;
        if (!task) throw new Error(t(tasksDict, props.locale, "taskNotFoundError"));

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

        const rawSubject = typeof task.subject === "string" ? task.subject : "";
        const rawSubjectHe = typeof task.subject_he === "string" ? task.subject_he : null;
        const rawSubjectAr = typeof task.subject_ar === "string" ? task.subject_ar : null;
        setSubject(preferHe(rawSubject, rawSubjectHe, props.locale, rawSubjectAr));
        const rawDescription = typeof task.description === "string" ? task.description : "";
        const rawDescriptionHe = typeof task.description_he === "string" ? task.description_he : null;
        const rawDescriptionAr = typeof task.description_ar === "string" ? task.description_ar : null;
        setDescription(preferHe(rawDescription, rawDescriptionHe, props.locale, rawDescriptionAr));
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
        toast.error(toHebrewError(error, t(tasksDict, props.locale, "loadTaskErrorFallback")));
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
    setDueDate(draft?.dueDate ?? props.defaultDueDate ?? "");
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
        t(tasksDict, props.locale, "updatePrivacyOfflineLabel")
      );
      if (!result.queued && !result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorUpdatePrivacy"), { description: toHebrewError(result.error, "") });
        setIsPrivate(!next);
        return;
      }
      if (!result.queued)
        toast.success(t(tasksDict, props.locale, next ? "toastPrivacyOn" : "toastPrivacyOff"));
      props.onSaved?.();
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorUpdatePrivacy"), { description: getErrorMessage(error) });
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
            t(tasksDict, props.locale, "newTaskLabel"),
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
      if (created > 0)
        toast.success(`${t(tasksDict, props.locale, "createdCountPrefix")} ${created} ${t(tasksDict, props.locale, "tasksWord")}`);
      if (failed.length > 0) {
        setSubject(failed.join("\n"));
        toast.error(`${failed.length} ${t(tasksDict, props.locale, "tasksFailedRetrySuffix")}`);
        return;
      }
      // Which of the N tasks would the files belong to? Nobody can answer that,
      // so don't guess — the tasks are created, say the files weren't attached.
      if (pendingFiles.length > 0) {
        toast.warning(t(tasksDict, props.locale, "filesNotAttachedManual"));
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
        const result = await offlineFetch(
          "/api/tasks/create",
          payload,
          t(tasksDict, props.locale, "newTaskLabel"),
          { idempotent: true }
        );
        if (result.queued) {
          // Queued offline → no task id yet, so staged files can't be attached.
          // Say so rather than dropping them silently.
          if (pendingFiles.length > 0) toast.warning(t(tasksDict, props.locale, "filesNotAttachedOffline"));
          clearDraft("task-create");
          props.onSaved?.();
          props.onOpenChange(false);
          return;
        }
        if (!result.ok) {
          toast.error(t(tasksDict, props.locale, "toastErrorCreateTask"), { description: result.error });
          return;
        }
        clearDraft("task-create");
        toast.success(t(tasksDict, props.locale, "toastTaskCreatedSingle"));
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
        t(tasksDict, props.locale, "updateTaskOfflineLabel")
      );
      if (!result.queued && !result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorUpdateTask"), { description: toHebrewError(result.error, "") });
        return;
      }
      if (!result.queued) toast.success(t(tasksDict, props.locale, "toastTaskUpdated"));
      props.onSaved?.();
      props.onOpenChange(false);
      router.refresh();
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, isEditing ? "toastErrorUpdateTask" : "toastErrorCreateTask"), {
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
        t(tasksDict, props.locale, "addCommentOfflineLabel"),
        { idempotent: true }
      );
      if (result.queued) {
        setNewComment("");
        return;
      }
      if (!result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorAddComment"), { description: toHebrewError(result.error, "") });
        return;
      }
      const comment =
        result.data && typeof result.data === "object" && "comment" in result.data
          ? ((result.data as { comment?: CommentItem | null }).comment ?? null)
          : null;
      if (comment) setComments((prev) => [...prev, comment]);
      setNewComment("");
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorAddComment"), { description: getErrorMessage(error) });
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
        t(tasksDict, props.locale, "addReminderOfflineLabel"),
        { idempotent: true }
      );
      if (result.queued) {
        setReminderAt("");
        setReminderNote("");
        return;
      }
      if (!result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorAddReminder"), { description: toHebrewError(result.error, "") });
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
      toast.success(t(tasksDict, props.locale, "toastReminderAdded"));
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorAddReminder"), { description: getErrorMessage(error) });
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
        t(tasksDict, props.locale, "updateReminderOfflineLabel")
      );
      if (!result.queued && !result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorUpdateReminder"), { description: toHebrewError(result.error, "") });
        return;
      }
      setEditingReminderId(null);
      setReminderAt("");
      setReminderNote("");
      if (!result.queued) toast.success(t(tasksDict, props.locale, "toastReminderUpdated"));
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorUpdateReminder"), { description: getErrorMessage(error) });
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
        nextStatus === "done"
          ? t(tasksDict, props.locale, "markReminderDoneOfflineLabel")
          : t(tasksDict, props.locale, "cancelReminderOfflineLabel")
      );
      if (!result.queued && !result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorUpdateReminder"), { description: toHebrewError(result.error, "") });
      }
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorUpdateReminder"), { description: getErrorMessage(error) });
    }
  }

  /** Send the files staged during creation, now that the task has an id. */
  async function uploadPendingFiles(taskId: string) {
    if (pendingFiles.length === 0) return;
    if (!taskId) {
      toast.error(t(tasksDict, props.locale, "filesNotAttachedCard"));
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
    if (uploaded > 0)
      toast.success(
        uploaded === 1
          ? t(tasksDict, props.locale, "fileUploadedSingle")
          : `${uploaded} ${t(tasksDict, props.locale, "filesUploadedCountSuffix")}`
      );
    // The task itself was created — don't fail the whole save over an attachment.
    if (failed.length > 0) toast.error(t(tasksDict, props.locale, "someFilesFailedUpload"), { description: failed.join(", ") });
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
          toast.error(t(tasksDict, props.locale, "toastErrorUploadFile"), { description: result.error });
          return;
        }
        uploaded += 1;
      }
      if (uploaded > 0)
        toast.success(
          uploaded === 1
            ? t(tasksDict, props.locale, "fileUploadedSingle")
            : t(tasksDict, props.locale, "filesUploadedPlural")
        );
      await fetchAttachments(targetId);
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorUploadFile"), { description: getErrorMessage(error) });
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
      const result = await offlineFetch(
        "/api/documents/delete",
        { document_id: target.id },
        t(tasksDict, props.locale, "deleteFileOfflineLabel")
      );
      if (!result.queued && !result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorDeleteFile"), { description: toHebrewError(result.error, "") });
        await fetchAttachments(targetId);
        return;
      }
      if (!result.queued) toast.success(t(tasksDict, props.locale, "toastFileDeleted"));
      setAttachmentToDelete(null);
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorDeleteFile"), { description: getErrorMessage(error) });
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
      const result = await offlineFetch(
        "/api/tasks/delete",
        { id: targetId },
        t(tasksDict, props.locale, "deleteTaskLabel")
      );
      if (!result.queued && !result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorDeleteTask"), { description: toHebrewError(result.error, "") });
        return;
      }
      if (!result.queued) toast.success(t(tasksDict, props.locale, "toastTaskDeleted"));
      props.onSaved?.();
      props.onOpenChange(false);
      router.refresh();
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorDeleteTask"), { description: getErrorMessage(error) });
    } finally {
      emitProgressActivityEnd();
      setSaving(false);
    }
  }

  const dialogTitle = isEditing ? t(tasksDict, props.locale, "dialogTitleEdit") : t(tasksDict, props.locale, "newTaskLabel");
  const targetTaskId = activeTaskId ?? props.taskId ?? null;

  // The card's sections, in order — they're the tab strip, the "הבא" order, and
  // what a swipe steps through, all from one list. Reminders are a section only
  // while creating; once the task exists they live in the card's own panel with
  // immediate add/done/cancel.
  const sections = useMemo(
    () => [
      { key: "description", label: t(tasksDict, props.locale, "sectionDescription"), icon: TextIcon },
      { key: "domain", label: t(tasksDict, props.locale, "sectionDomain"), icon: BusinessIcon },
      { key: "dates", label: t(tasksDict, props.locale, "sectionDates"), icon: ClockIcon },
      { key: "people", label: t(tasksDict, props.locale, "sectionPeople"), icon: UsersIcon },
      { key: "labels", label: t(tasksDict, props.locale, "sectionLabels"), icon: TagIcon },
      { key: "location", label: t(tasksDict, props.locale, "sectionLocation"), icon: LocationIcon },
      // Reminders are a tab either way — staged before the task exists, live
      // (add / edit / done / cancel) once it does.
      { key: "reminders", label: t(tasksDict, props.locale, "sectionReminders"), icon: NotificationIcon },
      // Uploading needs a task id, but CHOOSING files doesn't — on a new task
      // they're staged and uploaded right after it's created.
      { key: "files", label: t(tasksDict, props.locale, "sectionFiles"), icon: AttachIcon },
      // Comments only exist on a saved task.
      ...(isEditing && targetTaskId
        ? [{ key: "comments", label: t(tasksDict, props.locale, "sectionComments"), icon: CommentIcon }]
        : []),
    ],
    [isEditing, targetTaskId, props.locale]
  );
  // Tabs always have exactly one open — an unknown/cleared section falls back to
  // the first rather than showing an empty body under a strip of tabs.
  const activeIndex = Math.max(
    0,
    sections.findIndex((section) => section.key === openSection)
  );
  const activeSection = sections[activeIndex].key;
  // Bodies key off the RESOLVED section, not the raw state — otherwise a stale
  // key (e.g. "reminders" on a card that's since been saved) shows a tab strip
  // with nothing under it.
  const isOpen = (key: string) => activeSection === key;

  // Whichever section is open, its tab has to be ON SCREEN — pressing "הבא"
  // used to advance to a tab that was still off the end of the strip, so the
  // form changed under you with nothing to show which step you'd reached.
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const strip = tabStripRef.current;
    const tab = tabRefs.current.get(activeSection);
    if (!strip || !tab) return;
    const stripBox = strip.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    // scrollBy with a delta: RTL scroll origins differ between engines.
    const delta = tabBox.left + tabBox.width / 2 - (stripBox.left + stripBox.width / 2);
    if (Math.abs(delta) < 1) return;
    strip.scrollBy({ left: delta, behavior: "smooth" });
  }, [activeSection]);

  // Swipe the panel sideways to move between sections.
  const sectionsRef = useRef<HTMLDivElement | null>(null);
  useSwipeNavigation(sectionsRef, {
    enabled: props.open && !loading,
    onNext: () => setOpenSection(sections[Math.min(sections.length - 1, activeIndex + 1)].key),
    onPrevious: () => setOpenSection(sections[Math.max(0, activeIndex - 1)].key),
  });

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
      {/* A column, not a scrolling block: header and action bar are pinned and
          only the sections between them scroll (see dialog-chrome for the same
          shape). p-0 because each band brings its own padding. */}
      {/* One width for both modes now that everything is tabbed — the wide
          `details4xl` existed for the old two-column edit layout. */}
      <AdaptiveDialog
        size="form2xl"
        className="flex flex-col gap-0 overflow-y-hidden p-0 sm:p-0"
      >
        {/* A line under the name block, so the header reads as a pinned bar like
            every other dialog even though this one owns its own layout. */}
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 pb-3 pt-4 sm:px-6">
          <DialogTitle className="sr-only">{subject.trim() ? subject : dialogTitle}</DialogTitle>
          {/* pe-8 keeps the end button clear of the dialog's close X (top-left in RTL). */}
          {/* items-start, not items-center: the name grows downward when it's a list. */}
          <div className="flex items-start gap-2 pe-8">
            {isEditing ? (
              <button
                type="button"
                aria-label={t(tasksDict, props.locale, status === "done" ? "undoDoneAria" : "markDoneAria")}
                title={t(tasksDict, props.locale, status === "done" ? "undoDoneTitle" : "markDoneAria")}
                disabled={loading}
                onClick={() => setStatus(status === "done" ? "todo" : "done")}
                className="shrink-0 text-muted-foreground transition-colors hover:text-success disabled:opacity-40"
              >
                {status === "done" ? (
                  <SuccessIcon className="h-5 w-5 text-success" />
                ) : (
                  <UncheckedIcon className="h-5 w-5" />
                )}
              </button>
            ) : null}
            {/* A textarea, not an input: <input> silently strips newlines, so
                pasting or dictating a list would collapse into one long name and
                we'd never know it was a list.
                flex-1 + min-w-0 or it collapses to its intrinsic width in this
                flex row; min-h-0 to shed the component's 110px minimum, which is
                meant for a description box, not a title.
                The mic sits INSIDE the name field (bottom-end corner, with pe-10
                keeping the text clear of it): it belongs to the text it dictates,
                and on a phone the header row has no width to spare for it. */}
            <div className="relative min-w-0 flex-1">
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
                placeholder={t(tasksDict, props.locale, "subjectPlaceholder")}
                disabled={loading}
                rows={Math.min(Math.max(subjectLines.length, 1), 8)}
                // Bordered like any other field: without a box it read as a
                // heading, not as the thing you're meant to type the name into.
                // min-h-10 (not min-h-0): one line of text-lg is shorter than the
                // mic sitting in the corner, so the button poked out of the field.
                className="min-h-10 w-full resize-none px-3 py-1.5 pe-11 text-lg font-semibold leading-snug"
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
                title={t(tasksDict, props.locale, "dictateSubjectTitle")}
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
            {/* Icon only — the word "הפוך לפרטי" cost the name field a third of
                the row on a phone. Filled lock = private, outlined open lock =
                not; the title carries the wording. */}
            {viewerIsCreator ? (
              <Button
                type="button"
                variant={isPrivate ? "default" : "outline"}
                size="icon-sm"
                disabled={loading}
                onClick={() => void togglePrivate()}
                aria-label={t(tasksDict, props.locale, isPrivate ? "cancelPrivateAria" : "makePrivateAria")}
                title={t(tasksDict, props.locale, isPrivate ? "privateActiveTitle" : "privateInactiveTitle")}
                className="shrink-0"
              >
                {isPrivate ? <LockIcon /> : <UnlockIcon />}
              </Button>
            ) : isPrivate ? (
              // Non-creator viewing a private task they own: show a static marker.
              <span
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-primary"
                title={t(tasksDict, props.locale, "privateStaticLabel")}
                aria-label={t(tasksDict, props.locale, "privateStaticLabel")}
              >
                <LockIcon className="h-4 w-4" />
              </span>
            ) : null}
            {isEditing && targetTaskId ? (
              <DeleteButton
                label={t(tasksDict, props.locale, "deleteTheTaskButtonLabel")}
                disabled={saving || loading}
                onClick={() => setConfirmDeleteOpen(true)}
              />
            ) : null}
          </div>
          <DialogDescription className="sr-only">{t(tasksDict, props.locale, "dialogDescriptionSr")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground">
            <SpinnerIcon className="h-5 w-5 animate-spin" />
            {t(tasksDict, props.locale, "loadingTaskData")}
          </div>
        ) : (
        // The dialog is a column: header, ONE scrolling middle, and a footer that
        // can't scroll away. The form owns the column so its submit button can
        // stay in the footer.
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/* The section tabs — one row, always exactly one open, scrollable
              sideways when they don't fit. Swipe the panel below to step through
              them (see useSwipeNavigation: right = forward, matching the rest of
              the app's RTL paging). */}
          <div className="shrink-0 border-b border-border/70 px-4 sm:px-6">
            <div
              ref={tabStripRef}
              dir="rtl"
              className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden sm:gap-3"
            >
              {sections.map((section) => {
                const active = section.key === activeSection;
                const Icon = section.icon;
                return (
                  <button
                    key={section.key}
                    ref={(node) => {
                      if (node) tabRefs.current.set(section.key, node);
                      else tabRefs.current.delete(section.key);
                    }}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setOpenSection(section.key)}
                    className={`-mb-px inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-t-md border-b-[3px] px-2 pb-2 pt-1 text-sm leading-tight transition-colors hover:bg-muted/60 ${
                      active
                        ? "border-primary font-bold text-primary"
                        : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div ref={sectionsRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="space-y-3">
          {/* Voice fill — a button like any other, above the open section. */}
          {!isEditing ? (
            <TaskVoiceFillButton
              users={props.users.map((u) => ({ id: u.id, label: u.label }))}
              domains={domainOptions}
              onParsed={applyParsed}
              disabled={loading}
            />
          ) : null}

          {isOpen("description") ? (
            <TaskDescriptionSection description={description} onChange={setDescription} locale={props.locale} />
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
              locale={props.locale}
            />
          ) : null}

              {isOpen("dates") ? (
                <TaskDatesSection
                  dueDate={dueDate}
                  onDueDateChange={setDueDate}
                  dueTime={dueTime}
                  onDueTimeChange={setDueTime}
                  locale={props.locale}
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
                  locale={props.locale}
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
                  locale={props.locale}
                />
              ) : null}

              {isOpen("files") ? (
                targetTaskId ? (
                  <TaskAttachmentsSection
                    attachments={attachments}
                    uploadingFiles={uploadingFiles}
                    onUpload={(files) => void uploadAttachments(files)}
                    onRequestDelete={setAttachmentToDelete}
                    locale={props.locale}
                  />
                ) : (
                  <TaskPendingFilesSection
                    files={pendingFiles}
                    onAdd={(picked) => setPendingFiles((prev) => [...prev, ...picked])}
                    onRemove={(index) => setPendingFiles((prev) => prev.filter((_, i) => i !== index))}
                    locale={props.locale}
                  />
                )
              ) : null}

              {isOpen("labels") ? (
                <TaskLabelsSection
                  priority={priority}
                  onPriorityChange={setPriority}
                  status={status}
                  onStatusChange={setStatus}
                  locale={props.locale}
                />
              ) : null}

              {/* Reminders: staged locally before the task exists, live once it
                  does — one tab, either way. */}
              {isOpen("reminders") ? (
                isEditing && targetTaskId ? (
                  <TaskRemindersPanel
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
                    locale={props.locale}
                  />
                ) : (
                  <TaskRemindersStagingSection
                    pendingReminders={pendingReminders}
                    reminderAt={reminderAt}
                    setReminderAt={setReminderAt}
                    reminderNote={reminderNote}
                    setReminderNote={setReminderNote}
                    onStage={stageReminder}
                    onRemove={removePendingReminder}
                    locale={props.locale}
                  />
                )
              ) : null}

              {isOpen("comments") && isEditing && targetTaskId ? (
                <TaskCommentsPanel
                  comments={comments}
                  legacyNotes={legacyNotes}
                  newComment={newComment}
                  setNewComment={setNewComment}
                  addingComment={addingComment}
                  onAddComment={() => void addComment()}
                  colorIndexById={colorIndexById}
                  chosenColorById={chosenColorById}
                  locale={props.locale}
                />
              ) : null}
          </div>
          </div>

          {/* Action bar — a real footer of the dialog, outside the scrolling
              area, so "הבא" and Save are on screen wherever you are in the form.
              They used to sit at the end of the scroll, below the fold. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/70 bg-background px-4 py-3 sm:px-6">
            {wizard && activeIndex < sections.length - 1 ? (
              <Button
                type="button"
                variant="secondary"
                className="me-auto"
                onClick={() => setOpenSection(sections[activeIndex + 1].key)}
              >
                {t(tasksDict, props.locale, "nextButton")}
              </Button>
            ) : (
              <div className="me-auto" />
            )}
            {!isEditing || dirty ? (
              <Button type="submit" disabled={!canSubmit || saving || loading}>
                {saving
                  ? t(tasksDict, props.locale, "savingEllipsis")
                  : isEditing
                    ? t(tasksDict, props.locale, "saveChangesButton")
                    : t(tasksDict, props.locale, "createButton")}
              </Button>
            ) : null}
          </div>
        </form>
        )}
      </AdaptiveDialog>
    </Dialog>

    {/* The name has several lines — is it a list, or one long name? Only the
        person typing knows, so ask. Three real choices, which is why this isn't
        a ConfirmDialog (its "cancel" would have to lie about what it does). */}
    <ViewDialog
      open={splitAsk}
      onOpenChange={setSplitAsk}
      title={`${subjectLines.length} ${t(tasksDict, props.locale, "splitAskTitleSuffix")}`}
      description={t(tasksDict, props.locale, "splitAskDescription")}
      size="formSm"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
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
            {t(tasksDict, props.locale, "oneTaskButton")}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void submitAsSeparateTasks()}>
            {saving
              ? t(tasksDict, props.locale, "creatingEllipsis")
              : `${t(tasksDict, props.locale, "createCountPrefix")} ${subjectLines.length} ${t(tasksDict, props.locale, "tasksWord")}`}
          </Button>
        </div>
      }
    >
      <ul className="space-y-1 rounded-lg border border-border/60 p-2 text-sm">
        {subjectLines.map((line, i) => (
          <li key={`${line}-${i}`} className="flex items-start gap-2">
            <span className="text-muted-foreground">{i + 1}.</span>
            <span className="min-w-0 flex-1">{line}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t(tasksDict, props.locale, "splitAskFooterNote")}
      </p>
    </ViewDialog>

    <ConfirmDialog
      open={confirmDeleteOpen}
      onOpenChange={setConfirmDeleteOpen}
      title={t(tasksDict, props.locale, "deleteTaskLabel")}
      description={
        <>
          {t(tasksDict, props.locale, "confirmDeleteTaskPrefix")}{" "}
          <span className="font-medium">&quot;{subject.trim()}&quot;</span>
          {t(tasksDict, props.locale, "confirmDeleteTaskSuffix")}
        </>
      }
      confirmLabel={t(commonDict, props.locale, "delete")}
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
      title={t(tasksDict, props.locale, "deleteFileOfflineLabel")}
      description={
        <>
          {t(tasksDict, props.locale, "confirmDeleteAttachmentPrefix")}{" "}
          <span className="font-medium">&quot;{attachmentToDelete?.name ?? ""}&quot;</span>
          {t(tasksDict, props.locale, "confirmDeleteAttachmentSuffix")}
        </>
      }
      confirmLabel={t(commonDict, props.locale, "delete")}
      destructive
      loading={deletingAttachment}
      onConfirm={() => void performDeleteAttachment()}
    />

    <ConfirmDialog
      open={confirmDiscardOpen}
      onOpenChange={(open) => {
        if (!open) setConfirmDiscardOpen(false);
      }}
      title={t(tasksDict, props.locale, "discardTitle")}
      description={t(tasksDict, props.locale, "discardDescription")}
      confirmLabel={t(tasksDict, props.locale, "discardConfirmLabel")}
      cancelLabel={t(tasksDict, props.locale, "discardCancelLabel")}
      destructive
      onConfirm={() => {
        setConfirmDiscardOpen(false);
        doClose();
      }}
    />
    </>
  );
}
