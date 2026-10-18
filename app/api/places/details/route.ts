import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { addressForPlace, PlacesError } from "@/lib/places/google";

// The address someone picked from the suggestions: its city, street, house
// number and map point (lib/address/structured.ts). It ends the suggestion
// session the picker opened, so Google bills the two as one.

const SESSION_TOKEN = /^[A-Za-z0-9-]{8,64}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const body = (await req.json().catch(() => ({}))) as { placeId?: unknown; sessionToken?: unknown };
  const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
  const sessionToken =
    typeof body.sessionToken === "string" && SESSION_TOKEN.test(body.sessionToken) ? body.sessionToken : null;
  if (!PLACE_ID.test(placeId)) {
    return NextResponse.json({ error: "Missing place id" }, { status: 400 });
  }

  try {
    const address = await addressForPlace(placeId, sessionToken);
    return NextResponse.json({ address });
  } catch (error) {
    const status = error instanceof PlacesError ? error.status : 502;
    const message = error instanceof PlacesError ? error.message : "חיפוש הכתובות לא זמין כרגע. נסו שוב בעוד רגע.";
    return NextResponse.json({ error: message }, { status });
  }
}
