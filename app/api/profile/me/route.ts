import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function GET() {
  try {
    const supabase = await createSupabaseRouteClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const authUserId = session?.user?.id;
    if (!authUserId) {
      return NextResponse.json({ role: null }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("users")
      .select("role,active,system_access")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error || !data || !data.active || !data.system_access) {
      return NextResponse.json({ role: null }, { status: 403 });
    }

    return NextResponse.json({ role: data.role ?? null });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
