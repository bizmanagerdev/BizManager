import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { computeLocalCard, LOCAL_CARD_TABLES, type LocalCardKind } from "@/lib/powersync/dashboard-local";

// The daily device-vs-server check's second look (lib/powersync/dashboard-shadow.ts):
// a page part that came out different on the device is worked out again here,
// from the server's data as it is NOW — with the same code the device uses —
// so a save made between the page opening and the check (the server's first
// copy was read before it) isn't reported as a difference (2026-10-28).
//
// For the person asking, as themselves: their own role and rows (RLS), never
// someone the request names.

type Body = { card?: unknown; filters?: unknown };

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as Body;
    const card = typeof body.card === "string" && body.card in LOCAL_CARD_TABLES ? (body.card as LocalCardKind) : null;
    if (!card) return NextResponse.json({ error: "Unknown page part" }, { status: 400 });

    const renderedAt = new Date().toISOString();
    const data = await computeLocalCard(
      supabase,
      card,
      { userId: profile.id, role: profile.role ?? "", locale: profile.locale },
      body.filters ?? undefined,
      { onServer: true }
    );
    return NextResponse.json({ renderedAt, data });
  } catch (error) {
    return NextResponse.json({ error: toHebrewError(error, "Unknown error") }, { status: 500 });
  }
}
