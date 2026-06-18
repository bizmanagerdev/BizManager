import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; priority?: string };
    const id = typeof body.id === "string" ? body.id : "";
    const priority = typeof body.priority === "string" ? body.priority : "";

    if (!id || !priority) {
      return NextResponse.json({ error: "Missing id or priority" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data, error } = await supabase
      .from("tasks")
      .update({ priority })
      .eq("id", id)
      .select("id,priority,updated_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    if (data?.id) {
      await logAuditEvent({
        supabase,
        tableName: "tasks",
        recordId: data.id,
        action: "priority_changed",
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
