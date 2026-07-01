import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";

type CreateCustomerPayload = {
  name?: string;
  name_for_invoice?: string | null;
  registration_number?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  requires_prepayment?: boolean;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    return await withIdempotency(req, supabase, user.id, "customers/create", async () => {
    const body = (await req.json()) as CreateCustomerPayload;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const whatsapp = typeof body.whatsapp === "string" ? body.whatsapp.trim() : null;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const nameForInvoice =
      typeof body.name_for_invoice === "string" && body.name_for_invoice.trim()
        ? body.name_for_invoice.trim()
        : null;
    const registrationNumber =
      typeof body.registration_number === "string"
        ? body.registration_number.trim()
        : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const requiresPrepayment = body.requires_prepayment === true;

    if (!name) {
      return NextResponse.json({ error: "שם לקוח הוא שדה חובה." }, { status: 400 });
    }
    if (!city) {
      return NextResponse.json({ error: "עיר היא שדה חובה לתיאום משלוחים." }, { status: 400 });
    }
    const fullAddress = address ? `${city} | ${address}` : city;

    const { data, error } = await supabase
      .from("customers")
      .insert({
        name,
        name_for_invoice: nameForInvoice ?? name,
        registration_number: registrationNumber,
        phone,
        whatsapp,
        city,
        email: email || null,
        address: fullAddress || null,
        active: true,
        notes,
        requires_prepayment: requiresPrepayment,
      })
      .select("id,name,name_for_invoice,registration_number,phone,whatsapp,email,address,active,notes,requires_prepayment")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: `יצירת לקוח נכשלה: ${error.message}` }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "לקוח לא נוצר בהצלחה." }, { status: 500 });
    }

    return NextResponse.json({ customer: data });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא ידועה");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
