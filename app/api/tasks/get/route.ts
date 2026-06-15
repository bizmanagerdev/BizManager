import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";

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
    const { supabase } = access.value;

    const { data: task, error } = await supabase
      .from("tasks")
      .select(
        "id,business_domain,project_id,property_id,assigned_user_id,subject,description,due_date,due_time,city,address,priority,status,created_at,updated_at,notes"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!task) return NextResponse.json({ task: null });

    const [membersRes, commentsRes, remindersRes] = await Promise.all([
      supabase.from("task_members").select("user_id").eq("task_id", id),
      supabase
        .from("task_comments")
        .select("id,author_id,body,created_at,updated_at")
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

    return NextResponse.json({ task, members, comments, reminders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
