import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const body = (await req.json()) as { task_id?: string; message?: string };
    const taskId = typeof body.task_id === "string" ? body.task_id : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!taskId || !message) {
      return NextResponse.json({ error: "Missing task_id or message" }, { status: 400 });
    }

    const author = user.email ?? "user";
    const stamp = new Date().toISOString();
    const entry = `[${stamp}] ${author}: ${message}`;

    const { data: current, error: readError } = await supabase
      .from("tasks")
      .select("id,notes")
      .eq("id", taskId)
      .maybeSingle();

    if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });

    const existing = typeof current?.notes === "string" ? current.notes : null;
    const nextNotes = existing && existing.trim() ? `${existing}\n\n${entry}` : entry;

    const { error: updateError } = await supabase.from("tasks").update({ notes: nextNotes }).eq("id", taskId);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
