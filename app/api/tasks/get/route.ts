import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getEntityAuditTrail, resolveUserDisplayNamesForValues } from "@/lib/audit";
import { translateToArabic } from "@/lib/i18n/translateToHebrew";
import { runAfterResponse } from "@/lib/after-response";

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v ? v : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string };
    const id = typeof body.id === "string" ? body.id : "";

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    // "What changed and who changed it" — reuses the same audit_logs trail the
    // /activity page reads. Best-effort: audit_logs is admin/office-only by RLS,
    // so a worker would only ever get an empty list — skip the lookup for them.
    // It keys off the id alone, so it runs with the first round below instead of
    // after everything else.
    const isWorker = profile.role === "worker" || profile.role === "worker_no_access";
    const historyPromise = isWorker
      ? Promise.resolve([] as Array<{ id: string; actor_name: string | null; created_at: string | null; action_label: string; details: string }>)
      : getEntityAuditTrail(supabase, [{ tableName: "tasks", recordId: id }], 30)
          .then((trail) =>
            trail.items.map((item) => ({
              id: item.id,
              actor_name: item.actorName,
              created_at: item.createdAt,
              action_label: item.actionLabel,
              details: item.details,
            }))
          )
          // Non-fatal — the rest of the card works without a history list.
          .catch(() => []);

    // Fetch the task alongside its members/comments/reminders in one round-trip —
    // none of the sub-queries depend on the task row (they all key off the id).
    const [taskRes, membersRes, commentsRes, remindersRes] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id,business_domain,project_id,property_id,customer_id,assigned_user_id,subject,description,subject_he,description_he,subject_ar,description_ar,due_date,due_time,city,address,priority,status,created_at,updated_at,notes,is_private,private_owner_id"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("task_members").select("user_id").eq("task_id", id),
      supabase
        .from("task_comments")
        .select("id,author_id,body,body_he,created_at,updated_at")
        .eq("task_id", id)
        .order("created_at", { ascending: true })
        .range(0, 199),
      supabase
        .from("reminders")
        .select("id,remind_at,content,action_type,status,assigned_to,created_at")
        .eq("task_id", id)
        .order("remind_at", { ascending: true })
        .range(0, 99),
    ]);

    const task = taskRes.data as Row | null;
    if (taskRes.error) return NextResponse.json({ error: toHebrewError(taskRes.error.message) }, { status: 400 });
    if (!task) return NextResponse.json({ task: null });

    // An Arabic-locale viewer opening a task NOT authored by an Arabic worker
    // (subject_he unset — see app/api/tasks/create) gets subject/description
    // translated here and cached back onto the row, mirroring loadTasksBoard's
    // board-level version of the same lazy-translate-and-cache pattern.
    // Both translations run at once, and caching them onto the row happens after
    // the response — the viewer is waiting on the text, not on that write.
    if (profile.locale === "ar") {
      const needsSubject = !str(task, "subject_he") && !str(task, "subject_ar") && Boolean(str(task, "subject"));
      const needsDescription =
        !str(task, "description_he") && !str(task, "description_ar") && Boolean(str(task, "description"));
      const [subjectAr, descriptionAr] = await Promise.all([
        needsSubject ? translateToArabic(str(task, "subject") ?? "") : Promise.resolve(null),
        needsDescription ? translateToArabic(str(task, "description") ?? "") : Promise.resolve(null),
      ]);
      const updates: Record<string, string> = {};
      if (subjectAr) {
        task.subject_ar = subjectAr;
        updates.subject_ar = subjectAr;
      }
      if (descriptionAr) {
        task.description_ar = descriptionAr;
        updates.description_ar = descriptionAr;
      }
      if (Object.keys(updates).length > 0) {
        runAfterResponse("tasks/get Arabic translation cache", async () => {
          await supabase.from("tasks").update(updates).eq("id", id);
        });
      }
    }

    const memberIds = ((membersRes.data ?? []) as Row[])
      .map((r) => str(r, "user_id"))
      .filter((v): v is string => Boolean(v));
    const commentRows = (commentsRes.data ?? []) as Row[];
    const reminderRows = (remindersRes.data ?? []) as Row[];

    const nameIds = [
      ...memberIds,
      ...commentRows.map((r) => str(r, "author_id")),
      ...reminderRows.map((r) => str(r, "assigned_to")),
    ].filter((v): v is string => Boolean(v));
    const names = await resolveUserDisplayNamesForValues(supabase, nameIds);

    const members = memberIds.map((userId) => ({ id: userId, label: names[userId] ?? "" }));
    const comments = commentRows.map((r) => ({
      id: str(r, "id") ?? "",
      author_id: str(r, "author_id"),
      author_name: names[str(r, "author_id") ?? ""] ?? null,
      body: str(r, "body") ?? "",
      body_he: str(r, "body_he"),
      created_at: str(r, "created_at") ?? "",
    }));
    const reminders = reminderRows.map((r) => ({
      id: str(r, "id") ?? "",
      remind_at: str(r, "remind_at") ?? "",
      content: str(r, "content"),
      action_type: str(r, "action_type") ?? "other",
      status: str(r, "status") ?? "pending",
      assigned_to: str(r, "assigned_to"),
      assigned_to_name: names[str(r, "assigned_to") ?? ""] ?? null,
    }));

    // Only the creator/owner may toggle privacy. Tell the client so it can gate the UI.
    const owner = str(task as Row, "private_owner_id");
    const viewerIsCreator = Boolean(owner) && owner === profile.id;

    const history = await historyPromise;

    return NextResponse.json({ task, members, comments, reminders, history, viewer_is_creator: viewerIsCreator });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
