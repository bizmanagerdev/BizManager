import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { ensureMorningClientForCustomer } from "@/lib/morning/service";

const payloadSchema = z.object({
  customerId: z.string().uuid(),
});

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const parsed = payloadSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "מזהה לקוח לא תקין." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    const client = await ensureMorningClientForCustomer(supabase, parsed.data.customerId, {
      profileId: profile.id,
      role: profile.role,
    });

    return NextResponse.json({ morningClient: client });
  } catch (error) {
    const message = toHebrewError(error, "סנכרון פרטי חיוב ל-Morning נכשל.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
