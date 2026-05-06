import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { matchMorningCustomer } from "@/lib/morning/service";

const querySchema = z.object({
  customerId: z.string().uuid(),
});

export async function GET(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({ customerId: url.searchParams.get("customerId") });
    if (!parsed.success) {
      return NextResponse.json({ error: "מזהה לקוח לא תקין." }, { status: 400 });
    }

    const result = await matchMorningCustomer(access.value.supabase, parsed.data.customerId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "בדיקת התאמות לקוח ב-Morning נכשלה.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
