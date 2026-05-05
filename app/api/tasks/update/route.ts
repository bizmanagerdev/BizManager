import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";

function normalizeId(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return value ?? null;
}

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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      business_domain?: string | null;
      project_id?: string | null;
      property_id?: string | null;
      subject?: string | null;
      description?: string | null;
      due_date?: string | null;
      assigned_user_id?: string | null;
      priority?: string | null;
      status?: string | null;
    };

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const update: Record<string, unknown> = {};

    if ("business_domain" in body) {
      const domain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null;
      if (!domain) {
        return NextResponse.json({ error: "Missing or invalid business_domain" }, { status: 400 });
      }
      update.business_domain = domain;
    }

    if ("subject" in body) {
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      if (!subject) return NextResponse.json({ error: "Missing subject" }, { status: 400 });
      update.subject = subject;
    }

    if ("description" in body) {
      const description =
        typeof body.description === "string" ? body.description.trim() : body.description ?? null;
      update.description = description && description.trim() ? description : null;
    }

    if ("due_date" in body) {
      const dueDate =
        typeof body.due_date === "string" ? body.due_date : body.due_date ?? null;
      if (!dueDate) return NextResponse.json({ error: "Missing due_date" }, { status: 400 });
      update.due_date = dueDate;
    }

    if ("assigned_user_id" in body) {
      const assignedUserId = normalizeId(body.assigned_user_id);
      if (!assignedUserId) {
        return NextResponse.json({ error: "Missing assigned_user_id" }, { status: 400 });
      }
      update.assigned_user_id = assignedUserId;
    }

    if ("priority" in body) {
      const priority = typeof body.priority === "string" ? body.priority : "";
      if (!priority) return NextResponse.json({ error: "Missing priority" }, { status: 400 });
      update.priority = priority;
    }

    if ("status" in body) {
      const status = typeof body.status === "string" ? body.status : "";
      if (!status) return NextResponse.json({ error: "Missing status" }, { status: 400 });
      update.status = status;
    }

    const projectProvided = "project_id" in body;
    const propertyProvided = "property_id" in body;
    const domainProvided = "business_domain" in body;
    if (projectProvided || propertyProvided || domainProvided) {
      const { data: current, error: currentError } = await supabase
        .from("tasks")
        .select("id,business_domain,project_id,property_id")
        .eq("id", id)
        .maybeSingle<Record<string, unknown>>();

      if (currentError) {
        return NextResponse.json({ error: currentError.message }, { status: 400 });
      }
      if (!current) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const currentBusinessDomain = isExpenseBusinessDomain(
        typeof (current as Record<string, unknown>).business_domain === "string"
          ? ((current as Record<string, unknown>).business_domain as string)
          : null
      )
        ? ((current as Record<string, unknown>).business_domain as string)
        : null;
      const currentProjectId = normalizeId((current as Record<string, unknown>).project_id);
      const currentPropertyId = normalizeId((current as Record<string, unknown>).property_id);

      const nextBusinessDomain = domainProvided
        ? (update.business_domain as string | null)
        : currentBusinessDomain;
      const nextProjectId = projectProvided ? normalizeId(body.project_id) : currentProjectId;
      const nextPropertyId = propertyProvided ? normalizeId(body.property_id) : currentPropertyId;

      const hasProject = Boolean(nextProjectId);
      const hasProperty = Boolean(nextPropertyId);
      if (!validateTaskLinkArgs({ businessDomain: nextBusinessDomain, hasProject, hasProperty })) {
        return NextResponse.json(
          { error: "Invalid linked target for selected business_domain" },
          { status: 400 }
        );
      }

      update.project_id = nextProjectId;
      update.property_id = nextPropertyId;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("tasks")
      .update(update)
      .eq("id", id)
      .select(
        "id,business_domain,project_id,property_id,assigned_user_id,subject,description,due_date,priority,status,created_at,updated_at"
      )
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (data?.id) {
      await logAuditEvent({
        supabase,
        tableName: "tasks",
        recordId: data.id,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ task: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
