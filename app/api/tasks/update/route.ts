import { toHebrewError } from "@/lib/error-messages";
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
    const body = (await req.json()) as {
      id?: string;
      business_domain?: string | null;
      project_id?: string | null;
      property_id?: string | null;
      subject?: string | null;
      description?: string | null;
      due_date?: string | null;
      due_time?: string | null;
      city?: string | null;
      address?: string | null;
      assigned_user_id?: string | null;
      member_ids?: string[] | null;
      priority?: string | null;
      status?: string | null;
      is_private?: boolean | null;
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
      // Optional — a task may have no due date; an empty value clears it.
      update.due_date =
        typeof body.due_date === "string" && body.due_date.trim() ? body.due_date : null;
    }

    if ("due_time" in body) {
      update.due_time =
        typeof body.due_time === "string" && body.due_time.trim() ? body.due_time.trim() : null;
    }

    if ("city" in body) {
      update.city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : null;
    }

    if ("address" in body) {
      update.address =
        typeof body.address === "string" && body.address.trim() ? body.address.trim() : null;
    }

    if ("assigned_user_id" in body) {
      // Optional — a task may be unassigned; an empty value clears the assignee.
      update.assigned_user_id = normalizeId(body.assigned_user_id);
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

    if ("is_private" in body) {
      // Only the creator/owner may change privacy. private_owner_id is the creator
      // (set at creation), so gate on it and never clear it — privacy on/off only
      // flips is_private. The dialog always sends is_private, so we only
      // enforce/apply when the value actually changes (others can still edit
      // everything else on the task).
      const desired = body.is_private === true;
      const { data: cur } = await supabase
        .from("tasks")
        .select("is_private,private_owner_id")
        .eq("id", id)
        .maybeSingle<Record<string, unknown>>();
      const currentPrivate = (cur as Record<string, unknown> | null)?.is_private === true;
      const owner = typeof cur?.private_owner_id === "string" ? cur.private_owner_id : null;
      if (desired !== currentPrivate) {
        if (owner && owner !== profile.id) {
          return NextResponse.json(
            { error: "רק יוצר המשימה יכול לשנות את הפרטיות שלה." },
            { status: 403 }
          );
        }
        update.is_private = desired;
        // Legacy rows may have no owner yet — the first one to set privacy claims it.
        if (!owner) update.private_owner_id = profile.id;
      }
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
        return NextResponse.json({ error: toHebrewError(currentError.message) }, { status: 400 });
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

    const membersProvided = "member_ids" in body && Array.isArray(body.member_ids);

    if (Object.keys(update).length === 0 && !membersProvided) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    let data: Record<string, unknown> | null = null;
    if (Object.keys(update).length > 0) {
      const result = await supabase
        .from("tasks")
        .update(update)
        .eq("id", id)
        .select(
          "id,business_domain,project_id,property_id,assigned_user_id,subject,description,due_date,due_time,city,address,priority,status,created_at,updated_at"
        )
        .maybeSingle();
      if (result.error) {
        return NextResponse.json({ error: normalizeTaskWriteError(result.error.message) }, { status: 400 });
      }
      data = result.data as Record<string, unknown> | null;
    }

    // Sync members (delete-all / re-insert), excluding the primary assignee so it's
    // never duplicated as a collaborator row.
    if (membersProvided) {
      const { data: taskRow } = data
        ? { data }
        : await supabase.from("tasks").select("assigned_user_id").eq("id", id).maybeSingle<Record<string, unknown>>();
      const assignedUserId =
        typeof taskRow?.assigned_user_id === "string" ? taskRow.assigned_user_id : null;
      const memberIds = [
        ...new Set(
          (body.member_ids ?? []).filter(
            (memberId): memberId is string => typeof memberId === "string" && Boolean(memberId.trim())
          )
        ),
      ].filter((memberId) => memberId !== assignedUserId);

      await supabase.from("task_members").delete().eq("task_id", id);
      if (memberIds.length > 0) {
        const { error: membersError } = await supabase
          .from("task_members")
          .insert(memberIds.map((userId) => ({ task_id: id, user_id: userId })));
        if (membersError) {
          return NextResponse.json({ error: toHebrewError(membersError.message) }, { status: 400 });
        }
      }
    }

    if (id) {
      await logAuditEvent({
        supabase,
        tableName: "tasks",
        recordId: id,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ task: data });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
