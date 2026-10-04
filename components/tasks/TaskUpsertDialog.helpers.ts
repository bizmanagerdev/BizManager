// Pure, framework-free logic extracted from TaskUpsertDialog.tsx so it can be
// unit-tested (characterization) and the component stays presentational. Nothing
// here touches React, the DOM, or the network.

import {
  EXPENSE_BUSINESS_DOMAINS,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskTargetType = "project" | "property";

export type FixedTarget = { type: TaskTargetType; id: string } | null;

export type LegacyNote = {
  stamp: string | null;
  author: string | null;
  message: string | null;
  raw: string;
};

export const STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];
export const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];

// Step order for the guided create flow — must match the action-chip order in the
// dialog (תיאור · תחום · תאריך · אחראי וחברים · עדיפות וסטטוס · מיקום · תזכורות).
export const WIZARD_STEPS = [
  "description",
  "domain",
  "dates",
  "people",
  "labels",
  "location",
  "reminders",
] as const;

/** Next step in the guided create flow, or null when on the last step. An unknown
 *  current step restarts at the first. */
export function nextWizardStep(current: string | null): string | null {
  const list = WIZARD_STEPS as readonly string[];
  const i = current ? list.indexOf(current) : -1;
  if (i === -1) return list[0];
  return i < list.length - 1 ? list[i + 1] : null;
}

// Old tasks stored comments in a single tasks.notes blob ("[stamp] author: message",
// separated by blank lines). Parse them so that history stays visible on the card.
export function parseLegacyNotes(raw: string | null | undefined): LegacyNote[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  return text
    .split("\n\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/^\[(.+?)\]\s(.+?):\s([\s\S]*)$/);
      if (!m) return { raw: t, stamp: null, author: null, message: null };
      return { raw: t, stamp: m[1] ?? null, author: m[2] ?? null, message: m[3] ?? null };
    });
}

/** Which kind of link a domain implies (logistics→project, property→property). */
export function targetTypeForDomain(domain: ExpenseBusinessDomain): TaskTargetType | null {
  if (domain === "logistics_projects") return "project";
  if (domain === "property_management") return "property";
  return null;
}

/** Domains offered given a fixed target: a property/project target locks the list
 *  to its single matching domain; otherwise every business domain is allowed. */
export function allowedDomainsForFixedTarget(
  fixedTarget: FixedTarget | undefined,
  defaultDomain: ExpenseBusinessDomain
): ExpenseBusinessDomain[] {
  if (!fixedTarget) return [...EXPENSE_BUSINESS_DOMAINS];
  if (fixedTarget.type === "property") return ["property_management"];
  if (fixedTarget.type === "project") return ["logistics_projects"];
  return [defaultDomain];
}

/** The domain actually in effect: empty stays empty (no choice yet); an allowed
 *  domain passes through; anything else falls back to the first allowed domain. */
export function resolveEffectiveDomain(
  businessDomain: ExpenseBusinessDomain | "",
  allowedDomains: ExpenseBusinessDomain[],
  defaultDomain: ExpenseBusinessDomain
): ExpenseBusinessDomain | "" {
  if (businessDomain === "") return "";
  return allowedDomains.includes(businessDomain)
    ? businessDomain
    : allowedDomains[0] ?? defaultDomain;
}

/** Whether the required project/property link (if the domain needs one) is filled. */
export function computeTargetOk(input: {
  effectiveTarget: FixedTarget;
  derivedTargetType: TaskTargetType | null;
  projectId: string;
  propertyId: string;
}): boolean {
  if (input.effectiveTarget) return Boolean(input.effectiveTarget.id);
  if (input.derivedTargetType === "project") return Boolean(input.projectId);
  if (input.derivedTargetType === "property") return Boolean(input.propertyId);
  return true;
}

/** Only the task name is required; targetOk covers the conditional project/property link. */
export function canSubmitTask(subject: string, targetOk: boolean): boolean {
  return Boolean(subject.trim()) && targetOk;
}

export function normalizeTaskStatus(raw: unknown): TaskStatus {
  return STATUS_OPTIONS.includes(raw as TaskStatus) ? (raw as TaskStatus) : "todo";
}

export function normalizeTaskPriority(raw: unknown): TaskPriority {
  return PRIORITY_OPTIONS.includes(raw as TaskPriority) ? (raw as TaskPriority) : "medium";
}

export type TaskPayloadInput = {
  effectiveTarget: FixedTarget;
  derivedTargetType: TaskTargetType | null;
  effectiveDomain: ExpenseBusinessDomain | "";
  projectId: string;
  propertyId: string;
  /** Independent customer link — not tied to the project/property target. */
  customerId?: string;
  subject: string;
  description: string;
  dueDate: string;
  dueTime: string;
  city: string;
  address: string;
  assignedUserId: string;
  memberIds: string[];
  tagIds: string[];
  pendingReminders: { remind_at: string; content: string }[];
  priority: TaskPriority;
  status: TaskStatus;
  isPrivate: boolean;
};

/** The create/update request body. A fixed target wins over the picked id; empty
 *  optional strings collapse to null; staged reminders become ISO timestamps. */
export function buildTaskPayload(input: TaskPayloadInput) {
  const linkType = input.effectiveTarget?.type ?? input.derivedTargetType;
  return {
    // No domain chosen → default to general business (no project/property link).
    business_domain: input.effectiveDomain || "general_business",
    project_id: linkType === "project" ? input.effectiveTarget?.id ?? input.projectId : null,
    property_id: linkType === "property" ? input.effectiveTarget?.id ?? input.propertyId : null,
    customer_id: input.customerId?.trim() ? input.customerId.trim() : null,
    subject: input.subject.trim(),
    description: input.description.trim() ? input.description.trim() : null,
    due_date: input.dueDate || null,
    due_time: input.dueTime || null,
    city: input.city.trim() ? input.city.trim() : null,
    address: input.address.trim() ? input.address.trim() : null,
    assigned_user_id: input.assignedUserId || null,
    member_ids: input.memberIds,
    tag_ids: input.tagIds,
    // Staged on create only; in edit mode reminders are added immediately and this
    // stays empty (the update route ignores it).
    reminders: input.pendingReminders.map((r) => ({
      remind_at: new Date(r.remind_at).toISOString(),
      content: r.content.trim() ? r.content.trim() : null,
    })),
    priority: input.priority,
    status: input.status,
    is_private: input.isPrivate,
  };
}

export type TaskPayload = ReturnType<typeof buildTaskPayload>;

// What an edit-mode autosave may send. Not `is_private` (the lock button saves
// itself the moment it's pressed) and not `reminders` (staged on create only —
// on a saved task each reminder is written as it's added).
const AUTOSAVE_KEYS = [
  "business_domain",
  "project_id",
  "property_id",
  "customer_id",
  "subject",
  "description",
  "due_date",
  "due_time",
  "city",
  "address",
  "assigned_user_id",
  "member_ids",
  "tag_ids",
  "priority",
  "status",
] as const satisfies readonly (keyof TaskPayload)[];

// The domain and its project/property link are validated together on the
// server — a change to any one of them goes up with the other two.
const LINK_KEYS = new Set<string>(["business_domain", "project_id", "property_id"]);

function comparable(key: string, value: unknown): string {
  // Order-only differences in a list are not a change.
  if ((key === "member_ids" || key === "tag_ids") && Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }
  return JSON.stringify(value ?? null);
}

/**
 * The fields that differ between what was last saved and what the form holds
 * now — the body of an autosave, so a save sends ONLY what changed (no member
 * or tag rewrite when neither was touched; no re-sending a name that wasn't
 * edited). Null when nothing changed.
 */
export function diffTaskPayload(saved: TaskPayload, next: TaskPayload): Partial<TaskPayload> | null {
  const changed = AUTOSAVE_KEYS.filter((key) => comparable(key, saved[key]) !== comparable(key, next[key]));
  if (changed.length === 0) return null;
  const keys = new Set<string>(changed);
  if (changed.some((key) => LINK_KEYS.has(key))) LINK_KEYS.forEach((key) => keys.add(key));
  const diff: Record<string, unknown> = {};
  for (const key of AUTOSAVE_KEYS) if (keys.has(key)) diff[key] = next[key];
  return diff as Partial<TaskPayload>;
}
