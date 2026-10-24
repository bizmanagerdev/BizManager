import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { deleteLease } from "@/app/(app)/properties/actions";

// A lease deleted from the property page through the send queue, so it deletes with no signal too (owner,
// 2026-10-24). One already gone is done.

export async function POST(req: Request) {
  const access = await requireRouteAccess({
    allowedRoles: ["admin", "office"],
  });
  if (!access.ok) return access.response;

  const body = (await req.json().catch(() => ({}))) as {
    property_id?: unknown;
    id?: unknown;
  };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id)
    return NextResponse.json({ error: "חסר מזהה חוזה." }, { status: 400 });
  const propertyId =
    typeof body.property_id === "string" ? body.property_id.trim() : "";

  const result = await deleteLease(propertyId, id);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
