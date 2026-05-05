import type { SupabaseClient } from "@supabase/supabase-js";
import { getBusinessDomainLabel, isExpenseBusinessDomain, type ExpenseBusinessDomain } from "@/lib/expenses";

type TemplateRow = {
  id: string;
  subject_template: string | null;
  description_template: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  default_priority: string | null;
  default_status: string | null;
  frequency: string | null;
  create_day_of_month: number | string | null;
  due_day_of_month: number | string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
};

type TemplateAssigneeRow = {
  recurring_task_template_id: string;
  user_id: string;
};

type EnsureRecurringResult = {
  ok: boolean;
  createdCount: number;
  skippedMissingSchema: boolean;
  error?: string;
};

function parsePositiveDay(value: number | string | null | undefined, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(31, Math.floor(parsed)));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function buildMonthKey(year: number, monthIndexZeroBased: number) {
  return `${year}-${pad2(monthIndexZeroBased + 1)}`;
}

function buildClampedMonthDate(year: number, monthIndexZeroBased: number, dayOfMonth: number) {
  const lastDay = new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)).getUTCDate();
  const day = Math.min(dayOfMonth, lastDay);
  return `${year}-${pad2(monthIndexZeroBased + 1)}-${pad2(day)}`;
}

function applyTemplateTokens(value: string | null, params: { monthKey: string; monthLabel: string; dueDate: string }) {
  if (!value) return null;
  return value
    .replaceAll("{{month_key}}", params.monthKey)
    .replaceAll("{{month_label}}", params.monthLabel)
    .replaceAll("{{due_date}}", params.dueDate);
}

function looksLikeMissingSchema(message: string) {
  const value = message.toLowerCase();
  return value.includes("does not exist") || value.includes("could not find") || value.includes("schema cache");
}

function looksLikeUniqueViolation(message: string) {
  const value = message.toLowerCase();
  return value.includes("duplicate key") || value.includes("23505");
}

export async function ensureRecurringTasksForDate(
  supabase: SupabaseClient,
  options?: { today?: Date }
): Promise<EnsureRecurringResult> {
  const today = options?.today ?? new Date();
  const year = today.getUTCFullYear();
  const monthIndex = today.getUTCMonth();
  const todayIso = today.toISOString().slice(0, 10);
  const monthKey = buildMonthKey(year, monthIndex);
  const monthLabel = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, monthIndex, 1))
  );

  const { data: templatesData, error: templatesError } = await supabase
    .from("recurring_task_templates")
    .select(
      "id,subject_template,description_template,business_domain,project_id,property_id,default_priority,default_status,frequency,create_day_of_month,due_day_of_month,start_date,end_date,is_active"
    )
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (templatesError) {
    if (looksLikeMissingSchema(templatesError.message)) {
      return { ok: true, createdCount: 0, skippedMissingSchema: true };
    }
    return { ok: false, createdCount: 0, skippedMissingSchema: false, error: templatesError.message };
  }

  const templates = (templatesData ?? []) as TemplateRow[];
  if (templates.length === 0) {
    return { ok: true, createdCount: 0, skippedMissingSchema: false };
  }

  const templateIds = templates.map((template) => template.id).filter(Boolean);
  const { data: assigneesData, error: assigneesError } = await supabase
    .from("recurring_task_template_assignees")
    .select("recurring_task_template_id,user_id")
    .in("recurring_task_template_id", templateIds);

  if (assigneesError) {
    if (looksLikeMissingSchema(assigneesError.message)) {
      return { ok: true, createdCount: 0, skippedMissingSchema: true };
    }
    return { ok: false, createdCount: 0, skippedMissingSchema: false, error: assigneesError.message };
  }

  const assigneesByTemplateId = new Map<string, string[]>();
  ((assigneesData ?? []) as TemplateAssigneeRow[]).forEach((row) => {
    const current = assigneesByTemplateId.get(row.recurring_task_template_id) ?? [];
    current.push(row.user_id);
    assigneesByTemplateId.set(row.recurring_task_template_id, current);
  });

  let createdCount = 0;

  for (const template of templates) {
    if (!template.id || !template.subject_template || !isExpenseBusinessDomain(template.business_domain)) continue;
    if (template.frequency !== "monthly") continue;

    const createDay = parsePositiveDay(template.create_day_of_month, 1);
    const dueDay = parsePositiveDay(template.due_day_of_month, createDay);
    const createDate = buildClampedMonthDate(year, monthIndex, createDay);
    const dueDate = buildClampedMonthDate(year, monthIndex, dueDay);

    if (todayIso < createDate) continue;
    if (template.start_date && dueDate < template.start_date) continue;
    if (template.end_date && createDate > template.end_date) continue;

    const businessDomain = template.business_domain as ExpenseBusinessDomain;
    const projectId = businessDomain === "logistics_projects" ? template.project_id : null;
    const propertyId = businessDomain === "property_management" ? template.property_id : null;
    if (businessDomain === "logistics_projects" && !projectId) continue;
    if (businessDomain === "property_management" && !propertyId) continue;
    if (!["logistics_projects", "property_management"].includes(businessDomain) && (projectId || propertyId)) continue;

    const assigneeIds = assigneesByTemplateId.get(template.id) ?? [];
    if (assigneeIds.length === 0) continue;

    const subject = applyTemplateTokens(template.subject_template, { monthKey, monthLabel, dueDate });
    const description = applyTemplateTokens(template.description_template, { monthKey, monthLabel, dueDate });
    if (!subject?.trim()) continue;

    for (const assignedUserId of assigneeIds) {
      const { error } = await supabase.from("tasks").insert({
        recurring_task_template_id: template.id,
        recurrence_key: monthKey,
        business_domain: businessDomain,
        project_id: projectId,
        property_id: propertyId,
        assigned_user_id: assignedUserId,
        subject: subject.trim(),
        description: description?.trim() ? description.trim() : null,
        due_date: dueDate,
        priority: template.default_priority ?? "medium",
        status: template.default_status ?? "todo",
      });

      if (error) {
        if (looksLikeUniqueViolation(error.message)) continue;
        return { ok: false, createdCount, skippedMissingSchema: false, error: error.message };
      }
      createdCount += 1;
    }
  }

  return { ok: true, createdCount, skippedMissingSchema: false };
}

export function recurringTaskDomainLabel(value: string | null | undefined) {
  return isExpenseBusinessDomain(value) ? getBusinessDomainLabel(value) : value || "—";
}

