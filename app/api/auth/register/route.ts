import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    email: string;
    password: string;
    full_name: string;
    phone: string;
    notes: string;
  }>;

  const email = body.email?.trim();
  const password = body.password;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseRouteClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: body.full_name?.trim() || undefined,
        phone: body.phone?.trim() || undefined,
        notes: body.notes?.trim() || undefined,
      },
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    needsEmailConfirmation: !data.session,
  });
}

