import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      target_type?: string;
      target_id?: string;
      payment_date?: string | null;
      amount_total?: number | string;
      payment_method?: string;
      reference_number?: string;
      vat_amount?: number | string | null;
      notes?: string;
    };

    const targetType =
      typeof body.target_type === "string" ? body.target_type : "";
    const targetId = typeof body.target_id === "string" ? body.target_id : "";
    const paymentDate =
      typeof body.payment_date === "string" ? body.payment_date : null;
    const paymentMethod =
      typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    const referenceNumber =
      typeof body.reference_number === "string"
        ? body.reference_number.trim()
        : null;
    const vatAmountNumber =
      body.vat_amount === null || body.vat_amount === undefined
        ? null
        : typeof body.vat_amount === "number"
          ? body.vat_amount
          : typeof body.vat_amount === "string"
            ? Number(body.vat_amount)
            : NaN;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    const amountNumber =
      typeof body.amount_total === "number"
        ? body.amount_total
        : typeof body.amount_total === "string"
          ? Number(body.amount_total)
          : NaN;

    if (!targetType || !targetId || !Number.isFinite(amountNumber)) {
      return NextResponse.json(
        { error: "Missing target_type, target_id, or amount_total" },
        { status: 400 }
      );
    }
    if (!paymentDate || !paymentMethod) {
      return NextResponse.json(
        { error: "Missing payment_date or payment_method" },
        { status: 400 }
      );
    }

    // Most project payments are recorded without VAT in this app.
    // The table has NOT NULL constraints on the VAT breakdown columns, so we always populate them.
    const vatAmount =
      vatAmountNumber === null ? 0 : Number.isFinite(vatAmountNumber) ? vatAmountNumber : 0;
    const amountBeforeVat = amountNumber;
    const netAmount = amountNumber;

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

    const { data, error } = await supabase
      .from("payments")
      .insert({
        target_type: targetType,
        target_id: targetId,
        payment_date: paymentDate,
        amount_total: amountNumber,
        payment_method: paymentMethod || null,
        reference_number: referenceNumber,
        vat_amount: vatAmount,
        amount_before_vat: amountBeforeVat,
        net_amount: netAmount,
        notes,
        recorded_by: user.id,
      })
      .select(
        "id,target_type,target_id,payment_date,amount_total,payment_method,reference_number,vat_amount,amount_before_vat,net_amount,recorded_by,notes,created_at,updated_at"
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ payment: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
