import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Edit a logged contact (channel / direction / content).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      channel?: string;
      direction?: string;
      content?: string | null;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const update: Record<string, unknown> = {};
    if (typeof body.channel === "string" && body.channel.trim()) update.channel = body.channel.trim();
    if (body.direction === "incoming" || body.direction === "outgoing") update.direction = body.direction;
    if (body.content !== undefined) {
      update.content =
        typeof body.content === "string" && body.content.trim() ? body.content.trim() : null;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error } = await supabase.from("communication_logs").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
