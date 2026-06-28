import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Active tags for the cross-entity picker (currently vehicles; future kinds too).
export async function GET() {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office", "worker"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const { data, error } = await supabase
    .from("tags")
    .select("id,kind,name,color")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ tags: [] });
  return NextResponse.json({ tags: data ?? [] });
}
