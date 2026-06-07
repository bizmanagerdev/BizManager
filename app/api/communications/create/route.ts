import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Log a contact with a customer (תיעוד פניות). Optionally create a linked
// follow-up reminder in the same step.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      customer_id?: string;
      channel?: string;
      direction?: string;
      content?: string;
      category?: string;
      order_id?: string | null;
      project_id?: string | null;
      property_id?: string | null;
      payment_id?: string | null;
      follow_up?: { remind_at?: string; content?: string; action_type?: string; assigned_to?: string | null } | null;
    };

    const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : "";
    if (!customerId) {
      return NextResponse.json({ error: "Missing customer_id" }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const nullable = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    const { data: log, error: logError } = await supabase
      .from("communication_logs")
      .insert({
        customer_id: customerId,
        user_id: profile.id,
        channel: nullable(body.channel) ?? "phone",
        direction: body.direction === "incoming" ? "incoming" : "outgoing",
        content: nullable(body.content),
        category: nullable(body.category) ?? "collection",
        order_id: nullable(body.order_id),
        project_id: nullable(body.project_id),
        property_id: nullable(body.property_id),
        payment_id: nullable(body.payment_id),
        created_by: profile.id,
      })
      .select("id")
      .maybeSingle();

    if (logError) return NextResponse.json({ error: logError.message }, { status: 400 });

    // Optional follow-up reminder linked to this log.
    let reminderId: string | null = null;
    const followUp = body.follow_up;
    if (followUp && typeof followUp.remind_at === "string" && followUp.remind_at.trim()) {
      const { data: reminder, error: reminderError } = await supabase
        .from("reminders")
        .insert({
          customer_id: customerId,
          assigned_to: nullable(followUp.assigned_to) ?? profile.id,
          remind_at: followUp.remind_at.trim(),
          content: nullable(followUp.content),
          action_type: nullable(followUp.action_type) ?? "call",
          category: nullable(body.category) ?? "collection",
          order_id: nullable(body.order_id),
          project_id: nullable(body.project_id),
          property_id: nullable(body.property_id),
          payment_id: nullable(body.payment_id),
          communication_log_id: log?.id ?? null,
          created_by: profile.id,
          updated_by: profile.id,
        })
        .select("id")
        .maybeSingle();
      if (reminderError) return NextResponse.json({ error: reminderError.message }, { status: 400 });
      reminderId = reminder?.id ?? null;
    }

    return NextResponse.json({ ok: true, id: log?.id ?? null, reminder_id: reminderId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
