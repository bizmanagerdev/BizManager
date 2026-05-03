import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

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

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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
    return NextResponse.json({ task: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
