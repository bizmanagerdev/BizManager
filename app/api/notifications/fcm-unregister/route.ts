import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Remove a native FCM token (device notifications turned off, or logout).
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const body = (await req.json()) as { token?: string };

  if (!body.token) {
    // No token given — remove all of this user's device tokens.
    await supabase.from("fcm_tokens").delete().eq("user_id", profile.id);
  } else {
    await supabase
      .from("fcm_tokens")
      .delete()
      .eq("user_id", profile.id)
      .eq("token", body.token);
  }

  return NextResponse.json({ ok: true });
}
