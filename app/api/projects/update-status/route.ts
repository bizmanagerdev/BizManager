import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { PROJECT_STATUSES } from "@/lib/projects/project-input";

// A project's status, and nothing else — what the status picker changes. The
// picker writes it straight to the table when saving on the server; a change
// made on the phone first (lib/powersync/local-writes.ts) comes here from the
// queue. The same RLS-bound write either way: only admin and office may
// update projects (no worker UPDATE policy exists), and `status` is a
// Postgres enum, so the database itself rejects anything else.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: unknown; status?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!id) return NextResponse.json({ error: "Missing project id" }, { status: 400 });
    if (!PROJECT_STATUSES.includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase.from("projects").update({ status }).eq("id", id).select("id");
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "הפרויקט לא נמצא או שאין הרשאה לעדכן אותו." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
