import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Lightweight list of active users for assignee pickers (reminders, etc.).
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const { data, error } = await supabase
    .from("users")
    .select("id,full_name,email")
    .eq("active", true)
    .order("full_name", { ascending: true })
    .range(0, 499);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const users = (data ?? []).map((u: Record<string, unknown>) => ({
    id: typeof u.id === "string" ? u.id : "",
    label:
      (typeof u.full_name === "string" && u.full_name.trim()) ||
      (typeof u.email === "string" && u.email.trim()) ||
      "ללא שם",
  })).filter((u) => u.id);

  return NextResponse.json({ users, currentUserId: profile.id });
}
