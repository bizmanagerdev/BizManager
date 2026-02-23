import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  const supabase = await createSupabaseRouteClient();
  await supabase.auth.signOut();
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}
