import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import { toHebrewError } from "@/lib/error-messages";

// Send a password-reset email, server-side.
//
// Same reason as /api/profile/password: calling GoTrue straight from the page
// was failing in the real browser ("Could not parse request body as JSON") —
// something client-side mangles the cross-origin request. Our own origin is
// immune to that, and real failures land in our logs.
//
// No session needed: resetPasswordForEmail works on the anon key. The redirect
// target is built from THIS request's origin, so it always points back at the
// host the user is actually on — and can't be pointed elsewhere by the caller.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email) {
      return NextResponse.json({ error: "יש להזין כתובת אימייל." }, { status: 400 });
    }

    const supabase = await createSupabaseRouteClient();
    const origin = new URL(req.url).origin;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    });

    if (error) {
      const hebrew = toHebrewError(error.message, "");
      return NextResponse.json({ error: hebrew || `שליחת הקישור נכשלה: ${error.message}` }, { status: 400 });
    }

    // Deliberately the same answer whether or not the address exists — otherwise
    // this endpoint tells strangers which emails have accounts.
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "שליחת הקישור נכשלה.") }, { status: 500 });
  }
}
