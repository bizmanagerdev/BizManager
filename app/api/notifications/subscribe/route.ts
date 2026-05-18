import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const body = (await req.json()) as {
    endpoint?: string;
    p256dh?: string;
    auth?: string;
  };

  if (!body.endpoint || !body.p256dh || !body.auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: profile.id,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
    },
    { onConflict: "user_id,endpoint" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
