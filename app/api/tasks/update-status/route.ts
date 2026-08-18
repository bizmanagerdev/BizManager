import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

/** Statuses that end a task — and with it, any reminder still pointing at it. */
const CLOSED_TASK_STATUSES = new Set(["done", "cancelled"]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; status?: string };
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";

    if (!id || !status) {
      return NextResponse.json({ error: "Missing id or status" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data, error } = await supabase
      .from("tasks")
      .update({ status })
      .eq("id", id)
      .select("id,status,updated_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    // A reminder to do a task you've just done is noise, and it outlived the
    // task everywhere the two are listed side by side: the dashboard's "היום"
    // card and the calendar both read reminders straight from the table, so
    // ticking the task left its own reminder sitting there.
    //
    // Best-effort and NOT a reason to fail the request: the status change is
    // what the caller asked for, and RLS decides which of the task's reminders
    // this user may close (someone else's reminder about the same task is
    // theirs to clear). Closing only PENDING ones keeps a reminder that was
    // already cancelled from being rewritten as done.
    let closedReminders = 0;
    if (data?.id && CLOSED_TASK_STATUSES.has(status)) {
      const { data: closed } = await supabase
        .from("reminders")
        .update({ status: "done", updated_by: profile.id })
        .eq("task_id", id)
        .eq("status", "pending")
        .select("id");
      closedReminders = closed?.length ?? 0;
    }

    if (data?.id) {
      await logAuditEvent({
        supabase,
        tableName: "tasks",
        recordId: data.id,
        action: "status_changed",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }
    return NextResponse.json({ task: data, closedReminders });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
