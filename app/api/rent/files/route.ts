import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadPaymentFiles } from "@/lib/properties";
import { toHebrewError } from "@/lib/error-messages";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A month's rent payments — a few dozen at most. */
const MAX_IDS = 300;

/**
 * The rent roll's check photos (and any other file on its payments), with
 * signed links (an hour) — asked for after the roll is on screen, so the roll
 * (from the device copy too) never waits for them. ?ids=<payment id>,…
 */
export async function GET(request: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => UUID.test(id))
    .slice(0, MAX_IDS);
  try {
    const files = await loadPaymentFiles(access.value.supabase, ids);
    // Kept a few minutes by the browser — the links last an hour.
    return NextResponse.json({ files }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (error) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת הקבצים נכשלה.") }, { status: 500 });
  }
}
