import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";

// Create a follow-up reminder (תזכורת).
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "reminders/create", async () => {
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
      task_id?: string | null;
      vehicle_id?: string | null;
      invoice_id?: string | null;
      expense_id?: string | null;
    };

    const remindAt = typeof body.remind_at === "string" ? body.remind_at.trim() : "";
    if (!remindAt) {
      return NextResponse.json({ error: "Missing remind_at" }, { status: 400 });
    }

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
        task_id: nullable(body.task_id),
        vehicle_id: nullable(body.vehicle_id),
        invoice_id: nullable(body.invoice_id),
        expense_id: nullable(body.expense_id),
        created_by: profile.id,
        updated_by: profile.id,
      })
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    return NextResponse.json({ ok: true, id: reminder?.id ?? null });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
