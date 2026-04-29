import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { performGlobalSearch } from "@/lib/global-search";

function parseLimit(value: string | null) {
  const parsed = Number(value ?? "6");
  if (!Number.isFinite(parsed) || parsed <= 0) return 6;
  return Math.min(Math.floor(parsed), 12);
}

export async function GET(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase, profile } = access.value;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitPerGroup = parseLimit(searchParams.get("limit"));

  try {
    const results = await performGlobalSearch(supabase, {
      query: q,
      viewerRole: profile.role,
      limitPerGroup,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "החיפוש הגלובלי נכשל" },
      { status: 400 }
    );
  }
}
