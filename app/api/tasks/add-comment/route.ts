import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { task_id?: string; message?: string };
    const taskId = typeof body.task_id === "string" ? body.task_id : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!taskId || !message) {
      return NextResponse.json(
        { error: "Missing task_id or message" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseRouteClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 400 });
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("users")
      .select("full_name,email")
      .eq("id", user.id)
      .maybeSingle();

    const author = (profile as any)?.full_name || (profile as any)?.email || user.email || "user";
    const stamp = new Date().toISOString();
    const entry = `[${stamp}] ${author}: ${message}`;

    const { data: current, error: readError } = await supabase
      .from("tasks")
      .select("id,notes")
      .eq("id", taskId)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ error: readError.message }, { status: 400 });
    }

    const existing = (current as any)?.notes as string | null | undefined;
    const nextNotes = existing && existing.trim() ? `${existing}\n\n${entry}` : entry;

    const { error: updateError } = await supabase
      .from("tasks")
      .update({ notes: nextNotes })
      .eq("id", taskId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

