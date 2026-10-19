import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isGlobalSearchKind, performGlobalSearch } from "@/lib/global-search";

function parseLimit(value: string | null) {
  const parsed = Number(value ?? "5");
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(Math.floor(parsed), 500);
}

// The search box sits in the staff top bar only; workers don't have it.
export async function GET(req: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;

  const { supabase, profile } = access.value;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const kind = searchParams.get("kind");

  try {
    const results = await performGlobalSearch(supabase, {
      query: q,
      viewerRole: profile.role,
      viewerId: profile.id,
      limitPerGroup: parseLimit(searchParams.get("limit")),
      kind: isGlobalSearchKind(kind) ? kind : null,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: toHebrewError(error, "החיפוש הגלובלי נכשל") },
      { status: 400 }
    );
  }
}
