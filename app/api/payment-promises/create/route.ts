import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";

// Record a payment promise (הבטחת תשלום) — "customer promised ₪X by date Y".
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "payment-promises/create", async () => {
      const body = (await req.json()) as {
        customer_id?: string | null;
        order_id?: string | null;
        project_id?: string | null;
        amount?: number | string;
        promised_date?: string;
        notes?: string;
      };

      const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
      const promisedDate = typeof body.promised_date === "string" ? body.promised_date.trim() : "";
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: "סכום ההבטחה אינו תקין." }, { status: 400 });
      }
      if (!promisedDate) {
        return NextResponse.json({ error: "יש לבחור תאריך הבטחה." }, { status: 400 });
      }

      const nullable = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

      const { data, error } = await supabase
        .from("payment_promises")
        .insert({
          customer_id: nullable(body.customer_id),
          order_id: nullable(body.order_id),
          project_id: nullable(body.project_id),
          amount,
          promised_date: promisedDate,
          notes: nullable(body.notes),
          created_by: profile.id,
          updated_by: profile.id,
        })
        .select("id")
        .maybeSingle();

      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      return NextResponse.json({ ok: true, id: data?.id ?? null });
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
