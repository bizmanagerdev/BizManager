import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { autocompleteAddresses, PlacesError } from "@/lib/places/google";

// Address suggestions as someone types (components/ui/address-picker.tsx).
// Signed-in people only: every call is a billed Google request.

const SESSION_TOKEN = /^[A-Za-z0-9-]{8,64}$/;

export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const body = (await req.json().catch(() => ({}))) as { input?: unknown; sessionToken?: unknown };
  const input = typeof body.input === "string" ? body.input.trim().slice(0, 120) : "";
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
  if (!SESSION_TOKEN.test(sessionToken)) {
    return NextResponse.json({ error: "Missing session token" }, { status: 400 });
  }
  // Two letters before Google is asked: one gives the whole country.
  if (input.length < 2) return NextResponse.json({ suggestions: [] });

  try {
    const suggestions = await autocompleteAddresses(input, sessionToken);
    return NextResponse.json({ suggestions });
  } catch (error) {
    const status = error instanceof PlacesError ? error.status : 502;
    const message = error instanceof PlacesError ? error.message : "חיפוש הכתובות לא זמין כרגע. נסו שוב בעוד רגע.";
    return NextResponse.json({ error: message }, { status });
  }
}
