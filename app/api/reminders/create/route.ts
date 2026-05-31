import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Create a follow-up reminder (תזכורת).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      customer_id?: string | null;
      remind_at?: string;
      content?: string;
      action_type?: string;
      category?: string;
      assigned_to?: string | null;
      order_id?: string | null;
      project_id?: string | null;
      property_id?: string | null;
      payment_id?: string | null;
    };

    const remindAt = typeof body.remind_at === "string" ? body.remind_at.trim() : "";
    if (!remindAt) {
      return NextResponse.json({ error: "Missing remind_at" }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const nullable = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    const { data: reminder, error } = await supabase
      .from("reminders")
      .insert({
        customer_id: nullable(body.customer_id),
        remind_at: remindAt,
        content: nullable(body.content),
        action_type: nullable(body.action_type) ?? "call",
        category: nullable(body.category) ?? "collection",
        assigned_to: nullable(body.assigned_to) ?? profile.id,
        order_id: nullable(body.order_id),
        project_id: nullable(body.project_id),
        property_id: nullable(body.property_id),
        payment_id: nullable(body.payment_id),
        created_by: profile.id,
        updated_by: profile.id,
      })
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: reminder?.id ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
