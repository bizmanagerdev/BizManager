import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { createLocalCustomerFromMorningClient } from "@/lib/morning/service";

const payloadSchema = z.object({
  morningClientId: z.string().trim().min(1),
});

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const parsed = payloadSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "מזהה לקוח Morning לא תקין." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    const customer = await createLocalCustomerFromMorningClient(supabase, {
      morningClientId: parsed.data.morningClientId,
      actor: { profileId: profile.id, role: profile.role },
    });
    return NextResponse.json({ customer });
  } catch (error) {
    const message = toHebrewError(error, "יצירת לקוח מקומי מ-Morning נכשלה.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
