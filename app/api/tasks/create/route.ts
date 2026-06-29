import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { parseTagIds, syncEntityTags } from "@/lib/tags";

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
      is_private?: boolean | null;
      tag_ids?: unknown;
      reminders?: Array<{ remind_at?: string | null; content?: string | null }> | null;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    // Only the name is required. Everything else is optional and can be added later
    // by opening the card, so we fall back to sensible defaults when not supplied.
    const businessDomain = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : "general_business";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const dueDate = typeof body.due_date === "string" && body.due_date.trim() ? body.due_date : null;
    const dueTime = typeof body.due_time === "string" && body.due_time.trim() ? body.due_time.trim() : null;
    const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : null;
    const address = typeof body.address === "string" && body.address.trim() ? body.address.trim() : null;
    // Every task must have an owner — default to the creator when no assignee is
    // supplied, so we never store ownerless tasks.
    const assignedUserId =
      typeof body.assigned_user_id === "string" && body.assigned_user_id.trim()
        ? body.assigned_user_id.trim()
        : profile.id;
    const memberIds = Array.isArray(body.member_ids)
      ? [...new Set(body.member_ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))]
      : [];
    const priority = typeof body.priority === "string" && body.priority.trim() ? body.priority : "medium";
    const status = typeof body.status === "string" && body.status.trim() ? body.status : "todo";
    // A private task is visible only to its owner — the creator claims it.
    const isPrivate = body.is_private === true;

    const hasProject = Boolean(projectId);
    const hasProperty = Boolean(propertyId);
    if (!subject) {
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
        is_private: isPrivate,
        // private_owner_id doubles as the creator/owner: always the creator, set at
        // creation. Only this user may later toggle the task's privacy.
        private_owner_id: profile.id,
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
      await syncEntityTags(supabase, "task", data.id, parseTagIds(body.tag_ids), {
        createdBy: profile.id,
      });

      // Reminders staged in the create dialog — insert now that the task id exists.
      // Mirrors /api/tasks/reminders/create (content "" for the legacy NOT-NULL,
      // category 'task', assignee defaults to the task owner).
      const reminders = Array.isArray(body.reminders)
        ? body.reminders
            .map((r) => ({
              remind_at: typeof r?.remind_at === "string" ? r.remind_at.trim() : "",
              content: typeof r?.content === "string" ? r.content.trim() : "",
            }))
            .filter((r) => r.remind_at)
        : [];
      if (reminders.length > 0) {
        await supabase.from("reminders").insert(
          reminders.map((r) => ({
            task_id: data.id,
            remind_at: r.remind_at,
            content: r.content || "",
            action_type: "other",
            category: "task",
            assigned_to: assignedUserId,
            created_by: profile.id,
            updated_by: profile.id,
          }))
        );
      }
    }

    return NextResponse.json({ task: data });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
