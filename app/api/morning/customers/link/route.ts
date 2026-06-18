import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { linkMorningClientToCustomer } from "@/lib/morning/service";

const payloadSchema = z.object({
  customerId: z.string().uuid(),
  morningClientId: z.string().trim().min(1),
});

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const parsed = payloadSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "פרטי הקישור ל-Morning אינם תקינים." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    const result = await linkMorningClientToCustomer(supabase, {
      customerId: parsed.data.customerId,
      morningClientId: parsed.data.morningClientId,
      actor: { profileId: profile.id, role: profile.role },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = toHebrewError(error, "קישור לקוח ל-Morning נכשל.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
