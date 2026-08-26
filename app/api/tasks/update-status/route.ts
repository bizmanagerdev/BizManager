import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

/** Statuses that end a task — and with it, any reminder still pointing at it. */
const CLOSED_TASK_STATUSES = new Set(["done", "cancelled"]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; status?: string; sort_order?: number };
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    // Optional: a drag can move a card AND place it at a specific position within
    // its (possibly new) column in one write — computed client-side via
    // lib/tasks/sortOrder.ts's fractional indexing.
    const sortOrder = typeof body.sort_order === "number" && Number.isFinite(body.sort_order) ? body.sort_order : null;

    if (!id || !status) {
      return NextResponse.json({ error: "Missing id or status" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: current } = await supabase.from("tasks").select("status").eq("id", id).maybeSingle();
    const priorStatus = typeof current?.status === "string" ? current.status : null;
    const statusChanged = priorStatus !== null && priorStatus !== status;

    let data: Record<string, unknown> | null = null;
    let writeError: { message: string } | null = null;

    if (!statusChanged && sortOrder !== null) {
      // Pure reorder within the same column — routed through a helper that opts
      // this write out of the audit log (see migration
      // add_tasks_sort_order.sql), so dragging a card doesn't spam its history
      // with content-free "עודכן" rows.
      const rpc = await supabase.rpc("set_task_sort_order", { p_task_id: id, p_sort_order: sortOrder });
      writeError = rpc.error;
      if (!writeError) {
        const reselect = await supabase
          .from("tasks")
          .select("id,status,sort_order,updated_at")
          .eq("id", id)
          .maybeSingle();
        data = reselect.data as Record<string, unknown> | null;
      }
    } else {
      const update: Record<string, unknown> = { status };
      if (sortOrder !== null) update.sort_order = sortOrder;
      const result = await supabase
        .from("tasks")
        .update(update)
        .eq("id", id)
        .select("id,status,sort_order,updated_at")
        .maybeSingle();
      writeError = result.error;
      data = result.data as Record<string, unknown> | null;
    }

    if (writeError) return NextResponse.json({ error: toHebrewError(writeError.message) }, { status: 400 });

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

    if (data?.id && statusChanged) {
      await logAuditEvent({
        supabase,
        tableName: "tasks",
        recordId: id,
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
