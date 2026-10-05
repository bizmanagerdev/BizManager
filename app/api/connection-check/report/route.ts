import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/requireProfile";
import { withSentry } from "@/lib/sentry-lazy";

// TEMPORARY (2026-10-05) — /connection-check sends its results here when a run
// finishes, so nobody has to copy and send them. Through our own site on
// purpose: a phone's filter may block the error tracker's own address, and
// those are exactly the phones this is about. Stored in connection_checks
// (admins read them on /connection-check/results); if that table isn't there
// yet, the result goes to Sentry from the server instead, so none is lost.

type CheckResult = { status?: unknown; detail?: unknown };

const MAX_TEXT = 4000;

function text(value: unknown, max = MAX_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

export async function POST(request: Request) {
  const { profile, supabase } = await requireProfile();
  // The check is for admins only (2026-10-05).
  if (profile.role !== "admin") return NextResponse.json({ error: "admins only" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    openedIn?: unknown;
    userAgent?: unknown;
    results?: unknown;
    report?: unknown;
  } | null;
  if (!body || typeof body.results !== "object" || body.results === null) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const results = body.results as Record<string, CheckResult>;
  const allPassed = Object.values(results).every((r) => r?.status === "pass" || r?.status === "info");
  const row = {
    opened_in: text(body.openedIn, 200),
    user_agent: text(body.userAgent, 500),
    all_passed: allPassed,
    results,
    report: text(body.report),
  };

  const { error } = await supabase.from("connection_checks").insert(row);
  if (error) {
    withSentry((Sentry) =>
      Sentry.captureMessage("connection check result (table not available)", {
        level: "info",
        tags: { area: "connection-check", opened_in: row.opened_in ?? "unknown", all_passed: String(allPassed) },
        user: { id: profile.id, email: profile.email ?? undefined, username: profile.full_name ?? undefined },
        extra: { ...row, insertError: error.message },
      })
    );
    return NextResponse.json({ saved: "sentry" });
  }
  return NextResponse.json({ saved: "table" });
}
