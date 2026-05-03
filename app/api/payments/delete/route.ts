import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      project_id?: string | null;
    };

    const paymentId = typeof body.id === "string" ? body.id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";

    if (!paymentId || !projectId) {
      return NextResponse.json({ error: "Missing id or project_id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: paymentRow, error: paymentReadError } = await supabase
      .from("payments")
      .select("id,project_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (paymentReadError) {
      return NextResponse.json({ error: paymentReadError.message }, { status: 400 });
    }
    if (!paymentRow?.id || paymentRow.project_id !== projectId) {
      return NextResponse.json({ error: "Payment not found for project" }, { status: 404 });
    }

    const { error: paymentDeleteError } = await supabase
      .from("payments")
      .delete()
      .eq("id", paymentId)
      .eq("project_id", projectId);

    if (paymentDeleteError) {
      return NextResponse.json({ error: paymentDeleteError.message }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "payments",
      recordId: paymentId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
