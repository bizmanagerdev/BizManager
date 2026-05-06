import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { syncMorningDocumentByLocalId } from "@/lib/morning/service";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { id } = await context.params;
    const { supabase, profile } = access.value;
    const document = await syncMorningDocumentByLocalId(supabase, {
      localDocumentId: id,
      actor: { profileId: profile.id, role: profile.role },
    });
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "סנכרון מסמך Morning נכשל.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
