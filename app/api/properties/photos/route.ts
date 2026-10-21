import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadPropertyPhotos } from "@/lib/properties";
import { toHebrewError } from "@/lib/error-messages";

/**
 * Each property's photo for the list's cards, with a signed link (an hour) —
 * asked for after the list is on screen, so the list (from the device copy
 * too) never waits for it.
 */
export async function GET() {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;
  try {
    const photos = await loadPropertyPhotos(access.value.supabase);
    // Kept a few minutes by the browser — the links last an hour.
    return NextResponse.json({ photos }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (error) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת התמונות נכשלה.") }, { status: 500 });
  }
}
