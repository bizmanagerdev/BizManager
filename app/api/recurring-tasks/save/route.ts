import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";

type Payload = {
  id?: string | null;
  subject_template?: string | null;
  description_template?: string | null;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  default_priority?: string | null;
  default_status?: string | null;
  create_day_of_month?: number | null;
  due_day_of_month?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean | null;
  assignee_user_ids?: string[] | null;
};

function normalizeId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeDay(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(31, Math.floor(parsed)));
}

function validateTaskLinkArgs(args: {
  businessDomain: string | null;
  hasProject: boolean;
  hasProperty: boolean;
}) {
  if (args.businessDomain === "logistics_projects") return args.hasProject && !args.hasProperty;
  if (args.businessDomain === "property_management") return !args.hasProject && args.hasProperty;
  return !args.hasProject && !args.hasProperty;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const id = normalizeId(body.id);
    const subjectTemplate =
      typeof body.subject_template === "string" ? body.subject_template.trim() : "";
    const descriptionTemplate =
      typeof body.description_template === "string" ? body.description_template.trim() : null;
    const businessDomain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null;
    const projectId = normalizeId(body.project_id);
    const propertyId = normalizeId(body.property_id);
    const defaultPriority =
      typeof body.default_priority === "string" && body.default_priority.trim()
        ? body.default_priority.trim()
        : "medium";
    const defaultStatus =
      typeof body.default_status === "string" && body.default_status.trim()
        ? body.default_status.trim()
        : "todo";
    const createDay = normalizeDay(body.create_day_of_month, 1);
    const dueDay = normalizeDay(body.due_day_of_month, createDay);
    const startDate = typeof body.start_date === "string" && body.start_date ? body.start_date : null;
    const endDate = typeof body.end_date === "string" && body.end_date ? body.end_date : null;
    const isActive = body.is_active === false ? false : true;
    const assigneeUserIds = Array.from(
      new Set(((body.assignee_user_ids ?? []) as string[]).map((value) => normalizeId(value)).filter(Boolean))
    ) as string[];

    if (!subjectTemplate || !businessDomain || assigneeUserIds.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (
      !validateTaskLinkArgs({
        businessDomain,
        hasProject: Boolean(projectId),
        hasProperty: Boolean(propertyId),
      })
    ) {
      return NextResponse.json(
        { error: "Invalid linked target for selected business_domain" },
        { status: 400 }
      );
    }

    const templatePayload = {
      subject_template: subjectTemplate,
      description_template: descriptionTemplate && descriptionTemplate.trim() ? descriptionTemplate : null,
      business_domain: businessDomain,
      project_id: businessDomain === "logistics_projects" ? projectId : null,
      property_id: businessDomain === "property_management" ? propertyId : null,
      default_priority: defaultPriority,
      default_status: defaultStatus,
      frequency: "monthly",
      create_day_of_month: createDay,
      due_day_of_month: dueDay,
      start_date: startDate,
      end_date: endDate,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    };

    let templateId = id;

    if (templateId) {
      const { error } = await supabase
        .from("recurring_task_templates")
        .update(templatePayload)
        .eq("id", templateId);

      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    } else {
      const { data, error } = await supabase
        .from("recurring_task_templates")
        .insert({
          ...templatePayload,
          created_by: profile.id,
        })
        .select("id")
        .maybeSingle<{ id: string }>();

      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      templateId = data?.id ?? null;
    }

    if (!templateId) {
      return NextResponse.json({ error: "Failed to save recurring task template" }, { status: 500 });
    }

    const { error: deleteAssigneesError } = await supabase
      .from("recurring_task_template_assignees")
      .delete()
      .eq("recurring_task_template_id", templateId);

    if (deleteAssigneesError) {
      return NextResponse.json({ error: toHebrewError(deleteAssigneesError.message) }, { status: 400 });
    }

    const { error: insertAssigneesError } = await supabase
      .from("recurring_task_template_assignees")
      .insert(
        assigneeUserIds.map((userId) => ({
          recurring_task_template_id: templateId,
          user_id: userId,
        }))
      );

    if (insertAssigneesError) {
      return NextResponse.json({ error: toHebrewError(insertAssigneesError.message) }, { status: 400 });
    }

    return NextResponse.json({ ok: true, id: templateId });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

