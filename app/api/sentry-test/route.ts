import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY: verifies Sentry captures server errors end-to-end.
// On the DEPLOYED site visit /api/sentry-test?go=1 — it throws on purpose, which
// Sentry's onRequestError hook reports. Then check Sentry → Issues.
// Delete this file once you've confirmed it works.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("go") !== "1") {
    return NextResponse.json({ ok: true, hint: "הוסיפו ?go=1 לכתובת כדי להפעיל שגיאת בדיקה" });
  }
  throw new Error("Sentry test error ✅ (בדיקה — אפשר להתעלם) — " + new Date().toISOString());
}
