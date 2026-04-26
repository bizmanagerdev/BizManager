import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { WORK_SESSIONS_TABLE } from "@/lib/payroll";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as {
      session_id?: string | null;
      project_id?: string | null;
    };

    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    const { supabase } = access.value;

    const { data: session, error: sessionError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,project_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 400 });
    }
    if (!session?.id) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (projectId && session.project_id !== projectId) {
      return NextResponse.json({ error: "Session not found for project" }, { status: 404 });
    }

    const { error } = await supabase.from(WORK_SESSIONS_TABLE).delete().eq("id", sessionId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
