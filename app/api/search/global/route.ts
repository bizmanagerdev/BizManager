import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { performGlobalSearch } from "@/lib/global-search";

function parseLimit(value: string | null) {
  const parsed = Number(value ?? "6");
  if (!Number.isFinite(parsed) || parsed <= 0) return 6;
  return Math.min(Math.floor(parsed), 12);
}

function parseMode(value: string | null): "quick" | "full" {
  return value === "quick" ? "quick" : "full";
}

export async function GET(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase, profile } = access.value;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitPerGroup = parseLimit(searchParams.get("limit"));
  const mode = parseMode(searchParams.get("mode"));

  try {
    const results = await performGlobalSearch(supabase, {
      query: q,
      viewerRole: profile.role,
      limitPerGroup,
      mode,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: toHebrewError(error, "החיפוש הגלובלי נכשל") },
      { status: 400 }
    );
  }
}
