import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { MorningDocumentType } from "@/lib/morning/types";
import { issueMorningReceiptForPayment, paymentDocumentInputSchema } from "@/lib/morning/service";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const parsed = paymentDocumentInputSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "נתוני הקבלה אינם תקינים." }, { status: 400 });
    }

    const { supabase, user, profile } = access.value;
    const result = await issueMorningReceiptForPayment(supabase, {
      paymentId: parsed.data.paymentId,
      type: MorningDocumentType.Receipt,
      allowDuplicate: parsed.data.allowDuplicate && profile.role === "admin",
      actor: { profileId: profile.id, authUserId: user.id, role: profile.role },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = toHebrewError(error, "יצירת קבלה ב-Morning נכשלה.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
