import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { importMatchMorningClients } from "@/lib/morning/service";

export async function GET() {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const result = await importMatchMorningClients(access.value.supabase);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ייבוא/התאמת לקוחות Morning נכשל.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
