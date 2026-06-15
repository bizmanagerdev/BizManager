import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { isExpenseBusinessDomain } from "@/lib/expenses";

function validateTaskLinkArgs(args: {
  businessDomain: string | null;
  hasProject: boolean;
  hasProperty: boolean;
}) {
  if (args.businessDomain === "logistics_projects") {
    return args.hasProject && !args.hasProperty;
  }
  if (args.businessDomain === "property_management") {
    return !args.hasProject && args.hasProperty;
  }
  return !args.hasProject && !args.hasProperty;
}

function normalizeTaskWriteError(message: string) {
  if (
    message.includes('null value in column "project_id"') ||
    message.includes('null value in column "property_id"')
  ) {
    return 'Task link columns are still using the old database constraint. Run db/sql/make_tasks_project_and_property_nullable.sql.';
  }
  return message;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "tasks/create", async () => {
    const body = (await req.json()) as {
      project_id?: string;
      property_id?: string;
      business_domain?: string | null;
      subject?: string;
      description?: string;
      due_date?: string | null;
      due_time?: string | null;
      city?: string | null;
      address?: string | null;
      assigned_user_id?: string | null;
      member_ids?: string[] | null;
      priority?: string | null;
      status?: string | null;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const businessDomain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null;
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const dueDate = typeof body.due_date === "string" ? body.due_date : body.due_date ?? null;
    const dueTime = typeof body.due_time === "string" && body.due_time.trim() ? body.due_time.trim() : null;
    const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : null;
    const address = typeof body.address === "string" && body.address.trim() ? body.address.trim() : null;
    const assignedUserId = typeof body.assigned_user_id === "string" ? body.assigned_user_id : body.assigned_user_id ?? null;
    const memberIds = Array.isArray(body.member_ids)
      ? [...new Set(body.member_ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))]
      : [];
    const priority = typeof body.priority === "string" ? body.priority : body.priority ?? null;
    const status = typeof body.status === "string" ? body.status : body.status ?? null;

    const hasProject = Boolean(projectId);
    const hasProperty = Boolean(propertyId);
    if (!businessDomain || !subject || !dueDate || !assignedUserId || !priority || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!validateTaskLinkArgs({ businessDomain, hasProject, hasProperty })) {
      return NextResponse.json(
        { error: "Invalid linked target for selected business_domain" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        business_domain: businessDomain,
        project_id: hasProject ? projectId : null,
        property_id: hasProperty ? propertyId : null,
        assigned_user_id: assignedUserId,
        subject,
        description,
        due_date: dueDate,
        due_time: dueTime,
        city,
        address,
        priority,
        status,
      })
      .select(
        "id,business_domain,project_id,property_id,assigned_user_id,subject,description,due_date,due_time,city,address,priority,status,created_at,updated_at"
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: normalizeTaskWriteError(error.message) }, { status: 400 });
    }
    if (data?.id) {
      // Members are extra collaborators on top of the primary assignee. Never store
      // the primary assignee as a duplicate member row.
      const extraMembers = memberIds.filter((memberId) => memberId !== assignedUserId);
      if (extraMembers.length > 0) {
        await supabase
          .from("task_members")
          .insert(extraMembers.map((userId) => ({ task_id: data.id, user_id: userId })));
      }
      await logAuditEvent({
        supabase,
        tableName: "tasks",
        recordId: data.id,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ task: data });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
