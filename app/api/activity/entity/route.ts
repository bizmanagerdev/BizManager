import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getEntityActivity, type ActivityEntityType } from "@/lib/activity";

const TYPES: ActivityEntityType[] = ["customer", "order", "project", "property", "payment", "vehicle", "invoice", "task"];

// Feeds the reusable <ActivityTimeline> — communications + reminders for one entity.
export async function GET(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") as ActivityEntityType | null;
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!type || !TYPES.includes(type) || !id) {
    return NextResponse.json({ error: "Invalid type or id" }, { status: 400 });
  }

  const items = await getEntityActivity(supabase, type, id);
  return NextResponse.json({ items });
}
