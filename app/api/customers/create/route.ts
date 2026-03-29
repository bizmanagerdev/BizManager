import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type CreateCustomerPayload = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  registration_number?: string | null;
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateCustomerPayload;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const registrationNumber =
      typeof body.registration_number === "string"
        ? body.registration_number.trim()
        : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    if (!name) {
      return NextResponse.json({ error: "שם לקוח הוא שדה חובה." }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: "אימייל לקוח הוא שדה חובה עבור קבלה." }, { status: 400 });
    }
    if (!city) {
      return NextResponse.json({ error: "עיר היא שדה חובה לתיאום משלוחים." }, { status: 400 });
    }
    if (!address) {
      return NextResponse.json({ error: "כתובת היא שדה חובה לתיאום משלוחים." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const fullAddress = `${city} | ${address}`;

    const { data, error } = await supabase
      .from("customers")
      .insert({
        name,
        name_for_invoice: name,
        registration_number: registrationNumber,
        phone,
        email,
        address: fullAddress,
        active: true,
        notes,
      })
      .select("id,name,name_for_invoice,registration_number,phone,email,address,active,notes")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: `יצירת לקוח נכשלה: ${error.message}` }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "לקוח לא נוצר בהצלחה." }, { status: 500 });
    }

    return NextResponse.json({ customer: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
