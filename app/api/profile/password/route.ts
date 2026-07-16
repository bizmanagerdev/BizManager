import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import { toHebrewError } from "@/lib/error-messages";

// Change your own password, server-side.
//
// Why not call supabase.auth.updateUser() straight from the browser (as the
// reset-password screen does)? That fires a cross-origin request to GoTrue from
// the page, and in the wild something there was mangling the body — GoTrue replied
// "Could not parse request body as JSON: invalid character 'P'", i.e. it never
// received our JSON at all. Going through our own origin removes that whole class
// of interference (extensions, SW, proxies) and, when it does fail, the real
// reason lands in OUR logs instead of a toast.
//
// Safety: the route client is bound to the caller's session cookies, so
// updateUser can only ever change the password of whoever is signed in.
export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseRouteClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "החיבור פג. יש להתחבר מחדש ולנסות שוב." }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 6) {
      return NextResponse.json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים." }, { status: 400 });
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      // Keep the original text when we have no Hebrew rule for it — an
      // untranslated reason beats a dead-end "failed".
      const hebrew = toHebrewError(error.message, "");
      return NextResponse.json({ error: hebrew || `שינוי הסיסמה נכשל: ${error.message}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "שינוי הסיסמה נכשל.") }, { status: 500 });
  }
}
