import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Status-only update. /api/projects/update writes the whole row, so changing a
// status through it would need every other field along for the ride — this is
// what the status picker on the project page posts to.

const ALLOWED_STATUSES = new Set([
  "quote",
  "planned",
  "active",
  "on_hold",
  "completed",
  "cancelled",
]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { project_id?: string; status?: string };

    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    const status = typeof body.status === "string" ? body.status : "";

    if (!projectId) return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("projects")
      .update({ status })
      .eq("id", projectId)
      .select("id,status,updated_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    return NextResponse.json({ project: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
