import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { parseTagIds, syncEntityTags } from "@/lib/tags";
import { notifyTaskAssignees } from "@/lib/notifications/task-assignment";
import { runAfterResponse } from "@/lib/after-response";
import { translateToHebrew } from "@/lib/i18n/translateToHebrew";

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
      customer_id?: string | null;
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
      tag_ids?: unknown;
    };

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    // Speed (user, 2026-10-04: "many times in tasks I get that the connection
    // is slow saving the change"): a save used to run ~11 database round trips
    // one after another — three separate reads of the same task row, then
    // wiping and re-inserting every member, then the tags — and for an Arabic
    // writer two translation calls on top, all in series. The client's "slow
    // connection" notice fires at 4s. Now: the plain validation first, then
    // ONE read of the current row in parallel with the translations and the
    // member list, then the write, then members + tags together.
    const update: Record<string, unknown> = {};

    if ("business_domain" in body) {
      const domain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null;
      if (!domain) {
        return NextResponse.json({ error: "Missing or invalid business_domain" }, { status: 400 });
      }
      update.business_domain = domain;
    }

    let subjectText: string | null = null;
    if ("subject" in body) {
      subjectText = typeof body.subject === "string" ? body.subject.trim() : "";
      if (!subjectText) return NextResponse.json({ error: "Missing subject" }, { status: 400 });
      update.subject = subjectText;
    }

    let descriptionText: string | null = null;
    if ("description" in body) {
      const description =
        typeof body.description === "string" ? body.description.trim() : body.description ?? null;
      descriptionText = description && description.trim() ? description : null;
      update.description = descriptionText;
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

    if ("customer_id" in body) {
      // Independent of the project/property target — set or clear freely.
      update.customer_id = normalizeId(body.customer_id);
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

    const projectProvided = "project_id" in body;
    const propertyProvided = "property_id" in body;
    const domainProvided = "business_domain" in body;
    const linkProvided = projectProvided || propertyProvided || domainProvided;
    const membersProvided = "member_ids" in body && Array.isArray(body.member_ids);
    const tagsProvided = "tag_ids" in body;

    if (Object.keys(update).length === 0 && !("is_private" in body) && !linkProvided && !membersProvided && !tagsProvided) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Everything this save needs to know about the task as it stands, read ONCE
    // (it used to be three separate reads of the same row) — and alongside it,
    // the translations and the current member list, none of which wait on the
    // others. Office/admin never see Arabic, so a locale=ar worker's own words
    // are auto-translated to Hebrew; skipped entirely for Hebrew writers.
    const needsCurrent = "assigned_user_id" in body || "is_private" in body || linkProvided || membersProvided;
    const translating = profile.locale === "ar";
    const [currentRes, subjectHe, descriptionHe, existingMembersRes] = await Promise.all([
      needsCurrent
        ? supabase
            .from("tasks")
            .select("assigned_user_id,is_private,private_owner_id,business_domain,project_id,property_id,subject")
            .eq("id", id)
            .maybeSingle<Record<string, unknown>>()
        : Promise.resolve({ data: null, error: null }),
      translating && subjectText ? translateToHebrew(subjectText) : Promise.resolve(null),
      translating && descriptionText ? translateToHebrew(descriptionText) : Promise.resolve(null),
      membersProvided
        ? supabase.from("task_members").select("user_id").eq("task_id", id)
        : Promise.resolve({ data: null }),
    ]);
    const current = (currentRes.data ?? null) as Record<string, unknown> | null;
    if ("subject" in body) update.subject_he = translating ? subjectHe : null;
    if ("description" in body) update.description_he = translating && descriptionText ? descriptionHe : null;

    // So we can tell if a reassignment hands the task to a NEW person (only
    // then do they get an alert).
    const previousAssignee = typeof current?.assigned_user_id === "string" ? current.assigned_user_id : null;

    if ("is_private" in body) {
      // Only the creator/owner may change privacy. private_owner_id is the creator
      // (set at creation), so gate on it and never clear it — privacy on/off only
      // flips is_private. Only enforced/applied when the value actually changes
      // (others can still edit everything else on the task).
      const desired = body.is_private === true;
      const currentPrivate = current?.is_private === true;
      const owner = typeof current?.private_owner_id === "string" ? current.private_owner_id : null;
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

    if (linkProvided) {
      if (currentRes.error) {
        return NextResponse.json({ error: toHebrewError(currentRes.error.message) }, { status: 400 });
      }
      if (!current) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const currentBusinessDomain = isExpenseBusinessDomain(
        typeof current.business_domain === "string" ? current.business_domain : null
      )
        ? (current.business_domain as string)
        : null;
      const currentProjectId = normalizeId(current.project_id);
      const currentPropertyId = normalizeId(current.property_id);

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

    let data: Record<string, unknown> | null = null;
    if (Object.keys(update).length > 0) {
      const result = await supabase
        .from("tasks")
        .update(update)
        .eq("id", id)
        .select(
          "id,business_domain,project_id,property_id,customer_id,assigned_user_id,subject,description,subject_he,description_he,due_date,due_time,city,address,priority,status,created_at,updated_at"
        )
        .maybeSingle();
      if (result.error) {
        return NextResponse.json({ error: normalizeTaskWriteError(result.error.message) }, { status: 400 });
      }
      data = result.data as Record<string, unknown> | null;
    }

    // Members and tags don't depend on each other — written together. Members
    // are diffed against what's there: only the removed rows are deleted and
    // only the new ones inserted, and an unchanged list costs nothing (it used
    // to delete and re-insert every member on every save). The primary assignee
    // is never stored as a duplicate collaborator row.
    const taskRow = data ?? current;
    const [membersError] = await Promise.all([
      (async (): Promise<string | null> => {
        if (!membersProvided) return null;
        const assignedUserId =
          typeof taskRow?.assigned_user_id === "string" ? taskRow.assigned_user_id : null;
        const memberIds = [
          ...new Set(
            (body.member_ids ?? []).filter(
              (memberId): memberId is string => typeof memberId === "string" && Boolean(memberId.trim())
            )
          ),
        ].filter((memberId) => memberId !== assignedUserId);
        const existingIds = new Set(
          ((existingMembersRes.data ?? []) as Array<{ user_id?: string | null }>)
            .map((m) => m.user_id)
            .filter((v): v is string => Boolean(v))
        );
        const removed = [...existingIds].filter((m) => !memberIds.includes(m));
        const added = memberIds.filter((m) => !existingIds.has(m));
        const [deleteRes, insertRes] = await Promise.all([
          removed.length > 0
            ? supabase.from("task_members").delete().eq("task_id", id).in("user_id", removed)
            : null,
          added.length > 0
            ? supabase.from("task_members").insert(added.map((userId) => ({ task_id: id, user_id: userId })))
            : null,
        ]);
        const error = deleteRes?.error ?? insertRes?.error;
        if (error) return toHebrewError(error.message);

        // Alert members just added to the task (not already on it, not the editor).
        const addedMembers = added.filter((m) => m !== profile.id);
        if (addedMembers.length > 0) {
          const subject = typeof taskRow?.subject === "string" ? taskRow.subject : "משימה";
          runAfterResponse("tasks/update notify members", () => notifyTaskAssignees(id, subject, addedMembers));
        }
        return null;
      })(),
      tagsProvided
        ? syncEntityTags(supabase, "task", id, parseTagIds(body.tag_ids), {
            replace: true,
            createdBy: profile.id,
          })
        : null,
    ]);
    if (membersError) {
      return NextResponse.json({ error: membersError }, { status: 400 });
    }

    if (id) {
      logAuditEventAfterResponse({
        supabase,
        tableName: "tasks",
        recordId: id,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    // Reassigned to a NEW person (not the one who made the change) → alert them.
    // Only when this save actually set the assignee: an autosave of some other
    // field doesn't carry it, and the row's unchanged assignee must not be
    // re-alerted for every edit.
    const newAssignee =
      "assigned_user_id" in body && typeof data?.assigned_user_id === "string" ? data.assigned_user_id : null;
    if (newAssignee && newAssignee !== previousAssignee && newAssignee !== profile.id) {
      const subject = typeof data?.subject === "string" ? data.subject : "משימה";
      runAfterResponse("tasks/update notify assignee", () => notifyTaskAssignees(id, subject, [newAssignee]));
    }

    return NextResponse.json({ task: data });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
