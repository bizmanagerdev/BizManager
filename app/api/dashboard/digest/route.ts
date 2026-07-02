import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getDigestAnchor, getMissedDigest } from "@/lib/audit";

// GET — the admin/office viewer's "what happened since you were last here" feed.
// Role-filtered inside getMissedDigest; own actions excluded.
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, user, profile } = access.value;
  if (profile.role !== "admin" && profile.role !== "office") {
    return NextResponse.json({ items: [] });
  }

  const sinceIso = await getDigestAnchor(supabase, profile.id);
  const { items } = await getMissedDigest(supabase, {
    sinceIso,
    viewerRole: profile.role,
    // changed_by mixes users.id (app) and auth uid (trigger) — exclude both.
    excludeActorIds: [profile.id, user.id],
  });
  return NextResponse.json({ items });
}
