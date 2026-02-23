import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as Partial<{
    email: string;
    password: string;
  }>;

  const trimmedEmail = email?.trim();

  if (!trimmedEmail || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseRouteClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("invalid login credentials")) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

