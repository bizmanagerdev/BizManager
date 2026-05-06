import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { MorningDocumentType } from "@/lib/morning/types";
import { issueMorningDocumentForSource, morningDocumentInputSchema } from "@/lib/morning/service";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const parsed = morningDocumentInputSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "נתוני החשבונית אינם תקינים." }, { status: 400 });
    }

    const { supabase, user, profile } = access.value;
    const result = await issueMorningDocumentForSource(supabase, {
      type: MorningDocumentType.TaxInvoice,
      customerId: parsed.data.customerId,
      orderId: parsed.data.orderId,
      projectId: parsed.data.projectId,
      notes: parsed.data.notes,
      customLines: parsed.data.customLines,
      allowDuplicate: parsed.data.allowDuplicate && profile.role === "admin",
      actor: { profileId: profile.id, authUserId: user.id, role: profile.role },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "יצירת חשבונית מס ב-Morning נכשלה.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
