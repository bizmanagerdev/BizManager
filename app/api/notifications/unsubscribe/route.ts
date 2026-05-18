import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const body = (await req.json()) as { endpoint?: string };

  if (!body.endpoint) {
    // Remove all subscriptions for this user
    await supabase.from("push_subscriptions").delete().eq("user_id", profile.id);
  } else {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", profile.id)
      .eq("endpoint", body.endpoint);
  }

  return NextResponse.json({ ok: true });
}
