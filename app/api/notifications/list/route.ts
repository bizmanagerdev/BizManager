import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// The signed-in user's notification history (newest first) + unread count.
// RLS scopes rows to the viewer (user_id = auth.uid()). Tolerant of the table
// not existing yet (pre-migration → empty).
export async function GET(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  // Cursor pagination for the full-history page: ?before=<created_at ISO>.
  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 40, 1), 100);

  let q = supabase
    .from("notifications")
    .select("id,title,body,url,category,read_at,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) q = q.lt("created_at", before);

  const [itemsRes, countRes] = await Promise.all([
    q,
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);

  if (itemsRes.error) return NextResponse.json({ items: [], unreadCount: 0, hasMore: false });
  const items = itemsRes.data ?? [];
  return NextResponse.json({ items, unreadCount: countRes.count ?? 0, hasMore: items.length === limit });
}
