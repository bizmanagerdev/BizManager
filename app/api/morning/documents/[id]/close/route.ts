import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { closeMorningDocumentByLocalId } from "@/lib/morning/service";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { id } = await context.params;
    const { supabase, profile } = access.value;
    const document = await closeMorningDocumentByLocalId(supabase, {
      localDocumentId: id,
      actor: { profileId: profile.id, role: profile.role },
    });
    return NextResponse.json({ document });
  } catch (error) {
    const message = toHebrewError(error, "סגירת מסמך Morning נכשלה.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
